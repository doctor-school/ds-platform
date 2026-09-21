import { parseReturnTarget } from "@ds/schemas";

import type { AuthFlowHostConfig } from "./host-config";
import { parseAccountReturnTarget } from "./return-target";

/**
 * The CARRY vocabulary of an auth hop (rule S3 / #2258), in a module with no
 * server import in its graph.
 *
 * These three symbols used to live in `./server/return-context`, whose module
 * graph reaches `next/headers` through `./server/session`. The inline
 * confirmation step (`./register/inline-confirmation`) is a CLIENT component and
 * carries the same value onward to the sign-in and recovery doors, so the rule
 * had to become reachable from both halves without being written twice.
 * `@ds/auth-flow/server` re-exports them, so its shipped surface is unchanged.
 */

/** The host routes these rules read - data from the host config. */
export type ReturnContextHost = Pick<AuthFlowHostConfig, "routes">;

/** The canonical return-target search param (005 EARS-2 / 021 LD-3). */
export const RETURN_CONTEXT_PARAM = "returnTo";

/**
 * #2258 / rule S3 - the value that rides ONWARD across an auth hop, covering
 * both shapes a visitor may legitimately be coming back to: this host account
 * family (`routes.account`, segment boundary enforced) and the эфир vocabulary.
 * Deliberately NOT `resolveReturnTargetPath`, which must stay эфир-only.
 */
export function resolveCarriedReturnTarget(
  host: ReturnContextHost,
  returnTo: string | undefined,
): string | null {
  const account = parseAccountReturnTarget(returnTo, host.routes.account);
  if (account) return account;

  return parseReturnTarget(returnTo)?.returnTo ?? null;
}

/**
 * 021 EARS-15 / 003 EARS-39 - carry the return context ONWARD across an
 * intermediate auth hop. The value re-appended is what the guards reconstructed,
 * never the raw input; an absent or rejected target is simply dropped.
 */
export function withReturnContext(
  host: ReturnContextHost,
  path: string,
  returnTo: string | undefined,
): string {
  const safe = resolveCarriedReturnTarget(host, returnTo);
  if (!safe) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${RETURN_CONTEXT_PARAM}=${encodeURIComponent(safe)}`;
}
