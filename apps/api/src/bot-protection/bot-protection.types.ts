/**
 * Bot-protection abstraction (design §10.1).
 *
 * 003 is the first consumer of bot protection on the platform, so it bootstraps
 * the mechanism behind an interface rather than depending on a separate package
 * (no other consumer yet). The interface keeps the provider swappable
 * (ADR-0001 open-q #7: Yandex SmartCaptcha default, alternatives → DSO-26)
 * without touching call sites; policy (which surfaces, when) is EARS-17 and
 * lives at the call site, not here.
 */

/**
 * Abuse-prone surface a verification is bound to. The vocabulary mirrors the
 * EARS-17 surfaces (registration / reset / post-failure login); the active
 * provider may ignore it (Yandex SmartCaptcha validates a token, not an action)
 * but it is carried through the interface for the audit ledger and for
 * action-scoped providers added later.
 */
export type BotProtectionAction =
  | "register"
  | "password-reset"
  | "login-challenge"
  // EARS-17 (F6 #90): the passwordless OTP-request surface. It is a pre-session
  // message-spending endpoint (resolves the #129 decision-debt: SMS has the
  // EARS-14 budget, but email-OTP had no abuse gate) — gated like register/reset.
  | "otp-request"
  // EARS-17 / EARS-25 (#319): the registration verification-code resend surface.
  // Another pre-session message-spending endpoint (it re-issues the `otp_email`
  // code for an unverified registrant) — an abuse-prone unauthenticated path
  // gated like register / reset / otp-request.
  | "verify-resend";

/**
 * Outcome of a verification. `ok` is the only value a call site branches on;
 * `reason` is diagnostic and audit-only — per design §10 it MUST NOT be
 * surfaced to the client (failure responses stay generic and timing-equalized,
 * EARS-16). `host` is the origin the provider attributes the solve to, when the
 * provider reports it.
 */
export interface BotProtectionResult {
  ok: boolean;
  reason?: string | undefined;
  host?: string | undefined;
}

/**
 * The provider contract (design §10.1): `verify(token, action, clientIp) → ok`.
 * Implementations are async (a real provider makes a server-to-server call) and
 * fail closed — a provider error or downtime resolves to `ok: false`, not an
 * exception that opens the gate (ADR-0001 §5.5 risk row: captcha downtime ⇒
 * block, never "login without bot-protection").
 */
export interface BotProtection {
  verify(
    token: string,
    action: BotProtectionAction,
    clientIp: string,
  ): Promise<BotProtectionResult>;
}

/** Nest metadata key the `@BotProtected` decorator writes and the guard reads. */
export const BOT_PROTECTED_KEY = "ds:bot-protected";
