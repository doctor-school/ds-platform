import {
  request as playwrightRequest,
  type APIResponse,
} from "@playwright/test";

import {
  AUTH_REQUEST_PARAM,
  SIGN_IN_HOST_API_ROOT,
  signInHostApiPath,
} from "./sign-in-host-api.js";

/**
 * A storefront session for a tier that runs NO storefront and NO sign-in host
 * app (the admin tier, #3565): the very steps a storefront server and the
 * sign-in host take in production (ADR-0015 §4, 003 EARS-60/61/62/64), sent
 * from a Playwright `APIRequestContext` against the stand's real IdP and API:
 *
 * 1. the storefront entry's transaction — `POST /v1/internal/oidc/transaction`
 *    on the internal credential (`INTERNAL_API_URL` / `INTERNAL_API_TOKEN`,
 *    the storefront servers' own env names);
 * 2. the IdP's authorize hop, never followed: its `Location` is the sign-in
 *    host form and names the auth request;
 * 3. the host form's entry `GET /v1/sign-in-host/entry` (form state + CSRF);
 * 4. the host password step `POST /v1/sign-in-host/login` as a same-origin
 *    form post of the host origin (`IDP_SIGN_IN_BASE_URI`), which finalises
 *    the auth request and answers the storefront callback URL;
 * 5. the storefront callback's redeem `POST /v1/internal/oidc/redeem` with
 *    the callback's `code` and `state`, which mints the session cookie.
 *
 * The session is bound to the fingerprint of the requests that minted it, so
 * the caller passes the `user-agent` / `accept-language` the browser that will
 * carry the cookie sends. Browser tiers with a storefront use
 * `signInPageThroughHost` (`./host-sign-in.ts`) instead.
 */

export interface StorefrontSessionSeedInput {
  readonly email: string;
  readonly password: string;
  /** The headers of the browser that will carry the cookie (the session fingerprint). */
  readonly fingerprint: {
    readonly userAgent: string;
    readonly acceptLanguage: string;
  };
  /** The storefront client the session belongs to; the Academy by default. */
  readonly client?: "academy" | "doctor";
}

export interface StorefrontSessionCookie {
  readonly name: string;
  readonly value: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`storefront session seed requires ${name}`);
  return value;
}

/** `name=value` of every `set-cookie` header of `response`, attributes dropped. */
export function setCookiePairs(
  headers: readonly { name: string; value: string }[],
): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const { name, value } of headers) {
    if (name.toLowerCase() !== "set-cookie") continue;
    for (const line of value.split("\n")) {
      const first = line.split(";")[0] ?? "";
      const at = first.indexOf("=");
      if (at <= 0) continue;
      pairs.set(first.slice(0, at).trim(), first.slice(at + 1).trim());
    }
  }
  return pairs;
}

/** The auth request the IdP's authorize answer hands the sign-in host. */
export function authRequestOf(location: string | undefined): string {
  const id = location
    ? new URL(location).searchParams.get(AUTH_REQUEST_PARAM)
    : null;
  if (!id) {
    throw new Error(
      `the IdP authorize hop named no sign-in host auth request (Location ${location ?? "absent"})`,
    );
  }
  return id;
}

/** The `code` and `state` of the storefront callback URL the host step answers. */
export function callbackParams(url: string): { code: string; state: string } {
  const params = new URL(url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    throw new Error(
      `the sign-in host answered no callback code/state (${url})`,
    );
  }
  return { code, state };
}

async function expectOk(step: string, res: APIResponse): Promise<void> {
  if (!res.ok()) {
    throw new Error(`${step}: HTTP ${res.status()} ${await res.text()}`);
  }
}

/**
 * Sign the CONFIRMED account `email` in through the sign-in host and return
 * the storefront session cookie the redeem minted.
 */
export async function seedStorefrontSession(
  input: StorefrontSessionSeedInput,
): Promise<StorefrontSessionCookie> {
  const api = required("INTERNAL_API_URL").replace(/\/$/, "");
  const token = required("INTERNAL_API_TOKEN");
  const hostOrigin = new URL(required("IDP_SIGN_IN_BASE_URI")).origin;
  const client = input.client ?? "academy";
  const browserHeaders = {
    "user-agent": input.fingerprint.userAgent,
    "accept-language": input.fingerprint.acceptLanguage,
  };
  const internal = {
    ...browserHeaders,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  // No jar: every cookie a step needs is named on the request, so nothing a
  // context would keep (or drop as `Secure` on plain http) decides the steps.
  const ctx = await playwrightRequest.newContext();
  try {
    const tx = await ctx.post(`${api}/v1/internal/oidc/transaction`, {
      headers: internal,
      data: { client, kind: "interactive", door: "login" },
    });
    await expectOk("storefront transaction", tx);
    const { txId, authorizeUrl } = (await tx.json()) as {
      txId: string;
      authorizeUrl: string;
    };

    const authorize = await ctx.get(authorizeUrl, {
      headers: browserHeaders,
      maxRedirects: 0,
    });
    const authRequest = authRequestOf(authorize.headers()["location"]);

    const entry = await ctx.get(
      `${api}${SIGN_IN_HOST_API_ROOT}/entry?${AUTH_REQUEST_PARAM}=${encodeURIComponent(authRequest)}`,
      { headers: browserHeaders },
    );
    await expectOk("sign-in host entry", entry);
    const form = (await entry.json()) as { action: string; csrf?: string };
    if (form.action !== "render" || !form.csrf) {
      throw new Error(
        `sign-in host entry did not render a form: ${JSON.stringify(form)}`,
      );
    }
    const formCookies = setCookiePairs(entry.headersArray());

    const login = await ctx.post(
      `${api}${signInHostApiPath("/v1/auth/login")}`,
      {
        headers: {
          ...browserHeaders,
          "content-type": "application/json",
          origin: hostOrigin,
          "sec-fetch-site": "same-origin",
          cookie: [...formCookies].map(([n, v]) => `${n}=${v}`).join("; "),
        },
        data: {
          identifier: input.email,
          password: input.password,
          authRequest,
          csrf: form.csrf,
        },
      },
    );
    await expectOk("sign-in host password step", login);
    const step = (await login.json()) as { status: string; url?: string };
    if (step.status !== "redirect" || !step.url) {
      throw new Error(`sign-in host password step: ${JSON.stringify(step)}`);
    }

    const { code, state } = callbackParams(step.url);
    const redeem = await ctx.post(`${api}/v1/internal/oidc/redeem`, {
      headers: internal,
      data: { client, txId, state, code },
    });
    await expectOk("storefront redeem", redeem);
    const minted = [...setCookiePairs(redeem.headersArray())];
    const session = minted.find(([name]) => name.endsWith("ds_session"));
    if (!session) throw new Error("storefront redeem set no session cookie");
    return { name: session[0], value: session[1] };
  } finally {
    await ctx.dispose();
  }
}
