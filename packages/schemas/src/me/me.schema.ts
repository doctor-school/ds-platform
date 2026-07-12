import { z } from "zod";

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
