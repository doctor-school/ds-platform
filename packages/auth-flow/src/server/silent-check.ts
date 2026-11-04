import {
  STOREFRONT_SILENT_TRANSACTION_SECONDS,
  StorefrontTransactionResponseSchema,
  toStorefrontReturnPath,
  type SignInHostStorefront,
  type StorefrontSilentCheckRequest,
} from "@ds/schemas";

import type { AuthFlowHostConfig } from "../host-config";
import {
  OIDC_TX_COOKIE,
  internalApi,
  internalHeaders,
  readCookie,
  type InternalApi,
} from "./oidc-internal";
import { resolveServerAuth } from "./session";
import { isTopLevelNavigation } from "./top-level-navigation";

/**
 * 003 EARS-63, ADR-0015 §4 step 4 / req. 9, 12 — the server-side silent check
 * on the other storefront: the ONE core both storefronts mount (ADR-0013 A1;
 * `apps/portal/middleware.ts` and `apps/doctor/proxy.ts` only call it).
 *
 * A checkable request — a top-level document `GET` with no live storefront
 * session, no valid guest marker, no check guard and no live silent
 * transaction — is answered, before anything renders and before the page
 * cache answers, with a `303` into a silent transaction (`prompt=none`) whose
 * return path is the request's path and query (`ds_guest` removed). The
 * callback (`storefrontCallback`) then mints the session, or sets the marker
 * and lands on the return path as a guest; either outcome sets the guard, so
 * one navigation makes at most one check.
 *
 * The marker and the silent transaction's cookie are signed with a server
 * HMAC keyed by the storefront server's internal credential
 * (`INTERNAL_API_TOKEN`), so a cookie a script plants suppresses nothing.
 */

/** EARS-63 (a) — «checked, signed out»: `<issued-at seconds>.<HMAC>`, 10 minutes. */
export const GUEST_MARKER_COOKIE = "__Host-ds_guest";
/** EARS-63 (b) — the one-shot loop guard every silent callback outcome sets, 60 s. */
export const CHECK_GUARD_COOKIE = "__Host-ds_check";
/** EARS-63 (b) — the one-shot query flag of a client that keeps no cookies. */
export const GUEST_QUERY_FLAG = "ds_guest";

const MARKER_SECONDS = 10 * 60;
const GUARD_SECONDS = 60;
/** A marker issued this far in the future is a forgery or a broken clock: ignored. */
const MARKER_SKEW_SECONDS = 60;

const MARKER_LABEL = "ds-platform/storefront/guest-marker/v1";
const SILENT_TX_LABEL = "ds-platform/storefront/silent-tx/v1";
const OPAQUE_ID = /^[A-Za-z0-9_-]{43}$/;

function hostCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function base64url(bytes: ArrayBuffer): string {
  let raw = "";
  for (const b of new Uint8Array(bytes)) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mac(secret: string, label: string, payload: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${label}\n${payload}`)),
  );
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** EARS-63 (a) — a fresh marker cookie, issued at `nowMs`. */
export async function guestMarkerCookie(
  secret: string,
  nowMs: number,
): Promise<string> {
  const issued = String(Math.floor(nowMs / 1000));
  const sig = await mac(secret, MARKER_LABEL, issued);
  return hostCookie(GUEST_MARKER_COOKIE, `${issued}.${sig}`, MARKER_SECONDS);
}

/** EARS-63 (a) — deleted by every callback that mints a session. */
export function clearedGuestMarkerCookie(): string {
  return hostCookie(GUEST_MARKER_COOKIE, "", 0);
}

/** EARS-63 (b) — set by every silent callback outcome. */
export function checkGuardCookie(): string {
  return hostCookie(CHECK_GUARD_COOKIE, "1", GUARD_SECONDS);
}

function clearedCheckGuardCookie(): string {
  return hostCookie(CHECK_GUARD_COOKIE, "", 0);
}

/**
 * EARS-63 (a) — a marker counts only when its HMAC verifies and it is at most
 * 10 minutes old: a marker a script plants (without `HttpOnly`, with any
 * lifetime) suppresses nothing.
 */
export async function hasValidGuestMarker(
  cookieHeader: string | null,
  secret: string,
  nowMs: number,
): Promise<boolean> {
  const value = readCookie(cookieHeader, GUEST_MARKER_COOKIE);
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const issued = value.slice(0, dot);
  if (!/^\d{1,12}$/.test(issued)) return false;
  const age = Math.floor(nowMs / 1000) - Number(issued);
  if (age > MARKER_SECONDS || age < -MARKER_SKEW_SECONDS) return false;
  return sameText(
    value.slice(dot + 1),
    await mac(secret, MARKER_LABEL, issued),
  );
}

/** The browser's `__Host-ds_oidc_tx`: its transaction id, and whether it names a silent one. */
export interface TransactionCookie {
  readonly txId: string;
  readonly silent: boolean;
}

/**
 * The silent transaction's cookie value: `<txId>.<HMAC>`, so the middleware
 * tells a live silent transaction (which holds the check back) from an
 * interactive one (which never does, EARS-63 (c)) without asking the API, and
 * a planted value holds nothing back.
 */
export async function silentTransactionCookieValue(
  secret: string,
  txId: string,
): Promise<string> {
  return `${txId}.${await mac(secret, SILENT_TX_LABEL, txId)}`;
}

export async function readTransactionCookie(
  cookieHeader: string | null,
  name: string,
  secret: string | null,
): Promise<TransactionCookie | null> {
  const value = readCookie(cookieHeader, name);
  if (!value) return null;
  const dot = value.indexOf(".");
  const txId = dot === -1 ? value : value.slice(0, dot);
  if (!OPAQUE_ID.test(txId)) return null;
  const silent =
    dot !== -1 &&
    secret !== null &&
    sameText(value.slice(dot + 1), await mac(secret, SILENT_TX_LABEL, txId));
  return { txId, silent };
}

/**
 * ADR-0015 §4 step 4 «Crawlers» — the maintained search-crawler list. Every
 * Yandex robot announces itself as `compatible; Yandex<Name>` or
 * `compatible; Ya<Name>` (Yandex Webmaster, «robots' User-Agents»); the Yandex
 * app (`YandexSearch/…`) and Yandex Browser (`YaBrowser/…`) never carry the
 * `compatible;` token, so they stay visitors.
 */
const SEARCH_CRAWLER =
  /compatible; ?ya(?:ndex)?[a-z]+|googlebot|google-inspectiontool|googleother|adsbot-google|mediapartners-google|bingbot|bingpreview|msnbot|duckduckbot|baiduspider|slurp|applebot|petalbot|seznambot|sogou|mail\.ru_bot|exabot|qwantify/i;

/**
 * EARS-63 (d) / (e) — why a request may not start a check at all, or `null`
 * when it may. Exempt: a non-`GET`; no top-level-document fetch metadata
 * (which also covers a client without fetch metadata); a Next.js router
 * request; `/v1/*`; static assets; `/.well-known/*`; the storefront's own auth
 * routes; the health route; a search crawler; the one-shot `ds_guest=1`
 * return. A speculative load (prefetch or prerender, see `isSpeculativeLoad`)
 * is NOT exempt: the browser may show it as the navigation.
 */
export type SilentCheckExemption =
  "not-navigation" | "router" | "crawler" | "guest-return" | "route";

export function silentCheckExemption(
  request: Request,
  config: AuthFlowHostConfig,
): SilentCheckExemption | null {
  const h = request.headers;
  if (request.method !== "GET" || !isTopLevelNavigation(h)) {
    return "not-navigation";
  }
  if (
    h.has("rsc") ||
    h.has("next-router-prefetch") ||
    h.has("next-router-state-tree")
  ) {
    return "router";
  }
  if (SEARCH_CRAWLER.test(h.get("user-agent") ?? "")) return "crawler";
  const url = new URL(request.url);
  if (url.searchParams.has(GUEST_QUERY_FLAG)) return "guest-return";
  const path = url.pathname;
  const last = path.slice(path.lastIndexOf("/") + 1);
  const authRoutes = [
    config.routes.login,
    config.routes.register,
    config.routes.verify,
    config.routes.reset,
  ];
  return path.startsWith("/v1/") ||
    path === "/v1" ||
    path.startsWith("/_next/") ||
    path.startsWith("/.well-known/") ||
    path.startsWith("/auth/") ||
    path === "/healthz" ||
    last.includes(".") ||
    authRoutes.includes(path)
    ? "route"
    : null;
}

export function isSilentCheckCandidate(
  request: Request,
  config: AuthFlowHostConfig,
): boolean {
  return silentCheckExemption(request, config) === null;
}

/**
 * The headers a browser marks a speculative load with: the standard
 * `Sec-Purpose` (`prefetch`, `prefetch;prerender`,
 * `prefetch;anonymous-client-ip`), Chromium's legacy `Purpose: prefetch` (sent
 * beside `Sec-Purpose` until Chrome 139, and still by forks that lag it) and
 * Firefox's `X-Moz: prefetch` (only ever on a `<link rel=prefetch>` hint, which
 * stops at `not-navigation` before this).
 *
 * Safari's address-bar preload (`X-Purpose: preview`) is deliberately NOT one:
 * nothing shows that Safari discards a non-2xx preload rather than displaying
 * it, so a 503 could put a blank page in front of a real navigation. It goes
 * through the normal check, as it always has.
 */
const SPECULATION_HEADERS = ["sec-purpose", "purpose", "x-moz"];
const SPECULATION_VALUE = /prefetch|prerender/i;

/**
 * EARS-63 (d) — a speculative load of a document: a prerender (the address bar,
 * speculation rules) renders it in a hidden page the browser later ACTIVATES
 * as the navigation, and a navigational prefetch (speculation rules) keeps the
 * response and serves it as the navigation — either way with no new request.
 * A guest page loaded that way unchecked would be shown as the person's
 * navigation and the check would never run (#3660). Whichever header carries
 * the mark, and whatever else is also present, it decides the same way.
 */
function isSpeculativeLoad(headers: Headers): boolean {
  return SPECULATION_HEADERS.some((name) =>
    SPECULATION_VALUE.test(headers.get(name) ?? ""),
  );
}

/** The return path of a check: the request's path and query, `ds_guest` removed (req. 1). */
function checkReturnPath(request: Request): string {
  const url = new URL(request.url);
  url.searchParams.delete(GUEST_QUERY_FLAG);
  return toStorefrontReturnPath(`${url.pathname}${url.search}`);
}

/**
 * EARS-63 / EARS-62 recovery — a fresh silent transaction (its own per-IP
 * bucket, req. 9). `null` when the API refused or failed it: the caller ends
 * as a guest, never as an error document.
 */
export async function startSilentTransaction(
  api: InternalApi,
  client: SignInHostStorefront,
  request: Headers,
  returnPath: string | undefined,
  fetchImpl: typeof fetch,
  replaces?: string,
): Promise<{ authorizeUrl: string; cookieValue: string } | null> {
  const body: StorefrontSilentCheckRequest = {
    client,
    ...(returnPath ? { returnPath } : {}),
    ...(replaces ? { replaces } : {}),
  };
  try {
    const res = await fetchImpl(`${api.base}/v1/internal/oidc/silent-check`, {
      method: "POST",
      headers: internalHeaders(api, request),
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const tx = StorefrontTransactionResponseSchema.safeParse(await res.json());
    if (!tx.success) return null;
    return {
      authorizeUrl: tx.data.authorizeUrl,
      cookieValue: await silentTransactionCookieValue(api.token, tx.data.txId),
    };
  } catch {
    return null;
  }
}

/** The silent transaction's cookie (its ≈60 s lifetime). */
export function silentTransactionCookie(name: string, value: string): string {
  return hostCookie(name, value, STOREFRONT_SILENT_TRANSACTION_SECONDS);
}

/**
 * What the host does with the request: answer it with `response` (the check
 * redirect), or let it render and append `setCookies` to that response.
 */
export type SilentCheckOutcome =
  { readonly response: Response } | { readonly setCookies: readonly string[] };

export interface SilentCheckHost {
  readonly client: SignInHostStorefront;
  readonly config: AuthFlowHostConfig;
}

export interface SilentCheckDeps {
  readonly fetchImpl?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => number;
  /** One line per decision (default `console.info`); never personal data. */
  readonly log?: (line: string) => void;
}

const RENDER: SilentCheckOutcome = { setCookies: [] };

/**
 * EARS-63 (d) — the answer to a checkable speculative load: a non-2xx, which
 * makes the browser discard it (a prerender activates, and a prefetch is
 * served, only on a 2xx), so the person's real navigation reaches this proxy
 * and runs the check. It starts no transaction and sets no cookie: a load the
 * person never opens costs nothing, and leaves no silent-transaction cookie
 * that would hold the real navigation's check back. These 503s are expected
 * traffic: a 5xx alert must exclude requests carrying a speculation header.
 */
function speculativeLoadRefusal(): Response {
  return new Response(null, {
    status: 503,
    headers: { "cache-control": "no-store", "retry-after": "0" },
  });
}

/**
 * 003 EARS-63 — the storefront middleware / proxy step. Runs on every request
 * the host's matcher sends it; decides before the page cache answers.
 */
export async function storefrontSilentCheck(
  request: Request,
  host: SilentCheckHost,
  deps: SilentCheckDeps = {},
): Promise<SilentCheckOutcome> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const decided = (outcome: string, result: SilentCheckOutcome) => {
    log(`[silent-check] client=${host.client} outcome=${outcome}`);
    return result;
  };
  const exemption = silentCheckExemption(request, host.config);
  // A request that is not a document navigation is never in question: no line.
  if (exemption === "not-navigation") return RENDER;
  if (exemption) return decided(`not-candidate reason=${exemption}`, RENDER);
  const env = deps.env ?? process.env;
  const api = internalApi(env);
  // Without the internal credential no check can start (and no marker can be
  // verified): every page renders as it does for any signed-out visitor.
  if (!api) return decided("no-credential", RENDER);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? Date.now)();
  const cookies = request.headers.get("cookie");

  // EARS-63 (b) — the first document request carrying the guard deletes it;
  // without a session it renders the guest page and sets the marker, never a
  // second check.
  if (readCookie(cookies, CHECK_GUARD_COOKIE) !== null) {
    const auth = await resolveServerAuth(request.headers, fetchImpl);
    return decided("guard", {
      setCookies:
        auth.status === "doctor"
          ? [clearedCheckGuardCookie()]
          : [
              clearedCheckGuardCookie(),
              await guestMarkerCookie(api.token, now),
            ],
    });
  }
  if (await hasValidGuestMarker(cookies, api.token, now)) {
    return decided("marker", RENDER);
  }
  const tx = await readTransactionCookie(cookies, OIDC_TX_COOKIE, api.token);
  if (tx?.silent) return decided("tx", RENDER);
  const auth = await resolveServerAuth(request.headers, fetchImpl);
  if (auth.status === "doctor") return decided("session", RENDER);

  // EARS-63 (d) — a checkable speculative load is never shown as a guest page.
  if (isSpeculativeLoad(request.headers)) {
    return decided("speculative", { response: speculativeLoadRefusal() });
  }

  // EARS-63 (c) — a live interactive transaction never holds the check back:
  // the silent one replaces it in the cookie, and its callback finds nothing.
  const started = await startSilentTransaction(
    api,
    host.client,
    request.headers,
    checkReturnPath(request),
    fetchImpl,
    tx?.txId,
  );
  // EARS-63 (f) — a limited (or failed) start renders the guest page itself.
  if (!started) return decided("limited", RENDER);
  const headers = new Headers();
  headers.append(
    "set-cookie",
    silentTransactionCookie(OIDC_TX_COOKIE, started.cookieValue),
  );
  headers.set("location", started.authorizeUrl);
  // EARS-63 (g) — the check redirect is never cached.
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  return decided("303", {
    response: new Response(null, { status: 303, headers }),
  });
}
