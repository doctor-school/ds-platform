/**
 * 017 EARS-6 / LD-2 (#1482) — the ANONYMOUS SESSION a guest's specialty choice
 * lives in.
 *
 * ## Why a cookie and not a server-side row
 *
 * LD-2 defines the guest store as "the anonymous session", and defines a session
 * as **per-device by definition** with the profile as the cross-device
 * mechanism. A server-side guest table would be a second identity store for
 * unauthenticated visitors — rows to expire, a sweeper to own, and personal-ish
 * data retained for people who never registered. The cookie IS the anonymous
 * session: it lives on the one device, it expires with itself, and it carries no
 * identifier of a person — only which entry of a public reference book this
 * browser last picked.
 *
 * It is a SIBLING of `__Host-ds_session`, never a replacement: a guest by
 * definition has no BFF session, so there is no session record to hang the value
 * off. When the visitor does sign in, `__Host-ds_session` appears alongside this
 * one and the cascade of 017-design §4 consumes and clears it.
 *
 * ## Attributes
 *
 * The `__Host-` prefix for the same reason the session cookie carries it
 * (ADR-0001 §6): a user agent rejects it unless it is `Secure`, `Path=/`, and
 * carries no `Domain`, so the value is locked to the exact origin that set it —
 * `doctor.school` and `academy.doctor.school` do not share it, exactly as
 * ADR-0015 §4 requires of the session cookie.
 *
 * `HttpOnly` is deliberate even though the value is not a secret: the choice is
 * written by the command and read by the cascade, both server-side, so script
 * access would only create a second, unvalidated way to set it. The storefront
 * learns the remembered choice from the read, never by parsing a cookie.
 *
 * ## Integrity
 *
 * The value is a specialty reference, not a credential, and it is resolved
 * against the closed book on EVERY read (`resolveMember`) before it is shown or
 * adopted. A visitor who edits it can therefore change only which public book
 * entry their OWN browser is targeted on — the same thing the catalog lets them
 * do with one click — and can never adopt a non-member, reach another actor's
 * profile, or influence any authorization decision. So it carries no signature:
 * a MAC here would protect nothing the membership check does not already close,
 * while introducing a key to rotate.
 */

/** The anonymous-session choice cookie. `__Host-` = origin-locked, no `Domain`. */
export const SPECIALTY_CHOICE_COOKIE_NAME = "__Host-ds_specialty";

/**
 * How long a guest's choice survives. A year — the same order as the storefront
 * itself: a doctor who chose their specialty six months ago and returns has not
 * changed specialty, and re-asking would be the platform forgetting something it
 * told them it had remembered (EARS-6's «open every subsequent visit directly in
 * the targeted view»).
 */
export const SPECIALTY_CHOICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Serialize the anonymous-session choice cookie with its `__Host-` attribute set. */
export function serializeSpecialtyChoiceCookie(reference: string): string {
  return [
    `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(reference)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SPECIALTY_CHOICE_MAX_AGE_SECONDS}`,
  ].join("; ");
}

/**
 * Serialize the cookie that CLEARS the anonymous-session choice — the discard
 * half of LD-2's cascade, on both of its branches (adopted, or the profile
 * already held one). The attribute set must match the one that set it or some
 * user agents ignore the deletion, which would leave a stale guest value to be
 * re-adopted on a later sign-out/sign-in.
 */
export function clearSpecialtyChoiceCookie(): string {
  return [
    `${SPECIALTY_CHOICE_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

/**
 * Read the anonymous-session choice out of a raw `Cookie` header.
 *
 * Name-boundary aware for the same reason `apps/doctor/lib/session.ts` is: a
 * bare substring test would match a different cookie whose name merely ends with
 * ours, and hand its value to the cascade as if a guest had chosen it.
 */
export function readSpecialtyChoiceCookie(
  header: string | undefined,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SPECIALTY_CHOICE_COOKIE_NAME) continue;
    const raw = part.slice(eq + 1).trim();
    if (raw.length === 0) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      // A malformed percent-escape is a value this server never wrote. Treat it
      // as «no choice», never as an error the visitor has to clear by hand.
      return null;
    }
  }
  return null;
}
