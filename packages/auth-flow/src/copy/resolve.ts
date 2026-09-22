import type { AuthFlowCopy, AuthFlowCopyOverride, AuthFlowHostConfig } from "../host-config";

import { DEFAULT_AUTH_FLOW_COPY } from "./defaults";

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Merge a host's deep partial over the package defaults.
 *
 * A stated key wins; an absent key keeps the default, so overriding one
 * sentence never blanks its siblings. `undefined` is treated as "not stated" —
 * a host cannot delete a default by naming it, only replace it.
 */
const mergeDeep = (base: unknown, override: unknown): unknown => {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;

  const merged: PlainObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    merged[key] = mergeDeep(base[key], value);
  }
  return merged;
};

/**
 * Referential stability: several call sites resolve inside `useMemo([config])`
 * and the field rules resolve per render, so the same config object must always
 * hand back the same copy object.
 */
const cache = new WeakMap<object, AuthFlowCopy>();

/** The words this host renders: the package defaults with its own override merged over them. */
export const resolveAuthFlowCopy = (
  config: Pick<AuthFlowHostConfig, "copy">,
): AuthFlowCopy => {
  const cached = cache.get(config);
  if (cached) return cached;

  const resolved = (
    config.copy === undefined
      ? DEFAULT_AUTH_FLOW_COPY
      : (mergeDeep(DEFAULT_AUTH_FLOW_COPY, config.copy) as AuthFlowCopy)
  ) satisfies AuthFlowCopy;

  cache.set(config, resolved);
  return resolved;
};

export type { AuthFlowCopyOverride };
