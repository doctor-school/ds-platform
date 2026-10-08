import { headers } from "next/headers";

import type { CompletionTarget } from "../client/signed-in-landing";
import type { AuthFlowHostConfig } from "../host-config";
import { resolveArrivalLanding } from "./landing";
import { readReturnEvent } from "./return-context";

export type { CompletionTarget };

/**
 * 021 EARS-10 (amendment 2026-09-29, #2455) — the carried эфир is judged when
 * the code is ACCEPTED, not when `/verify` rendered: the server action the
 * confirmation step calls then, asking the same public event read the mount
 * asked (`readReturnEvent`). Only a «gone» answer drops the target; the LD-4
 * landing is then decided for the signed-in doctor (#2333).
 *
 * #2477 — the sign-in door (`/login`, password and code) completes through
 * the SAME action when its sign-in succeeds, so an эфир unpublished or removed
 * while either page stood open lands the visitor in one place on both doors.
 *
 * WHY A CLOSURE: as `signedInLandingAction` — Next encrypts and signs the
 * closed-over values, so the browser invokes the action but cannot re-point
 * the эфир it reads. The browser supplies no argument at all.
 */
export function completionTargetAction(
  host: Pick<AuthFlowHostConfig, "landing">,
  /** The LD-3 guard reconstruction of the arrival — what the read is asked of. */
  safeTarget: string,
  /** The same target projected onto this host's paths (#1945). */
  landingTarget: string,
): () => Promise<CompletionTarget> {
  const { landing } = host;
  return async function resolveCompletionTarget(): Promise<CompletionTarget> {
    "use server";
    const read = await readReturnEvent(safeTarget);
    if (read?.status !== "gone") {
      return { returnTarget: landingTarget, landing: landingTarget };
    }
    return {
      returnTarget: null,
      landing: await resolveArrivalLanding({ landing }, await headers()),
    };
  };
}
