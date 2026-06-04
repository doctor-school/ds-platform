import { z } from "zod";

// 003 — User authentication request/response contracts (API SSOT, ADR-0002 §3,
// ADR-0006 §6.2). Framework-agnostic; `apps/api` wraps these with `createZodDto`
// at the I/O boundary. This file covers the F1 surface (#85): registration,
// verification, and the Zitadel Action webhook (EARS-1,2,3,4,19,20).

/**
 * E.164 phone shape (`+` then 7–15 digits, leading non-zero). The authoritative
 * phone validation/normalisation is Zitadel's (the IdP owns the credential,
 * design §2); this is the BFF-side shape guard so a malformed identifier is
 * rejected before any IdP round-trip.
 */
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Password shape guard only. Zitadel owns the real password policy (length,
 * complexity, breach checks) — the BFF never stores or hashes a password
 * (Constraints / design §2). This bound just rejects obviously-empty input
 * before the IdP call; Zitadel rejects anything its policy disallows.
 */
const Password = z.string().min(8).max(256);

/**
 * One accepted per-purpose consent version (ADR-0009). Captured at registration
 * before the PD-bearing mirror row is committed (EARS-20).
 */
export const ConsentAcceptanceSchema = z.strictObject({
  purpose: z.string().min(1),
  version: z.string().min(1),
});
export type ConsentAcceptance = z.infer<typeof ConsentAcceptanceSchema>;

/**
 * Registration request (EARS-1 email path / EARS-2 phone path). Exactly one of
 * `email` / `phone` is supplied — the dual-identifier invariant (ADR-0001 §3).
 * `captchaToken` is the bot-protection widget token read by `BotProtectionGuard`
 * (EARS-17); it is optional here because the guard no-ops when the provider is
 * disabled (the dev-stand default). The consent gate (non-empty) is a domain
 * rule enforced in the service (EARS-20), not a shape rule, so the array is
 * permitted to be empty by the schema and refused with a generic failure later.
 */
export const RegisterRequestSchema = z
  .object({
    email: z.email().optional(),
    phone: z.string().regex(E164).optional(),
    password: Password,
    consent: z.array(ConsentAcceptanceSchema),
    captchaToken: z.string().optional(),
  })
  .refine((d) => (d.email == null) !== (d.phone == null), {
    message: "exactly one of email or phone is required",
  });
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/**
 * Registration response. Deliberately identical for the never-registered and
 * already-registered paths so the response does not disclose account existence
 * (enumeration-resistant, EARS-16). A successful submission is always
 * `pending_verification` — the verification code decides the next step.
 */
export const RegisterResponseSchema = z.strictObject({
  status: z.literal("pending_verification"),
});
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

/**
 * Verification request (EARS-3 email / EARS-4 phone). The registrant submits the
 * identifier they registered with plus the OTP code Zitadel sent. Exactly one of
 * `email` / `phone` is supplied (the channel is inferred from which is present).
 */
export const VerifyRequestSchema = z
  .object({
    email: z.email().optional(),
    phone: z.string().regex(E164).optional(),
    code: z.string().min(1),
  })
  .refine((d) => (d.email == null) !== (d.phone == null), {
    message: "exactly one of email or phone is required",
  });
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

/** Verification response — `verified` on success; failures are a generic 4xx. */
export const VerifyResponseSchema = z.strictObject({
  status: z.literal("verified"),
});
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;

/**
 * Login request (EARS-5). A single `identifier` box (email or phone) + password
 * — the user types one credential and Zitadel resolves it (the IdP owns the
 * credential, design §2), so the BFF does not branch on the identifier shape the
 * way registration does. `captchaToken` is the bot-protection widget token read
 * by the guard after repeated failures (EARS-17 login surface, owned by F6); it
 * is optional here because the policy that requires it is not part of F2.
 */
export const LoginRequestSchema = z.object({
  identifier: z.string().min(1),
  password: Password,
  captchaToken: z.string().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Login response. Carries **no token** — the session lives only in the `__Host-`
 * cookie the BFF sets (EARS-8 invariant; ADR-0001 §6). A successful login is
 * `authenticated`; every failure (unknown identifier, wrong password) is the
 * same generic 401 so the response does not disclose account existence (EARS-16).
 */
export const LoginResponseSchema = z.strictObject({
  status: z.literal("authenticated"),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/**
 * Refresh response (EARS-9). Carries **no token** — the rotation happens
 * server-side and the session is still carried only by the unchanged `__Host-`
 * cookie (ADR-0001 §6). A successful rotation is `refreshed`; reuse detection or
 * a missing session is a `401` (the cookie is cleared on reuse), not a body.
 */
export const RefreshResponseSchema = z.strictObject({
  status: z.literal("refreshed"),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

/**
 * Logout response (EARS-10). The server-side session is deleted and the
 * `__Host-` cookie cleared via `Set-Cookie`; the body just acknowledges.
 */
export const LogoutResponseSchema = z.strictObject({
  status: z.literal("logged_out"),
});
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

/**
 * The authenticated principal as read back through `GET /v1/auth/session` — the
 * minimal claim subset the BFF surfaces to its own forms (`sub`, `roles[]`,
 * `mfa`). The full access JWT (`sub, roles[], mfa, sid, iat, exp, jti`) is minted
 * and signed by Zitadel and held server-side; the BFF never echoes the token or
 * the token-internal claims (`iat/exp/jti`) — `sid` is the cookie itself
 * (ADR-0001 §6; invariant "no token signing in apps/api"). The `mfa` claim is
 * always present even though no `doctor_guest` flow requires it (MFA seam).
 */
export const SessionClaimsSchema = z.strictObject({
  sub: z.string(),
  roles: z.array(z.string()),
  mfa: z.boolean(),
});
export type SessionClaims = z.infer<typeof SessionClaimsSchema>;

/**
 * Zitadel Action webhook payload (EARS-19). Zitadel fires this on user
 * create/update; the BFF upserts the corresponding `doctor_guest` mirror row.
 * Loose by design — Zitadel owns the shape and may add fields; the BFF reads
 * only what it mirrors. Authenticated out-of-band by a shared secret header.
 */
export const ZitadelWebhookSchema = z.object({
  zitadelSub: z.string().min(1),
  email: z.email().optional(),
  phone: z.string().regex(E164).optional(),
  emailVerified: z.boolean().optional(),
  phoneVerified: z.boolean().optional(),
});
export type ZitadelWebhook = z.infer<typeof ZitadelWebhookSchema>;

/** Webhook acknowledgement — the mirror state after upsert. */
export const ZitadelWebhookResponseSchema = z.strictObject({
  status: z.literal("synced"),
});
export type ZitadelWebhookResponse = z.infer<
  typeof ZitadelWebhookResponseSchema
>;
