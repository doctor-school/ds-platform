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

/**
 * 003 EARS-61, ADR-0015 §4 req. 1 — whether `value` is an acceptable return
 * path: same-origin path and query only — starts with `/`, not `//` or `/\`,
 * no control character, within {@link STOREFRONT_RETURN_PATH_MAX}.
 */
export function isStorefrontReturnPath(value: string): boolean {
  return (
    value.length <= STOREFRONT_RETURN_PATH_MAX &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\") &&
    !CONTROL.test(value)
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
 * named by `__Host-ds_oidc_tx`, the callback's `state` and `code` (absent for
 * an OIDC `error` answer, which only spends the transaction). The API takes
 * the transaction single-use, checks `state` against it, and redeems with its
 * held verifier and nonce at the storefront's one registered callback URI.
 */
export const StorefrontRedeemRequestSchema = z.strictObject({
  client: SignInHostStorefrontSchema,
  txId: z.string().regex(OPAQUE_ID),
  /** Empty when the callback carried none: it never matches, and the transaction is burnt. */
  state: z.string().max(512),
  code: z.string().min(1).max(2048).optional(),
});
export type StorefrontRedeemRequest = z.infer<
  typeof StorefrontRedeemRequestSchema
>;

/**
 * Every redeem refusal is one `401` with this body: the stored return path
 * and door of the browser's own transaction when it named a live one (so the
 * callback lands on it, EARS-62), `null` otherwise. Nothing tells which check
 * failed.
 */
export const StorefrontRedeemRefusalSchema = z.object({
  returnPath: z.string().nullable(),
  door: SignInHostDoorSchema.nullable(),
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
  /** 005 EARS-2 — the эфир slug whose registration the callback completes (`null`: none). */
  completeRegistration: z.string().nullable(),
});
export type StorefrontRedeemResponse = z.infer<
  typeof StorefrontRedeemResponseSchema
>;
