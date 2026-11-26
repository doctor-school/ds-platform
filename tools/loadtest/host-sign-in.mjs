// A storefront session for a synthetic account, minted the production way
// (ADR-0015 §4, 003 EARS-8/60/61/62/64) — the steps a storefront server and
// the sign-in host take:
//
// 1. the storefront entry's transaction and authorize URL;
// 2. the IdP's authorize hop, never followed: its `Location` names the auth
//    request the sign-in host form acts on;
// 3. the host form's entry `GET /v1/sign-in-host/entry` (form state + CSRF);
// 4. the host password step `POST /v1/sign-in-host/login`, a same-origin
//    form post of the host origin, which answers the storefront callback URL;
// 5. the storefront callback's redeem, which mints the session cookie.
//
// Steps 1 and 5 are storefront-server legs and run over one of two transports
// (`signInTransport`):
// • storefront (LOADTEST_STOREFRONT_ORIGIN set) — the browser's own journey:
//   the storefront door `GET /login` opened as a document (303 + the
//   transaction cookie) and the callback URL the password step answers (303 +
//   the session cookie). Nothing internal is called, so this is the transport
//   a production run uses.
// • internal (unset) — the storefront server's calls themselves,
//   `POST /v1/internal/oidc/transaction` and `/redeem` on the internal
//   credential, mirrored from `packages/e2e/lib/storefront-session-seed.ts`;
//   reachable only where the api is reached directly (the dev stand), never on
//   a public production host.
//
// Every step is a timed sample, so a scenario can record the whole journey.

import { isProdTarget, reqEnv, timedFetch } from "./lib.mjs";

/** The storefront door both storefronts serve (auth-flow host configs `routes.login`). */
const STOREFRONT_LOGIN_PATH = "/login";
/** The session cookie the API mints (ADR-0015 §4 req. 5). */
const SESSION_COOKIE = "__Host-ds_session";

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

/** A browser's top-level document navigation (003 EARS-61 opens a door only for one). */
function navigationHeaders(headers, site) {
  return {
    ...headers,
    accept: "text/html",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
    "sec-fetch-site": site,
  };
}

/**
 * Which transport runs the storefront-server legs (transaction + redeem):
 * `storefront` — the storefront's own public door and callback; `internal` —
 * the api's internal endpoints on the internal credential (stand only). Throws
 * when the internal transport would aim at a production target: every public
 * production vhost answers 404 for `/v1/internal/*`
 * (infra/deploy/compose/api-prod/Caddyfile `internal_api_unreachable`), so the
 * run would only measure 404s.
 */
export function signInTransport(origin, env = process.env) {
  if ((env.LOADTEST_STOREFRONT_ORIGIN ?? "").trim()) return "storefront";
  if (isProdTarget(origin, env)) {
    throw new Error(
      `sign-in against production target ${JSON.stringify(origin)} needs ` +
        `LOADTEST_STOREFRONT_ORIGIN (the storefront that mints the session, e.g. the ` +
        `doctor storefront): the internal transaction/redeem endpoints answer 404 on ` +
        `every public production host (tools/loadtest/README.md «Targets»)`,
    );
  }
  return "internal";
}

/**
 * Sign `email` in through the sign-in host and the storefront callback.
 * Returns every step's timed response and, when all succeeded, the session
 * `Cookie` header (`cookie`); `cookie` is null at the first refused step.
 */
export async function hostSignIn(origin, { email, password, headers }) {
  const transport = signInTransport(origin);
  const hostOrigin = new URL(reqEnv("LOADTEST_SIGN_IN_HOST_ORIGIN")).origin;
  const steps = [];
  const step = async (url, opts) => {
    const res = await timedFetch(url, opts);
    steps.push(res);
    return res;
  };

  // Step 1 — the transaction and the authorize URL.
  let authorizeUrl;
  let txId = null;
  let txCookies = new Map();
  let internal = null;
  const client = "academy";
  if (transport === "storefront") {
    // The storefront door, opened as a document: 303 to the IdP authorize URL
    // with the host-only transaction cookie (003 EARS-61).
    const storefront = new URL(reqEnv("LOADTEST_STOREFRONT_ORIGIN")).origin;
    const door = await step(`${storefront}${STOREFRONT_LOGIN_PATH}`, {
      headers: navigationHeaders(headers, "none"),
      redirect: "manual",
    });
    authorizeUrl = door.status === 303 ? door.headers?.get("location") : null;
    txCookies = cookiePairs(door.headers);
    if (!authorizeUrl) return { steps, cookie: null };
  } else {
    internal = {
      ...headers,
      authorization: `Bearer ${reqEnv("LOADTEST_INTERNAL_API_TOKEN")}`,
      "content-type": "application/json",
    };
    const tx = await step(`${origin}/v1/internal/oidc/transaction`, {
      method: "POST",
      headers: internal,
      body: JSON.stringify({ client, kind: "interactive", door: "login" }),
    });
    if (!tx.ok) return { steps, cookie: null };
    ({ txId, authorizeUrl } = JSON.parse(tx.body));
  }

  // Step 2 — the IdP's authorize hop, never followed: its `Location` names the
  // auth request the sign-in host form acts on.
  const authorize = await step(authorizeUrl, { headers, redirect: "manual" });
  const location = authorize.headers?.get("location");
  const authRequest = location
    ? new URL(location).searchParams.get("authRequest")
    : null;
  if (!authRequest) return { steps, cookie: null };

  // Steps 3–4 — the host form's entry and its password step.
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

  // Step 5 — the storefront callback redeems the code and mints the session.
  if (transport === "storefront") {
    // The browser follows the answer to the storefront callback (003 EARS-62):
    // the storefront server redeems with the cookie's transaction and answers
    // 303 with the API's session cookie.
    const callback = await step(answer.url, {
      headers: {
        ...navigationHeaders(headers, "cross-site"),
        cookie: cookieHeader(txCookies),
      },
      redirect: "manual",
    });
    const session = cookiePairs(callback.headers).get(SESSION_COOKIE);
    if (callback.status !== 303 || !session) return { steps, cookie: null };
    return { steps, cookie: `${SESSION_COOKIE}=${session}` };
  }
  const params = new URL(answer.url).searchParams;
  const redeem = await step(`${origin}/v1/internal/oidc/redeem`, {
    method: "POST",
    headers: internal,
    body: JSON.stringify({
      client,
      txId,
      state: params.get("state"),
      code: params.get("code"),
    }),
  });
  if (!redeem.ok) return { steps, cookie: null };
  const minted = cookiePairs(redeem.headers);
  return { steps, cookie: minted.size > 0 ? cookieHeader(minted) : null };
}
