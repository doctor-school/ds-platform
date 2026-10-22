import {
  SESSION_COOKIE_NAME,
  StorefrontRedeemRefusalSchema,
  StorefrontRedeemResponseSchema,
  StorefrontTransactionResponseSchema,
  forwardedHeaders,
  forwardedSessionFrom,
  parseReturnTarget,
  toStorefrontReturnPath,
  type SignInHostDoor,
  type SignInHostStorefront,
  type StorefrontEntryIntent,
  type StorefrontTransactionRequest,
} from "@ds/schemas";

import type { AuthFlowHostConfig } from "../host-config";
import { resolveHandoffRef } from "../login/login-handoff";
import { resolveOwnHandoff } from "./handoff-ownership";
import { resolveArrivalLanding } from "./landing";
import {
  RETURN_CONTEXT_PARAM,
  isAccountReturnTarget,
  isLandOnlyReturnTarget,
  isRoomReturnTarget,
  readReturnEvent,
  resolveReturnLandingPath,
} from "./return-context";
import { resolveServerAuth } from "./session";
import { isTopLevelNavigation } from "./top-level-navigation";

/**
 * 003 EARS-61 / EARS-62 / EARS-71, ADR-0015 §4 steps 1 and 3 — the
 * storefront half of the sign-in through the sign-in host: the ONE core both
 * storefronts mount (ADR-0013 A1; `apps/portal` and `apps/doctor` add only the
 * thin route files).
 *
 * - **Entry** (`/login`, `/register`, `/reset`, `/verify`): renders no form. It
 *   asks the API for a transaction — `state`, `nonce` and the PKCE verifier are
 *   generated and held by the API; the storefront holds only the opaque id in
 *   the host-only `__Host-ds_oidc_tx` cookie — and answers a `303` to the
 *   authorize URL the API built (the storefront's own `client_id`, its one
 *   `redirect_uri`, `S256`, `response_mode=query`, `prompt=create` for
 *   registration, `login_hint=<intent id>` when the entry carries an intent).
 *   A signed-in browser keeps the existing redirect to its landing (EARS-43/44
 *   baseline), the hand-off link of another account excepted.
 * - **Callback** (`/auth/callback`): `GET` only, never a document. It sends
 *   `{txId, state, code}` to the API's internal redeem (single use, the held
 *   verifier and nonce), clears `__Host-ds_oidc_tx`, relays the API's
 *   `Set-Cookie: __Host-ds_session=…` unchanged and answers `303 <path>#`.
 *
 * The internal API is reached at `INTERNAL_API_URL` with the
 * `INTERNAL_API_TOKEN` bearer, on the compose network only (the public edges
 * and the BFF rewrites refuse `/v1/internal/*`), forwarding the browser's
 * `user-agent`, `accept-language` and `x-forwarded-for` as the BFF does.
 */

/** ADR-0015 §4 step 1 — the host-only transaction cookie. */
export const OIDC_TX_COOKIE = "__Host-ds_oidc_tx";
/** The storefront's one registered `redirect_uri` path (both storefronts). */
export const STOREFRONT_CALLBACK_PATH = "/auth/callback";
/** The interactive transaction's lifetime, mirrored on its cookie. */
const INTERACTIVE_TX_SECONDS = 60 * 60;

/** What a storefront route file names: its OIDC client and its auth-flow host config. */
export interface StorefrontOidcHost {
  readonly client: SignInHostStorefront;
  readonly config: AuthFlowHostConfig;
}

/** The four storefront entries; `/verify` is the registration door's code step. */
export type StorefrontEntry = "login" | "register" | "reset" | "verify";

export interface StorefrontOidcDeps {
  readonly fetchImpl?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

interface InternalApi {
  readonly base: string;
  readonly token: string;
}

function internalApi(
  env: Readonly<Record<string, string | undefined>>,
): InternalApi | null {
  const base = env.INTERNAL_API_URL?.trim();
  const token = env.INTERNAL_API_TOKEN?.trim();
  if (!base || !token) return null;
  return { base: base.replace(/\/$/, ""), token };
}

/** The browser's fingerprint surface and client chain, as the BFF rewrites forward them. */
function internalHeaders(api: InternalApi, request: Headers): HeadersInit {
  const s = forwardedSessionFrom(request);
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${api.token}`,
    ...(s.userAgent ? { "user-agent": s.userAgent } : {}),
    ...(s.acceptLanguage ? { "accept-language": s.acceptLanguage } : {}),
    ...(s.forwardedFor ? { "x-forwarded-for": s.forwardedFor } : {}),
  };
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

function txCookie(value: string, maxAge: number): string {
  return `${OIDC_TX_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/** Every answer of the entry and the callback: a `303`, never cached. */
function seeOther(location: string, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set("location", location);
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 303, headers });
}

function firstOf(raw: string | null): string | undefined {
  return raw ?? undefined;
}

/**
 * The landing a resolved return target earns, as the doors decided it on the
 * storefront before (021 EARS-10, #1987, 006 EARS-6, #2487): the carried
 * target when its эфир still answers or it is an account, room or land-only
 * return; otherwise the storefront's own landing rules.
 */
async function arrivalLanding(
  config: AuthFlowHostConfig,
  returnTo: string | undefined,
  headers: Headers,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const landingTarget = resolveReturnLandingPath(config, returnTo);
  if (!landingTarget) return null;
  if (
    isAccountReturnTarget(config, returnTo) ||
    isRoomReturnTarget(config, returnTo) ||
    isLandOnlyReturnTarget(returnTo)
  ) {
    return landingTarget;
  }
  const read = await readReturnEvent(returnTo, fetchImpl);
  return read && read.status !== "gone" ? landingTarget : null;
}

/**
 * 005 EARS-2 — the эфир whose registration the sign-in completes: a return
 * target that is an event registration intent. An account, room or land-only
 * return lands without registering (014 EARS-6.5, 006 EARS-6, #2487), exactly
 * as the doors' shared completion rule (`@ds/events-storefront`) decides it.
 */
function registrationToComplete(
  config: AuthFlowHostConfig,
  returnTo: string | undefined,
): string | undefined {
  if (
    isAccountReturnTarget(config, returnTo) ||
    isRoomReturnTarget(config, returnTo) ||
    isLandOnlyReturnTarget(returnTo)
  ) {
    return undefined;
  }
  return parseReturnTarget(returnTo)?.eventSlug;
}

/**
 * 005 EARS-2 — `RegisterForEvent` for the carried эфир, with the session the
 * redeem just minted (its cookie, the browser's fingerprint headers and client
 * chain), before the callback answers. Best-effort, as the doors ran it: a
 * refusal or a failure still lands on the event page, where the registered
 * state (EARS-4) or a retry surfaces it; a repeat is an idempotent no-op (EARS-3).
 */
async function completeRegistration(
  api: InternalApi,
  slug: string,
  sessionCookies: readonly string[],
  request: Headers,
  fetchImpl: typeof fetch,
): Promise<void> {
  const sid = sessionCookies
    .map((c) => c.split(";")[0] ?? "")
    .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!sid) return;
  try {
    await fetchImpl(
      `${api.base}/v1/events/${encodeURIComponent(slug)}/registration`,
      {
        method: "POST",
        headers: forwardedHeaders({
          ...forwardedSessionFrom(request),
          cookie: sid,
        }),
        cache: "no-store",
      },
    );
  } catch {
    // Best-effort — the callback still lands on the event page.
  }
}

function doorOf(entry: StorefrontEntry): SignInHostDoor {
  return entry === "verify" ? "register" : entry;
}

/**
 * EARS-71 — the intent an entry records, or `undefined` for the plain form of
 * its door: `?method=code` (with its hand-off reference, EARS-44), the reset
 * door, and an event return target (its slug only).
 */
function entryIntent(
  entry: StorefrontEntry,
  params: URLSearchParams,
  returnTo: string | undefined,
  handoff: string | null,
): StorefrontEntryIntent | undefined {
  const eventTarget = parseReturnTarget(returnTo)?.eventSlug;
  const code = entry === "login" && params.get("method") === "code";
  const intent: StorefrontEntryIntent = {
    ...(code ? { method: "code" as const } : {}),
    ...(code && handoff ? { handoff } : {}),
    ...(eventTarget && entry !== "reset" ? { eventTarget } : {}),
  };
  if (entry === "reset" || Object.keys(intent).length > 0) return intent;
  return undefined;
}

/**
 * 003 EARS-61 / 43 / 44 / 12 / 24 / 71 — a storefront entry. Answers `303`
 * to the authorize URL with a fresh interactive transaction, or the existing
 * signed-in redirect.
 */
export async function storefrontEntry(
  request: Request,
  host: StorefrontOidcHost,
  entry: StorefrontEntry,
  deps: StorefrontOidcDeps = {},
): Promise<Response> {
  // 003 EARS-61 — a transaction is created only when an entry is OPENED: a
  // top-level document `GET`. An RSC / router prefetch of a `<Link>`, a fetch,
  // an XHR or a `HEAD` mints nothing, sets no cookie and calls no API — else
  // every guest page view that renders a «Войти» link would start an IdP auth
  // request and overwrite the in-flight `__Host-ds_oidc_tx` of a real click.
  if (request.method !== "GET" || !isTopLevelNavigation(request.headers)) {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const env = deps.env ?? process.env;
  const { config } = host;
  const url = new URL(request.url);
  const params = url.searchParams;
  const returnTo = firstOf(params.get(RETURN_CONTEXT_PARAM));
  const handoff =
    entry === "login" && params.get("method") === "code"
      ? resolveHandoffRef(params.getAll("handoff"))
      : null;

  // The baseline signed-in redirect (#1955 / #675 / EARS-43): a browser that
  // holds a live storefront session is not sent to a form. The reset entry
  // stays open to it (EARS-28), and a hand-off link the read-only check does
  // not settle as this session's own goes on to the sign-in host (#2951).
  const auth = await resolveServerAuth(request.headers, fetchImpl);
  if (auth.status === "doctor" && entry !== "reset") {
    const own =
      handoff === null ||
      (await resolveOwnHandoff(handoff, request.headers, fetchImpl));
    if (own) {
      const landing =
        (await arrivalLanding(config, returnTo, request.headers, fetchImpl)) ??
        (await resolveArrivalLanding(config, request.headers, fetchImpl));
      return seeOther(landing);
    }
  }

  const api = internalApi(env);
  if (!api)
    throw new Error(
      "storefront entry: INTERNAL_API_URL / INTERNAL_API_TOKEN unset",
    );
  const landingTarget = resolveReturnLandingPath(config, returnTo);
  const intent = entryIntent(entry, params, returnTo, handoff);
  const toRegister = registrationToComplete(config, returnTo);
  const body: StorefrontTransactionRequest = {
    client: host.client,
    kind: "interactive",
    door: doorOf(entry),
    ...(landingTarget
      ? { returnPath: toStorefrontReturnPath(landingTarget) }
      : {}),
    ...(intent ? { intent } : {}),
    ...(toRegister ? { completeRegistration: toRegister } : {}),
  };
  const res = await fetchImpl(`${api.base}/v1/internal/oidc/transaction`, {
    method: "POST",
    headers: internalHeaders(api, request.headers),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`storefront entry: transaction refused (${res.status})`);
  }
  const tx = StorefrontTransactionResponseSchema.parse(await res.json());
  const headers = new Headers();
  headers.append("set-cookie", txCookie(tx.txId, INTERACTIVE_TX_SECONDS));
  // EARS-44 — the entry URL may carry a hand-off reference: it never leaves
  // this response as a Referer, and the redirect replaces the address.
  headers.set("referrer-policy", "no-referrer");
  return seeOther(tx.authorizeUrl, headers);
}

/**
 * 003 EARS-62 — the storefront callback. Every answer is `303 <path>#` with
 * `Cache-Control: no-store`, and `__Host-ds_oidc_tx` is cleared.
 */
export async function storefrontCallback(
  request: Request,
  host: StorefrontOidcHost,
  deps: StorefrontOidcDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const env = deps.env ?? process.env;
  const { config } = host;
  const headers = new Headers();
  headers.append("set-cookie", txCookie("", 0));
  const land = async (
    path: string | null,
    door?: SignInHostDoor | null,
    minted?: { api: InternalApi; slug: string; cookies: readonly string[] },
  ) => {
    let target = path;
    // 021 EARS-20 — a completed registration whose return path is an event
    // page lands there only while the event exists; only a not-found answer
    // replaces it (an ended or full event, or a failed read, keeps it). A
    // carried эфир registration (005 EARS-2) is judged by the same read when
    // the sign-in succeeds (021 EARS-10, #2477): a gone эфир registers nothing.
    let register = minted;
    if (target && (door === "register" || register)) {
      // `null` for a path that is not an event page: nothing to check.
      const read = await readReturnEvent(target, fetchImpl);
      if (read?.status === "gone") {
        target = null;
        register = undefined;
      }
    }
    if (register) {
      await completeRegistration(
        register.api,
        register.slug,
        register.cookies,
        request.headers,
        fetchImpl,
      );
    }
    const to =
      target ??
      (await resolveArrivalLanding(config, request.headers, fetchImpl));
    return seeOther(`${to}#`, headers);
  };

  // A `form_post` callback is refused, its body unread (EARS-62).
  if (request.method !== "GET") return land(null);

  const txId = readCookie(request.headers.get("cookie"), OIDC_TX_COOKIE);
  const api = internalApi(env);
  // No transaction cookie: nothing to redeem from (an unsolicited callback, or
  // a browser that kept no cookie) — nothing is minted.
  if (!txId || !api) return land(null);

  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  let res: Response;
  try {
    res = await fetchImpl(`${api.base}/v1/internal/oidc/redeem`, {
      method: "POST",
      headers: internalHeaders(api, request.headers),
      body: JSON.stringify({
        client: host.client,
        txId,
        state: (params.get("state") ?? "").slice(0, 512),
        // An OIDC `error` answer carries no code: the redeem only spends the
        // transaction and returns where it started.
        ...(code && !params.has("error") ? { code } : {}),
      }),
      cache: "no-store",
    });
  } catch {
    return land(null);
  }
  if (res.ok) {
    const minted = StorefrontRedeemResponseSchema.safeParse(await res.json());
    const cookies = res.headers.getSetCookie();
    if (!minted.success || cookies.length === 0) return land(null);
    // The API's session cookie, byte for byte (a fresh sid, ADR-0015 §4 req. 5).
    for (const c of cookies) headers.append("set-cookie", c);
    const returnPath = minted.data.returnPath
      ? toStorefrontReturnPath(minted.data.returnPath)
      : null;
    const slug = minted.data.completeRegistration;
    return land(
      returnPath,
      minted.data.door,
      // The registration completes only on the event page it lands on.
      slug && returnPath ? { api, slug, cookies } : undefined,
    );
  }
  // A refusal lands on the browser's own transaction's path, when it named one.
  if (res.status === 401) {
    const refusal = StorefrontRedeemRefusalSchema.safeParse(
      await res.json().catch(() => null),
    );
    if (!refusal.success || refusal.data.door === null) {
      // No live transaction (past its 60 minutes, or already used): nothing
      // is minted and the landing rules decide, as a guest.
      // 003 EARS-62 silent recovery: S5 #3173
      return land(null);
    }
    const path = refusal.data.returnPath;
    return land(path ? toStorefrontReturnPath(path) : null);
  }
  // 429 (the callback's own limit, req. 9) and every other failure.
  return land(null);
}
