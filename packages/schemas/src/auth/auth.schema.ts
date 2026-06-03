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
