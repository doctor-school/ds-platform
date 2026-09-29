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
