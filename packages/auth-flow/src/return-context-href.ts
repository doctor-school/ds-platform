import { parseReturnTarget } from "@ds/schemas";
import { parseRoomReturnTarget } from "@ds/room/room-return";

import type { AuthFlowHostConfig } from "./host-config";
import { parseAccountReturnTarget } from "./return-target";

/**
 * The CARRY vocabulary of an auth hop (rule S3 / #2258), in a module with no
 * server import in its graph.
 *
 * They sit outside `./server/return-context`, whose module graph reaches
 * `next/headers` through `./server/session`: the client doors carry the same
 * value onward to the sign-in and recovery doors, so the rule is reachable from
 * both halves without being written twice.
 * `@ds/auth-flow/server` re-exports them, so its shipped surface is unchanged.
 */

/** The host routes these rules read - data from the host config. */
export type ReturnContextHost = Pick<AuthFlowHostConfig, "routes">;

/** The canonical return-target search param (005 EARS-2 / 021 LD-3). */
export const RETURN_CONTEXT_PARAM = "returnTo";

/**
 * 006 EARS-6 - this host's ROOM return (`routes.room`, e.g. `/events/<slug>/room`),
 * reconstructed by the shared `@ds/room` codec, or `null`. A host that serves no
 * room admits none. Room first, because the room path also ends in an event slug
 * segment the эфир vocabulary must not claim.
 */
export function resolveRoomReturnTarget(
  host: ReturnContextHost,
  returnTo: string | undefined,
): string | null {
  const { room } = host.routes;
  return room
    ? (parseRoomReturnTarget(returnTo, { room })?.returnTo ?? null)
    : null;
}

/**
 * #2258 / rule S3 - the value that rides ONWARD across an auth hop, covering
 * every shape a visitor may legitimately be coming back to: this host account
 * family (`routes.account`, segment boundary enforced), this host room
 * (`routes.room`) and the эфир vocabulary.
 * Deliberately NOT `resolveReturnTargetPath`, which must stay эфир-only.
 */
export function resolveCarriedReturnTarget(
  host: ReturnContextHost,
  returnTo: string | undefined,
): string | null {
  const account = parseAccountReturnTarget(returnTo, host.routes.account);
  if (account) return account;

  const room = resolveRoomReturnTarget(host, returnTo);
  if (room) return room;

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
