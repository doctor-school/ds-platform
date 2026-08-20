import { z } from "zod";

/**
 * Stable, account-agnostic bot-protection outcomes returned by auth guards.
 * The portal branches on these codes (never on English exception text):
 * `REQUIRED` starts the conditional password-login challenge; `REJECTED`
 * asks for a fresh one-time proof. Neither code discloses account existence.
 */
export const BotProtectionErrorCodes = {
  required: "BOT_PROTECTION_REQUIRED",
  rejected: "BOT_PROTECTION_REJECTED",
} as const;

export type BotProtectionErrorCode =
  (typeof BotProtectionErrorCodes)[keyof typeof BotProtectionErrorCodes];

export const BotProtectionErrorResponseSchema = z.object({
  statusCode: z.literal(403),
  code: z.enum([
    BotProtectionErrorCodes.required,
    BotProtectionErrorCodes.rejected,
  ]),
  message: z.string(),
});
export type BotProtectionErrorResponse = z.infer<
  typeof BotProtectionErrorResponseSchema
>;

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
 * **Creation** password policy — the single SSOT constant (003 EARS-36, #1331).
 *
 * The policy is **length only**: at least 8 characters, with no upper-case,
 * lower-case, digit, or symbol requirement and no other composition rule. It
 * mirrors the explicitly-provisioned Zitadel instance password-complexity policy
 * (`minLength = 8`, `hasUppercase`/`hasLowercase`/`hasNumber`/`hasSymbol` all
 * `false` — converged idempotently by `infra/dev-stand/idp/provision.sh`), which
 * is the credential authority; this constant is the mirror, so the rule lives in
 * exactly two places (the IdP policy and this constant) and nowhere else.
 *
 * NIST SP 800-63B recommends **against** composition rules — they push users to
 * predictable transformations (`Password1!`), raise abandonment, and buy little
 * entropy — so the earlier four-class baseline (#147/#200) is superseded rather
 * than relaxed ad hoc (003 design §15.1/§15.2).
 *
 * Exported as a bare number, not a schema, so both consumers compose the *same*
 * bound with their own message: the API DTO ({@link NewPasswordSchema}, generic
 * English) and the portal's message-less `NewPasswordFieldSchema`
 * (`packages/design-system/src/primitives/fields/field-schemas.ts`), whose issue
 * falls through to the localized resolver's RU copy. In zod v4 a schema-level
 * message outranks the contextual error map, which is why the *bound* is shared
 * and each layer owns its *message* (the #200 rule-vs-message split, the #197
 * anti-drift rationale).
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Upper bound on a creation password (unchanged, #147) — a DoS guard on the hash
 * input, not a policy rule; the IdP policy carries no maximum.
 */
export const PASSWORD_MAX_LENGTH = 256;

/**
 * **Creation** password schema (003 EARS-36) — registration and password-reset.
 * Length-only, built from the {@link PASSWORD_MIN_LENGTH} SSOT so the BFF
 * contract is honest and the portal (#131) can pre-validate client-side before
 * submit against the identical bound.
 *
 * This is a baseline, not a ceiling: Zitadel remains the ultimate credential
 * authority (design §2, ADR-0001 §7) and may be configured stricter — the
 * residual race (schema passes, a stricter live policy 400s inside Zitadel's
 * `createUser`) is mapped to a generic, non-enumerating "weak password" failure
 * in the auth service, never a 500 and never an existence oracle (EARS-16). The
 * BFF still never stores or hashes a password (Constraints / design §2).
 *
 * The message is generic and identical for every violation, so the field-level
 * error discloses nothing account-specific. It governs **creation** only —
 * {@link LoginPassword} stays a permissive shape guard so every credential
 * created under the superseded four-class policy keeps authenticating; nothing is
 * rotated, invalidated, or re-validated (EARS-36).
 */
export const NewPasswordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  )
  .max(PASSWORD_MAX_LENGTH);

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
 * Resend the registration email verification code (EARS-25). The existence-
 * agnostic `/verify` screen (EARS-24) needs a way to re-send the code without the
 * held password (re-`register` is the EARS-23 path and needs that password). A
 * single `identifier` box (the email — registration is email-primary, EARS-2) is
 * the loose contract, like {@link PasswordResetRequestSchema}: Zitadel stays the
 * credential authority and resolves the identifier (design §2), so the BFF does
 * not branch on its shape. `captchaToken` is the bot-protection widget token read
 * by the guard (EARS-17; resend is an abuse-prone unauthenticated surface);
 * optional here because the guard no-ops when the provider is disabled (the
 * dev-stand default).
 */
export const VerifyResendRequestSchema = z.object({
  identifier: z.string().min(1),
  captchaToken: z.string().optional(),
});
export type VerifyResendRequest = z.infer<typeof VerifyResendRequestSchema>;

/**
 * Resend response (EARS-25). Deliberately identical whether or not the identifier
 * exists or is already verified — a code is re-issued only for an existing,
 * unverified registrant, but the response discloses nothing (enumeration-
 * resistant, EARS-16). Always `resend_requested`.
 */
export const VerifyResendResponseSchema = z.strictObject({
  status: z.literal("resend_requested"),
});
export type VerifyResendResponse = z.infer<typeof VerifyResendResponseSchema>;

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

/* ------------------------------------------------------------------ *
 * 011 — admin session tier (EARS-1/2/3/10)
 * ------------------------------------------------------------------ */

/**
 * 011 `AdminAuthState` read model — **the state enum and nothing else**.
 *
 * Deliberately carries no attempt budget, no lock indicator, no factor id and no
 * session claims (011 requirements → Read models): the caller reading it has
 * passed primary auth only, which is precisely the stolen-password attacker the
 * second factor exists to stop. A budget/lock field here would hand that attacker
 * the enumeration oracle the uniform-failure rule spends a clause denying — one
 * disclosure rule for the state surface and the verify surfaces, not two.
 */
export const AdminAuthStateSchema = z.enum([
  "unauthenticated",
  "mfa_pending_enrollment",
  "mfa_pending_challenge",
  "active",
]);
export type AdminAuthState = z.infer<typeof AdminAuthStateSchema>;

/**
 * `StartAdminLogin` request (EARS-3) — primary password authentication at the
 * admin origin. Same deliberately-loose `identifier` shape as
 * {@link LoginRequestSchema}: Zitadel is the credential authority and resolves
 * the identifier itself (003 design §2), so the BFF does not pre-classify it.
 */
export const AdminLoginRequestSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

/**
 * `StartAdminLogin` response (EARS-3). Primary auth at the admin origin issues
 * **no session** — it returns only the required next step, carried as the pending
 * half of {@link AdminAuthStateSchema}. The short-lived pending-auth reference
 * itself travels in its own host-only cookie, never in the body (011 design §3).
 */
export const AdminLoginResponseSchema = z.strictObject({
  state: z.enum(["mfa_pending_enrollment", "mfa_pending_challenge"]),
});
export type AdminLoginResponse = z.infer<typeof AdminLoginResponseSchema>;

/**
 * `EndAdminSession` response (EARS-2). The admin session record is deleted and
 * `__Host-ds_admin_session` cleared via `Set-Cookie`; any concurrent portal
 * session is untouched. The body just acknowledges.
 */
export const AdminLogoutResponseSchema = z.strictObject({
  status: z.literal("logged_out"),
});
export type AdminLogoutResponse = z.infer<typeof AdminLogoutResponseSchema>;

/**
 * 011 `AdminEnrollmentOffer` read model (EARS-5) — the one-time enrollment
 * payload, returned to the pending principal and to nobody else.
 *
 * It carries the SAME secret twice on purpose: once inside the scannable
 * `provisioningUri` and once as a bare, **manually transcribable** string. Some
 * authenticator apps cannot scan and a screen-reader user cannot scan at all, so
 * an image-only offer would lock those operators out of a mandatory control
 * (EARS-12). Both forms must enrol the same factor — the screen renders the URI
 * as a QR and the secret as selectable text.
 *
 * `issuer` / `account` are the labels the authenticator app shows in its list, so
 * an operator holding several factors can tell them apart. They are **the same
 * strings the `provisioningUri` encodes**, not a second description of it: the
 * BFF composes the URI from them, so the screen can render them beside the secret
 * for manual entry and a hand-typed factor lands under the identical label a
 * scanned one does. Two sources here would mean the QR and the manual path
 * disagreeing about what the entry is called.
 *
 * Nothing here is ever logged, audited, or re-served: a re-request replaces the
 * provisional factor and yields a NEW secret rather than re-reading this one
 * (011 design §4).
 */
export const AdminEnrollmentOfferSchema = z.strictObject({
  /** `otpauth://totp/<issuer>:<account>?secret=…` — the scannable form. */
  provisioningUri: z.string().min(1),
  /** The same shared secret, base32, for manual transcription. */
  secret: z.string().min(1),
  /** Product brand the authenticator app files the factor under — never translated. */
  issuer: z.string().min(1),
  /** The operator's account label inside that issuer (their email). */
  account: z.string().min(1),
});
export type AdminEnrollmentOffer = z.infer<typeof AdminEnrollmentOfferSchema>;

/**
 * A submitted TOTP code (EARS-5, EARS-6) — the shared request shape of the
 * enrollment-verify and challenge-verify endpoints.
 *
 * The **exactly six digits** constraint is the SSOT's job, not the handler's: a
 * malformed code is a 400 from the validation pipe before any verification path
 * runs, so garbage input never consumes an attempt budget and never reaches the
 * IdP. TOTP is fixed at six digits by the provisioning URI this same slice emits
 * (`digits=6`), so the constraint is the contract, not a guess.
 */
export const AdminMfaCodeRequestSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/),
});
export type AdminMfaCodeRequest = z.infer<typeof AdminMfaCodeRequestSchema>;

/**
 * Response to a successful enrollment verify (EARS-5, LD-1). The state moves
 * straight to `active` — the pending authentication is upgraded **in place** and
 * `__Host-ds_admin_session` rides the same response, so there is no second login
 * for the client to orchestrate and nothing else for this body to say.
 */
export const AdminMfaEnrollVerifyResponseSchema = z.strictObject({
  state: z.literal("active"),
});
export type AdminMfaEnrollVerifyResponse = z.infer<
  typeof AdminMfaEnrollVerifyResponseSchema
>;

/**
 * Response to a successful challenge verify (EARS-6, LD-1). Identical in shape to
 * {@link AdminMfaEnrollVerifyResponseSchema} and deliberately a **separate**
 * declaration: the two endpoints are separate contracts that happen to agree
 * today, and collapsing them would make a future divergence on one silently
 * change the other. The admin session cookie pair rides the same response, so
 * there is nothing else for this body to say.
 */
export const AdminMfaVerifyResponseSchema = z.strictObject({
  state: z.literal("active"),
});
export type AdminMfaVerifyResponse = z.infer<
  typeof AdminMfaVerifyResponseSchema
>;

/**
 * 011 `ReadAdminAuthState` response (EARS-6, design §9) — the client-readable
 * pending/authenticated state the admin app routes on.
 *
 * The admin app has to answer "where does this browser belong: login, enrollment,
 * challenge, or the app?" and the three credentials that could tell it apart
 * (`__Host-ds_admin_pending`, `__Host-ds_admin_session`, the CSRF half) are either
 * `HttpOnly` or carry no state — so the state is a server read, not a cookie
 * sniff. This endpoint is that read and nothing more.
 *
 * It carries **exactly** {@link AdminAuthStateSchema} — no attempt budget, no lock
 * indicator, no factor id, no session claims, no subject (011 requirements → Read
 * models). A caller reading it has passed primary auth AT MOST, which is precisely
 * the stolen-password attacker the second factor exists to stop: a budget or lock
 * field here would hand that attacker the oracle the uniform-failure rule spends a
 * whole clause denying. `unauthenticated` is therefore also the answer for an
 * expired, foreign-fingerprint, or entirely absent credential — one shape for
 * "you are not anywhere", never a diagnosis.
 */
export const AdminAuthStateResponseSchema = z.strictObject({
  state: AdminAuthStateSchema,
});
export type AdminAuthStateResponse = z.infer<
  typeof AdminAuthStateResponseSchema
>;

/**
 * 011 `RemoveMfaFactor` request (EARS-13) — the LD-2 operator recovery command.
 *
 * The body carries the **caller's own current TOTP code**, not the target's: this
 * is the route-local fresh-possession proof that realises the ADR-0001 §10 policy
 * intent ("an MFA change is an elevated action and demands fresh MFA") for this
 * one route, because the general step-up mechanism is unbuilt (011 design §9). The
 * target account is named by the path parameter and appears nowhere in this body.
 *
 * Shape-identical to {@link AdminMfaCodeRequestSchema} and deliberately a
 * **separate** declaration, for the same reason the two verify responses are
 * separate: these are distinct contracts that happen to agree today, and one
 * shared symbol would make a future change to a login code silently redefine what
 * a factor-removal request must carry. The six-digit constraint is the SSOT's job
 * — a malformed code is a 400 from the validation pipe, so it never consumes an
 * attempt budget and never reaches the IdP.
 */
export const AdminFactorRemovalRequestSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/),
});
export type AdminFactorRemovalRequest = z.infer<
  typeof AdminFactorRemovalRequestSchema
>;

/**
 * 011 `RemoveMfaFactor` response (EARS-13). The target's registered TOTP factor is
 * gone and their next login re-enters the forced-enrollment state of EARS-4; the
 * body only acknowledges.
 *
 * It carries **no** account detail — not whether the target existed, not whether
 * they held a factor, not their identifier. The removal is idempotent by design
 * (a target with no factor is already in the state this command produces), so a
 * body that distinguished "removed one" from "there was none" would turn a
 * recovery endpoint into a factor-enrollment oracle over the admin population.
 */
export const AdminFactorRemovalResponseSchema = z.strictObject({
  status: z.literal("removed"),
});
export type AdminFactorRemovalResponse = z.infer<
  typeof AdminFactorRemovalResponseSchema
>;
