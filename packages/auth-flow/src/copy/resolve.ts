import type { AuthFlowCopy, AuthFlowCopyOverride } from "../host-config";

import { DEFAULT_AUTH_FLOW_COPY, EMAIL_ONLY_IDENTIFIER_COPY } from "./defaults";

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

/**
 * Any host config: only `copy` and `channels` are read, and the index signature
 * keeps the parameter from being a weak type, so a config that states neither —
 * the consent-copy call sites — still satisfies it.
 */
type AuthFlowCopySource = {
  readonly copy?: AuthFlowCopyOverride | undefined;
  readonly channels?: readonly string[] | undefined;
  readonly [key: string]: unknown;
};

/**
 * The words this host renders: the package defaults, the email-only identifier
 * wording when the host states channels without `sms` (#2411 — the same switch
 * `identifierFieldSchema` makes for validation), then its own override merged
 * over them.
 */
export const resolveAuthFlowCopy = (config: AuthFlowCopySource): AuthFlowCopy => {
  const cached = cache.get(config);
  if (cached) return cached;

  const emailOnly =
    config.channels !== undefined && !config.channels.includes("sms");
  const base = emailOnly
    ? (mergeDeep(DEFAULT_AUTH_FLOW_COPY, EMAIL_ONLY_IDENTIFIER_COPY) as AuthFlowCopy)
    : DEFAULT_AUTH_FLOW_COPY;

  const resolved = (
    config.copy === undefined
      ? base
      : (mergeDeep(base, config.copy) as AuthFlowCopy)
  ) satisfies AuthFlowCopy;

  cache.set(config, resolved);
  return resolved;
};

export type { AuthFlowCopyOverride };
