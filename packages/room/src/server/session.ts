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
}
