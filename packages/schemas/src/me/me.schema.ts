import { z } from "zod";
import { E164 } from "../auth/auth.schema.js";
import { normaliseContactPhone } from "../congress/contact-phone.js";

// 006 — self-scoped display-name contracts (API SSOT, ADR-0002 §3, 006-design
// §11). Framework-agnostic; `apps/api` wraps these with `createZodDto` at the
// I/O boundary and the portal composer reuses the SAME rule, so a client can
// never submit what the server would reject and the reject path is identical on
// both surfaces (memory: schema message beats portal error-map — the reject
// rule lives here, in the schema).

/**
 * The display-name validator (EARS-14) — the SINGLE SSOT rule the JIT room-entry
 * prompt and the `SetDisplayName` command both enforce. Trimmed (leading/trailing
 * whitespace is not content), **non-empty after trim** (a whitespace-only value is
 * rejected — the garbage-input reject path, 006-design §11 "non-empty after
 * trim"), and bounded at 100 chars. `.trim()` normalises before the length checks
 * so the persisted name carries no padding.
 *
 * Length bound = 100 chars: the spec mandates a "bounded length" without a
 * number; 100 comfortably fits a real «Имя и фамилия» (first + last name, incl.
 * long double-barrelled or patronymic-carrying Russian names) while capping the
 * column against abuse — a display name, not free text. Decision-debt: the exact
 * bound is a code choice, not a spec constant.
 */
export const DisplayNameSchema = z.string().trim().min(1).max(100);

/**
 * `SetDisplayName` request body (EARS-14) — the self-scoped command's only input.
 * The caller's identity is the authenticated session (never a body/path user id —
 * self-scoped, EARS-16); the body carries only the `displayName`, validated by the
 * {@link DisplayNameSchema} SSOT so a malformed value is a 400 before the handler
 * runs (nestjs-zod at the boundary).
 */
export const SetDisplayNameRequestSchema = z.object({
  displayName: DisplayNameSchema,
});
export type SetDisplayNameRequest = z.infer<typeof SetDisplayNameRequestSchema>;

/**
 * `MyDisplayName` read model (EARS-16) — the caller's OWN display name, served
 * only to the authenticated doctor's own session. `null` until the JIT prompt
 * completes (no name collected at registration — owner decision 2026-07-11). The
 * portal reads it to decide the one-time room-entry prompt and to derive the
 * header-avatar initials; it is NEVER served for another user (EARS-16).
 */
export const MyDisplayNameSchema = z.object({
  displayName: z.string().nullable(),
});
export type MyDisplayName = z.infer<typeof MyDisplayNameSchema>;

/**
 * `MyProfile` read model (003 EARS-27, design §12) — the account-profile v1
 * self-read served by `GET /v1/me/profile`: one thin projection of the caller's
 * OWN `users` mirror row, session-scoped (the route takes no identifier
 * parameter, so another user's identity fields are structurally unreachable).
 *
 * Wire-shape decision (settled, design §12): `phone` / `phoneVerified` /
 * `displayName` are `.nullable()` and ALWAYS PRESENT — never `.optional()` — so
 * a client can distinguish "unset" (an explicit `null`) from "field missing"
 * (a contract violation). `phoneVerified` is `null` exactly when no phone is on
 * file (a verified-state for an absent identifier is meaningless), a boolean
 * once a phone exists. Read-only contract: no request schema exists because the
 * endpoint accepts no input and writes nothing on any path.
 */
export const MyProfileSchema = z.object({
  email: z.string(),
  emailVerified: z.boolean(),
  phone: z.string().nullable(),
  phoneVerified: z.boolean().nullable(),
  displayName: z.string().nullable(),
  /**
   * 003 EARS-50 (#2449): the contact phone exactly as typed in the account's
   * latest congress registration, to prefill the `/account` phone field —
   * `null` without one, or when it is already the confirmed phone. A read
   * only: never written, confirmed or texted by the read.
   */
  suggestedPhone: z.string().nullable(),
});
export type MyProfile = z.infer<typeof MyProfileSchema>;

/**
 * 003 EARS-47: a phone typed in `/account` as the E.164 the account would hold
 * — the sign-in identifier mask's rule (a domestic `8…` becomes `+7…`,
 * separators drop); `""` when it holds no digit.
 */
export function normalisePhoneEntry(typed: string): string {
  return normaliseContactPhone(typed);
}

/**
 * `POST /v1/me/phone` body (003 EARS-47): the number to confirm, as typed. The
 * server normalises it with {@link normalisePhoneEntry}; a value that does not
 * normalise to E.164 is refused here. Self-scoped: the account is the session.
 */
export const RequestPhoneCodeRequestSchema = z.object({
  phone: z
    .string()
    .max(32)
    .refine((v) => E164.test(normalisePhoneEntry(v)), {
      message: "invalid phone",
    }),
});
export type RequestPhoneCodeRequest = z.infer<
  typeof RequestPhoneCodeRequestSchema
>;

/**
 * `POST /v1/me/phone` answer (003 EARS-47): `code_sent` — a code went to the
 * number (or was re-sent); `already_confirmed` — the number is the account's
 * confirmed phone, nothing was sent (a no-op success).
 */
export const RequestPhoneCodeResponseSchema = z.object({
  status: z.enum(["code_sent", "already_confirmed"]),
});
export type RequestPhoneCodeResponse = z.infer<
  typeof RequestPhoneCodeResponseSchema
>;

/**
 * `POST /v1/me/phone/confirm` body (003 EARS-48): the code from the SMS. Any
 * string is accepted here; the server applies the six-digit rule (trimmed) as
 * the one generic failure, like every other code step (EARS-41/16).
 */
export const ConfirmPhoneRequestSchema = z.object({
  code: z.string().max(64),
});
export type ConfirmPhoneRequest = z.infer<typeof ConfirmPhoneRequestSchema>;

/** `POST /v1/me/phone/confirm` success (003 EARS-48): the now-confirmed phone. */
export const ConfirmPhoneResponseSchema = z.object({
  status: z.literal("confirmed"),
  phone: z.string(),
});
export type ConfirmPhoneResponse = z.infer<typeof ConfirmPhoneResponseSchema>;
