/**
 * #2333 - the landing to use once the session exists.
 *
 * `landing` is the mount's GUEST-render decision; `resolveSignedInLanding` is the
 * mount's server action that decides it again for the signed-in doctor (see
 * `signedInLandingAction`). Absent (a host with a constant landing, or a landing
 * that already IS the carried target) the guest value stands; a failed ask
 * degrades to it too - the sign-in has already succeeded and must not stall on
 * where to go next.
 */
export async function landingAfterSignIn(
  landing: string,
  resolveSignedInLanding?: () => Promise<string>,
): Promise<string> {
  if (!resolveSignedInLanding) return landing;
  try {
    return await resolveSignedInLanding();
  } catch {
    return landing;
  }
}

/** Where a confirmed registration completes and lands (021 EARS-10). */
export type CompletionTarget = {
  /** The эфир intent 005 EARS-2 completes; `null` = none. */
  returnTarget: string | null;
  /** Where the visitor lands when no target is honoured. */
  landing: string;
};

/**
 * 021 EARS-10 (amendment 2026-09-29, #2455) - the target decided when the code
 * is accepted, through the mount's server action (`completionTargetAction`).
 * Absent (the arrival carried no standing эфир) the render-time decision
 * stands. A failed ask is not «gone» (review NIT on #2460): the render-time
 * decision stands too, so the visitor still reaches the эфир page, which
 * answers for itself.
 */
export async function completionTargetAfterSignIn(
  atRender: CompletionTarget,
  resolveCompletionTarget?: () => Promise<CompletionTarget>,
): Promise<CompletionTarget> {
  if (!resolveCompletionTarget) return atRender;
  try {
    return await resolveCompletionTarget();
  } catch {
    return atRender;
  }
}
