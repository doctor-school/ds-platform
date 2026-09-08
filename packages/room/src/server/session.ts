/**
 * D16 — the forwarded-session shape `@ds/room/server` reads with.
 *
 * The package owns its own structural type rather than importing either host's:
 * `apps/portal/lib/registration-state.ts` and `apps/doctor/lib/session.ts` each
 * declare a shape of these three headers with host-specific doc contracts, and
 * both satisfy this one structurally. Lifting it into `@ds/schemas` was rejected
 * deliberately — it is an HTTP-transport concern, not part of the API contract
 * SSOT; `DEBT.md` names `@ds/schemas` as the promotion path if a fourth host
 * appears.
 */
export interface RoomSession {
  readonly cookie: string;
  readonly userAgent: string;
  readonly acceptLanguage: string;
  /**
   * The incoming `x-forwarded-for` value verbatim; `""` when the request carried
   * none. The FOURTH fingerprint input: since #1655 the api resolves
   * `request.ip` from this header whenever the peer is trusted, so the session is
   * bound to the BROWSER's IP/24 and a room read that presents the storefront
   * container's address is 401'd (#2054).
   */
  readonly forwardedFor: string;
}

/**
 * The headers every room server read sends. Mirrors `forwardedHeaders` in
 * `@ds/events-storefront/server` deliberately rather than importing it: the two
 * shared units do not depend on each other, and the hosts' `ForwardedSession`
 * satisfies BOTH structurally. `@ds/schemas` stays the recorded promotion path
 * (DEBT.md) if a third consumer of this transport surface appears.
 */
export function roomForwardedHeaders(
  session: RoomSession,
): Record<string, string> {
  return {
    accept: "application/json",
    cookie: session.cookie,
    // The fingerprint surface (ADR-0001 §6) — without it the api re-derives a
    // different fingerprint and 401s a valid session.
    "user-agent": session.userAgent,
    "accept-language": session.acceptLanguage,
    ...(session.forwardedFor
      ? { "x-forwarded-for": session.forwardedFor }
      : {}),
  };
}
