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
export const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Identifier-shape validators (#192) for **client-side, per-channel** UX guards in
 * the portal. They are NOT applied to {@link LoginRequestSchema} /
 * {@link OtpRequestSchema} — those keep a deliberately-loose `identifier`
 * (`z.string().min(1)`) because Zitadel is the credential authority and resolves
 * the identifier itself (design §2). These are exported so the portal can reject a
 * plainly-malformed identifier (e.g. a bare numeric string in the email channel)
 * before submit, while the BFF contract stays unchanged. Same `z.email()` / `E164`
 * shapes registration already uses, so the two surfaces agree.
 */
export const EmailIdentifierSchema = z.email();
export const PhoneIdentifierSchema = z.string().regex(E164);

/**
 * **Login** password guard — deliberately permissive (#147). A minimal shape
 * guard (≥8, ≤256) with NO complexity rules: it must accept whatever a user
 * stored, including legacy credentials that predate the current complexity
 * policy, and let Zitadel be the sole authenticator (the IdP owns the credential,
 * design §2). Applying the creation-time complexity here would lock those users
 * out of their own valid accounts at the DTO layer, which is a regression, not a
 * security gain. Zitadel still rejects a genuinely wrong password.
 */
const LoginPassword = z.string().min(8).max(256);

/**
 * **Creation** password complexity rule (#147, #200) — the bare regex, exported as
 * the single SSOT for the *pattern* (min-length bounds are applied alongside it).
 * Four positive look-aheads: at least one lower-case letter, one upper-case letter,
 * one digit, and one non-letter/non-digit "symbol" character (Unicode-aware, `u`).
 *
 * Why the regex is split out from {@link NewPasswordSchema} (the message-carrying
 * field schema): the *rule* is the SSOT, but the *message* is layer-specific. The
 * API DTO ({@link NewPasswordSchema}) keeps a generic, non-enumerating English
 * message (see its doc-comment); the portal composes a **message-less** field
 * schema from THIS constant so its localized resolver
 * (`apps/portal/lib/use-localized-resolver.ts`) can map the resulting
 * `invalid_format` issue to the RU `errors.validation.passwordComplexity` copy. In
 * zod v4 a schema-level `.regex()` message outranks the contextual error map, so a
 * baked-in message would leak English on the portal — hence the rule (this regex)
 * is shared while each layer owns its own message. Re-using this constant keeps the
 * pattern from drifting between the two layers (the #197 anti-drift rationale).
 */
export const NEW_PASSWORD_COMPLEXITY =
  /^(?=.*\p{Ll})(?=.*\p{Lu})(?=.*\d)(?=.*[^\p{L}\d]).*$/u;

/**
 * **Creation** password schema (#147) — registration and password-reset. It
 * mirrors the deployed Zitadel default complexity policy as the BFF *baseline*
 * (min 8 + at least one upper-case, one lower-case, one digit, and one symbol)
 * so the contract is honest and the portal (#131) can pre-validate client-side
 * before submit. This is a baseline, not a ceiling: Zitadel remains the ultimate
 * credential authority (design §2, ADR-0001 §7) and may be configured stricter —
 * the residual race (schema passes, a stricter live policy 400s inside Zitadel's
 * `createUser`) is mapped to a generic, non-enumerating "weak password" failure
 * in the auth service, never a 500 and never an existence oracle (EARS-16). The
 * BFF still never stores or hashes a password (Constraints / design §2).
 *
 * Encoded as four positive look-aheads + the length bound; the message is generic
 * (it names the requirement, not which class is missing) and identical for every
 * violation so the field-level error discloses nothing account-specific.
 *
 * Exported (#197) as the reusable creation-password fragment so the portal's
 * `NewPasswordFieldSchema` (`apps/portal/components/fields`) composes from THIS
 * SSOT instead of re-declaring the complexity regex — same rationale as the
 * `EmailIdentifierSchema` / `PhoneIdentifierSchema` shape fragments above: the
 * client pre-validation cannot silently drift from the BFF baseline. This is the
 * per-field fragment, NOT a request schema — the loose REQUEST schemas are
 * unaffected; they keep composing `NewPasswordSchema` exactly as before.
 */
export const NewPasswordSchema = z
  .string()
  .min(8)
  .max(256)
  // Built from the {@link NEW_PASSWORD_COMPLEXITY} SSOT rule so the pattern has a
  // single source; the generic English MESSAGE is owned here at the DTO layer (the
  // portal composes its own message-less field schema from the same constant —
  // #200, the rule-vs-message split documented on the constant above).
  .regex(
    NEW_PASSWORD_COMPLEXITY,
    "password must include an upper-case letter, a lower-case letter, a digit, and a symbol",
  );

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
 * Registration request (EARS-1). **Email is the primary — and only —
 * registration identifier.** The dual-identifier "register with email OR phone"
 * model (and its `phone` field + exactly-one `.refine`) was removed per #202:
 * Zitadel cannot create a login-capable human user without an email (invariant
 * across `AddHumanUser` v1/v2 and `CreateUser` `/v2/users/new`, confirmed in
 * `main`), so a phone-only registration is unbuildable. Phone is a
 * post-registration secondary identifier (future) — it stays a first-class
 * identifier for *login* (`LoginRequestSchema`) and SMS-OTP login
 * (`OtpRequestSchema`, EARS-7), just not for registration.
 *
 * `captchaToken` is the bot-protection widget token read by `BotProtectionGuard`
 * (EARS-17); it is optional here because the guard no-ops when the provider is
 * disabled (the dev-stand default). The consent gate (non-empty) is a domain
 * rule enforced in the service (EARS-20), not a shape rule, so the array is
 * permitted to be empty by the schema and refused with a generic failure later.
 */
export const RegisterRequestSchema = z.object({
  email: z.email(),
  password: NewPasswordSchema,
  consent: z.array(ConsentAcceptanceSchema),
  captchaToken: z.string().optional(),
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
 * Verification request (EARS-3). Registration verification is **email-only**:
 * registration is email-primary (#202), so the registrant submits the email they
 * registered with plus the OTP code Zitadel sent. The dual-identifier `phone`
 * field + exactly-one `.refine` were removed with the phone-only registration
 * channel; EARS-4 phone verification is a future post-registration
 * secondary-identifier concern, not a registration step.
 */
export const VerifyRequestSchema = z.object({
  email: z.email(),
  code: z.string().min(1),
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
  // Permissive guard (#147): no complexity — never lock out a legacy credential
  // at the DTO layer; Zitadel authenticates it. See {@link LoginPassword}.
  password: LoginPassword,
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
 * The passwordless login channel (EARS-6 email / EARS-7 SMS). Both are native
 * Zitadel one-time-code flows (`otp_email` / `otp_sms`, design §2) that converge
 * on the same session-establishment step (design §6); the discriminator selects
 * which native channel the BFF asks Zitadel to use and, for `sms`, engages the
 * toll-fraud budget (EARS-14) before the send.
 */
export const OtpChannelSchema = z.enum(["email", "sms"]);
export type OtpChannel = z.infer<typeof OtpChannelSchema>;

/**
 * Request a passwordless login code (EARS-6 step 1 / EARS-7 step 1). A single
 * `identifier` box (email or phone) like {@link LoginRequestSchema} — Zitadel
 * resolves it (design §2) and sends the code. `captchaToken` is the bot-protection
 * token (EARS-17, owned by F6); optional here as the guard no-ops when disabled.
 */
export const OtpRequestSchema = z.object({
  identifier: z.string().min(1),
  channel: OtpChannelSchema,
  captchaToken: z.string().optional(),
});
export type OtpRequest = z.infer<typeof OtpRequestSchema>;

/**
 * Response to a code request (EARS-6/7). Deliberately identical whether or not the
 * identifier exists — a code is sent only if it does, but the response discloses
 * nothing (enumeration-resistant, EARS-16). Always `otp_sent`. A send refused by
 * the SMS toll-fraud budget (EARS-14) is *not* this response — it is a generic
 * throttled error, so a budget refusal never masquerades as a delivered code.
 */
export const OtpRequestResponseSchema = z.strictObject({
  status: z.literal("otp_sent"),
});
export type OtpRequestResponse = z.infer<typeof OtpRequestResponseSchema>;

/**
 * Submit a passwordless login code (EARS-6 step 2 / EARS-7 step 2). On success
 * the BFF establishes a session exactly as password login does (design §6),
 * returning {@link LoginResponseSchema} with a `__Host-` cookie and no token;
 * every failure (unknown identifier, wrong/expired code) is the same generic 401
 * (EARS-16).
 */
export const OtpVerifySchema = z.object({
  identifier: z.string().min(1),
  code: z.string().min(1),
  channel: OtpChannelSchema,
});
export type OtpVerify = z.infer<typeof OtpVerifySchema>;

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
 * Password-reset initiation (EARS-11). A single `identifier` box (email or phone)
 * — like login, the user types one credential and Zitadel resolves it (design §2)
 * — triggers the Zitadel forgot-password code flow. `captchaToken` is the
 * bot-protection widget token read by the guard (EARS-17; reset is an abuse-prone
 * unauthenticated surface, design §10.1); optional here because the guard no-ops
 * when the provider is disabled (the dev-stand default).
 */
export const PasswordResetRequestSchema = z.object({
  identifier: z.string().min(1),
  captchaToken: z.string().optional(),
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

/**
 * Password-reset initiation response (EARS-11). Deliberately identical whether or
 * not the identifier exists — a code is sent only if it does, but the response
 * discloses nothing (enumeration-resistant, EARS-16). Always `reset_requested`.
 */
export const PasswordResetResponseSchema = z.strictObject({
  status: z.literal("reset_requested"),
});
export type PasswordResetResponse = z.infer<typeof PasswordResetResponseSchema>;

/**
 * Password-reset completion (EARS-12). The user submits the identifier they
 * requested the reset for, the reset code Zitadel sent, and a policy-conforming
 * new password. The IdP owns the real password policy and the code verification
 * (design §2); `newPassword` carries the same creation-time complexity baseline
 * as registration (#147; {@link NewPasswordSchema}) so a reset cannot set a
 * password weaker than the policy and the portal can pre-validate it.
 */
export const PasswordResetCompleteRequestSchema = z.object({
  identifier: z.string().min(1),
  code: z.string().min(1),
  newPassword: NewPasswordSchema,
});
export type PasswordResetCompleteRequest = z.infer<
  typeof PasswordResetCompleteRequestSchema
>;

/**
 * Password-reset completion response (EARS-12). `reset_completed` on success
 * (the new password is set and every existing session for the user is revoked);
 * every failure — invalid/expired code, unknown identifier — is the same generic
 * 4xx so the response stays enumeration-resistant (EARS-16).
 */
export const PasswordResetCompleteResponseSchema = z.strictObject({
  status: z.literal("reset_completed"),
});
export type PasswordResetCompleteResponse = z.infer<
  typeof PasswordResetCompleteResponseSchema
>;

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
