// A storefront session for a synthetic account, minted the production way
// (ADR-0015 §4, 003 EARS-8/60/62/64) — the steps a storefront server and the
// sign-in host take, mirrored from `packages/e2e/lib/storefront-session-seed.ts`:
//
// 1. the storefront entry's transaction `POST /v1/internal/oidc/transaction`
//    on the internal credential;
// 2. the IdP's authorize hop, never followed: its `Location` names the auth
//    request the sign-in host form acts on;
// 3. the host form's entry `GET /v1/sign-in-host/entry` (form state + CSRF);
// 4. the host password step `POST /v1/sign-in-host/login`, a same-origin
//    form post of the host origin, which answers the storefront callback URL;
// 5. the storefront callback's redeem `POST /v1/internal/oidc/redeem`, which
//    mints the session cookie.
//
// Every step is a timed sample, so a scenario can record the whole journey.

import { reqEnv, timedFetch } from "./lib.mjs";

/** The `name=value` pairs of every `set-cookie` header of a fetch response. */
export function cookiePairs(headers) {
  const lines = headers?.getSetCookie?.() ?? [];
  const pairs = new Map();
  for (const line of lines) {
    const first = line.split(";", 1)[0] ?? "";
    const at = first.indexOf("=");
    if (at > 0) pairs.set(first.slice(0, at).trim(), first.slice(at + 1));
  }
  return pairs;
}

function cookieHeader(pairs) {
  return [...pairs].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * Sign `email` in through the sign-in host and the storefront callback.
 * Returns every step's timed response and, when all succeeded, the session
 * `Cookie` header (`cookie`); `cookie` is null at the first refused step.
 */
export async function hostSignIn(origin, { email, password, headers }) {
  const token = reqEnv("LOADTEST_INTERNAL_API_TOKEN");
  const hostOrigin = new URL(reqEnv("LOADTEST_SIGN_IN_HOST_ORIGIN")).origin;
  const client = "academy";
  const internal = {
    ...headers,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const steps = [];
  const step = async (url, opts) => {
    const res = await timedFetch(url, opts);
    steps.push(res);
    return res;
  };

  const tx = await step(`${origin}/v1/internal/oidc/transaction`, {
    method: "POST",
    headers: internal,
    body: JSON.stringify({ client, kind: "interactive", door: "login" }),
  });
  if (!tx.ok) return { steps, cookie: null };
  const { txId, authorizeUrl } = JSON.parse(tx.body);

  const authorize = await step(authorizeUrl, { headers, redirect: "manual" });
  const location = authorize.headers?.get("location");
  const authRequest = location
    ? new URL(location).searchParams.get("authRequest")
    : null;
  if (!authRequest) return { steps, cookie: null };

  const entry = await step(
    `${origin}/v1/sign-in-host/entry?authRequest=${encodeURIComponent(authRequest)}`,
    { headers },
  );
  if (!entry.ok) return { steps, cookie: null };
  const form = JSON.parse(entry.body);
  if (form.action !== "render" || !form.csrf) return { steps, cookie: null };

  const login = await step(`${origin}/v1/sign-in-host/login`, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
      origin: hostOrigin,
      "sec-fetch-site": "same-origin",
      cookie: cookieHeader(cookiePairs(entry.headers)),
    },
    body: JSON.stringify({
      identifier: email,
      password,
      authRequest,
      csrf: form.csrf,
    }),
  });
  if (!login.ok) return { steps, cookie: null };
  const answer = JSON.parse(login.body);
  if (answer.status !== "redirect" || !answer.url) {
    return { steps, cookie: null };
  }
  const callback = new URL(answer.url).searchParams;

  const redeem = await step(`${origin}/v1/internal/oidc/redeem`, {
    method: "POST",
    headers: internal,
    body: JSON.stringify({
      client,
      txId,
      state: callback.get("state"),
      code: callback.get("code"),
    }),
  });
  if (!redeem.ok) return { steps, cookie: null };
  const minted = cookiePairs(redeem.headers);
  return { steps, cookie: minted.size > 0 ? cookieHeader(minted) : null };
}
