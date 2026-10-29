import { z } from "zod";
import {
  SignInHostDoorSchema,
  SignInHostStorefrontSchema,
} from "./sign-in-host.schema.js";

/**
 * 003 EARS-8 (amended) / 62 / 71, ADR-0015 §4 steps 1 and 3 — the API's
 * storefront-server-only endpoints under `INTERNAL_API_PREFIX`
 * (`/v1/internal`, `@ds/schemas/internal-api`). Only the storefront Next
 * servers reach them, on the compose network, with the internal credential
 * (`Authorization: Bearer <INTERNAL_API_TOKEN>`); the public edges and every
 * same-origin BFF refuse the prefix. They forward the browser's `user-agent`,
 * `accept-language` and `x-forwarded-for` exactly as the BFF rewrites do, so
 * the session fingerprint and the per-IP limits see the person, not the server.
 */

/** The interactive transaction's lifetime (ADR-0015 §4 step 1): an intent never outlives it. */
export const STOREFRONT_INTERACTIVE_TRANSACTION_SECONDS = 60 * 60;
/** The silent transaction's lifetime (EARS-63, #3006 S5). */
export const STOREFRONT_SILENT_TRANSACTION_SECONDS = 60;
/** EARS-61 — the return path's cap. */
export const STOREFRONT_RETURN_PATH_MAX = 2048;

// C0 controls and DEL; a return path carrying one is refused (EARS-61).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

// A dot segment (`.` / `..`, plain or percent-encoded) in the path part: URL
// normalisation removes it, so `/..//host` would resolve to `//host`.
const DOT_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;
// A backslash, plain or percent-encoded: special-scheme parsers read it as `/`.
const BACKSLASH = /\\|%5c/i;

/**
 * 003 EARS-61, ADR-0015 §4 req. 1 — whether `value` is an acceptable return
 * path: same-origin path and query only — starts with `/`, not `//` or `/\`,
 * no control character, within {@link STOREFRONT_RETURN_PATH_MAX}; its path
 * part carries no dot segment and no backslash (plain or percent-encoded), so
 * no URL normalisation of the path can turn it into another origin.
 */
export function isStorefrontReturnPath(value: string): boolean {
  const query = value.indexOf("?");
  const path = query === -1 ? value : value.slice(0, query);
  return (
    value.length <= STOREFRONT_RETURN_PATH_MAX &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\") &&
    !CONTROL.test(value) &&
    !DOT_SEGMENT.test(path) &&
    !BACKSLASH.test(path)
  );
}

/**
 * 003 EARS-61 — the transaction's return path from a storefront entry's
 * same-origin target: an unacceptable one is `/`; a longer one than the cap
 * is cut to its path (the query and fragment dropped), and is `/` when the
 * path alone is longer. The fragment never enters the return path.
 */
export function toStorefrontReturnPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  const hash = raw.indexOf("#");
  const value = hash === -1 ? raw : raw.slice(0, hash);
  if (value.length > STOREFRONT_RETURN_PATH_MAX) {
    const query = value.indexOf("?");
    const path = query === -1 ? value : value.slice(0, query);
    return isStorefrontReturnPath(path) ? path : "/";
  }
  return isStorefrontReturnPath(value) ? value : "/";
}

/**
 * EARS-71 — the entry intent a storefront entry records with its transaction
 * before it redirects to authorize. `eventTarget` is only the event reference
 * the shared return-target guard extracts (a slug), never card data or free
 * text; `handoff` is the Congress hand-off reference, sealed at rest by the
 * API. The door is the transaction's own: the reset entry records an empty
 * intent, its door being the one thing the plain sign-in form does not say.
 */
export const StorefrontEntryIntentSchema = z.strictObject({
  method: z.enum(["password", "code"]).optional(),
  handoff: z.string().min(1).max(512).optional(),
  eventTarget: z.string().min(1).max(200).optional(),
});
export type StorefrontEntryIntent = z.infer<typeof StorefrontEntryIntentSchema>;

/**
 * `POST /v1/internal/oidc/transaction` — 003 EARS-61 / EARS-71, ADR-0015 §4
 * step 1: the API creates the storefront's server-side transaction — fresh
 * `state`, `nonce` and PKCE verifier, all generated and held by the API —
 * with the entry's return path, door and (interactive only) its entry intent,
 * for the kind's lifetime (interactive 60 min, silent ≈60 s), single-use.
 */
export const StorefrontTransactionRequestSchema = z
  .strictObject({
    client: SignInHostStorefrontSchema,
    kind: z.enum(["interactive", "silent"]),
    door: SignInHostDoorSchema,
    returnPath: z
      .string()
      .refine(isStorefrontReturnPath, "not a same-origin return path")
      .optional(),
    intent: StorefrontEntryIntentSchema.optional(),
    /**
     * 005 EARS-2 — the эфир (its slug) whose registration the callback
     * completes once the session exists: the entry's return target was an
     * event registration intent (not a land-only, room or account return).
     */
    completeRegistration: z.string().min(1).max(200).optional(),
  })
  .refine(
    (r) =>
      r.kind === "interactive" ||
      (r.intent === undefined && r.completeRegistration === undefined),
    { message: "a silent check carries no intent" },
  );
export type StorefrontTransactionRequest = z.infer<
  typeof StorefrontTransactionRequestSchema
>;

/**
 * `POST /v1/internal/oidc/silent-check` — 003 EARS-63, ADR-0015 §4 step 4:
 * the storefront middleware / proxy starts a **silent** transaction
 * (`prompt=none`, ≈60 s, single-use) for a checkable signed-out document
 * request, with the request's path and query as the return path (requirement
 * 1; absent for the EARS-62 recovery, which lands by the landing rules). It is
 * its own route so the start counts in the silent path's own per-IP bucket
 * (`oidc:silent-check`, req. 9), never in the interactive entry's. A silent
 * check carries no door choice and no intent: the door is the sign-in.
 * `replaces` names the browser's live **interactive** transaction (EARS-63
 * (c)): the API deletes it, so an abandoned form never outlives the check.
 */
export const StorefrontSilentCheckRequestSchema = z.strictObject({
  client: SignInHostStorefrontSchema,
  returnPath: z
    .string()
    .refine(isStorefrontReturnPath, "not a same-origin return path")
    .optional(),
  replaces: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional(),
});
export type StorefrontSilentCheckRequest = z.infer<
  typeof StorefrontSilentCheckRequestSchema
>;

/** A transaction's kind (ADR-0015 §4 step 1): its lifetime and whether a callback ends in the guest marker. */
export const StorefrontTransactionKindSchema = z.enum([
  "interactive",
  "silent",
]);
export type StorefrontTransactionKind = z.infer<
  typeof StorefrontTransactionKindSchema
>;

/**
 * The opaque transaction id (32 random bytes, base64url — the
 * `__Host-ds_oidc_tx` value) and the complete authorize URL the entry
 * redirects to: the API holds the per-environment client map, the issuer and
 * the storefront's one registered `redirect_uri`, and builds it with the
 * storefront's own `client_id`, `state`, `nonce`, the `S256` challenge,
 * `response_mode=query`, `prompt=create` for registration (`prompt=none` for a
 * silent check) and `login_hint=<intent id>` when an intent was recorded. The
 * verifier never leaves the API.
 */
export const StorefrontTransactionResponseSchema = z.strictObject({
  txId: z.string(),
  authorizeUrl: z.url(),
});
export type StorefrontTransactionResponse = z.infer<
  typeof StorefrontTransactionResponseSchema
>;

const OPAQUE_ID = /^[A-Za-z0-9_-]{43}$/;

/**
 * `POST /v1/internal/oidc/redeem` — the storefront callback: the transaction
 * named by `__Host-ds_oidc_tx` (absent when the browser holds none), the
 * callback's `state` and `code` (absent for an OIDC `error` answer, which only
 * spends the transaction). The API takes the transaction single-use, checks
 * `state` against it, and redeems with its held verifier and nonce at the
 * storefront's one registered callback URI; a `state` that is not the
 * browser's own transaction still spends the transaction it names and its
 * code, and mints nothing (EARS-62).
 */
export const StorefrontRedeemRequestSchema = z.strictObject({
  client: SignInHostStorefrontSchema,
  txId: z.string().regex(OPAQUE_ID).optional(),
  /** Empty when the callback carried none: it never matches, and the transaction is burnt. */
  state: z.string().max(512),
  code: z.string().min(1).max(2048).optional(),
});
export type StorefrontRedeemRequest = z.infer<
  typeof StorefrontRedeemRequestSchema
>;

/**
 * Every redeem refusal is one `401` with this body: the stored return path,
 * door and kind of the browser's own transaction when it named a live one (so
 * the callback lands on it, EARS-62, and a silent one ends in the guest marker,
 * EARS-63), `null` otherwise. A callback with no transaction cookie whose
 * `state` names a live **silent** transaction (a client that keeps no cookies,
 * EARS-63 (b)) gets that transaction's path and kind too, so it lands on the
 * return path with `ds_guest=1`. Nothing tells which check failed.
 */
export const StorefrontRedeemRefusalSchema = z.object({
  returnPath: z.string().nullable(),
  door: SignInHostDoorSchema.nullable(),
  kind: StorefrontTransactionKindSchema.nullable().default(null),
});
export type StorefrontRedeemRefusal = z.infer<
  typeof StorefrontRedeemRefusalSchema
>;

/**
 * The minted session's principal. The session id travels only in the
 * `Set-Cookie: __Host-ds_session=…` header the storefront server relays; no
 * token is ever in this body (EARS-8). The transaction's return path and door
 * come back with it: the callback lands on the path (the registration door
 * first checks an event target still exists, 021 EARS-20), and the carried
 * эфир registration (005 EARS-2) the callback completes before it answers.
 */
export const StorefrontRedeemResponseSchema = z.strictObject({
  sub: z.string(),
  roles: z.array(z.string()),
  mfa: z.boolean(),
  /** The transaction's stored return path (`null`: the storefront's landing rules). */
  returnPath: z.string().nullable(),
  door: SignInHostDoorSchema,
  /** EARS-63 (b) — a silent transaction's callback also sets the check guard. */
  kind: StorefrontTransactionKindSchema,
  /** 005 EARS-2 — the эфир slug whose registration the callback completes (`null`: none). */
  completeRegistration: z.string().nullable(),
});
export type StorefrontRedeemResponse = z.infer<
  typeof StorefrontRedeemResponseSchema
>;
