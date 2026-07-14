#!/usr/bin/env node
// DS Platform — PROD smoke test (DSO-128). Fork of the dev-stand smoke
// (tools/dev/smoke.mjs) retargeted at the live public prod origins.
//
// Unlike the dev smoke — which probes internal LAN service ports read from a
// personal `.env.local` — this drives the FOUR public prod hostnames end to
// end, over real TLS, exactly as a browser / the api's callers reach them:
//
//   api    GET https://api.doctor.school/v1/health   → 200 + status:"ok" (+ SHA)
//          GET https://api.doctor.school/v1/ready     → 200 + postgres+pgvector ok
//   portal GET https://app.doctor.school/             → follows redirects; final
//          page < 500 AND no Next error-boundary markup (#866)
//          GET https://app.doctor.school/login        → COLD (cookie-less) 200 +
//          Next app-shell RSC stream, no error boundary (#866/#885: the portal
//          login form is CLIENT-rendered, so assert the server-streamed shell —
//          not <input>, which only exists post-hydration)
//   admin  GET https://admin.doctor.school/           → < 500 (Next renders; #729)
//   chat   GET https://api.doctor.school/connection/websocket → < 500 (Caddy →
//          centrifugo route alive; a non-upgrade GET draws Centrifugo's 400,
//          while a down/unrouted centrifugo surfaces Caddy's 502; #729)
//   login  GET https://id.doctor.school/ui/v2/login/loginname → COLD 200 + real
//          form markup, no error boundary. Status alone is NOT trusted: Next
//          streams RSC pages, so a server-side exception renders the production
//          error boundary AFTER the 200 status line is already committed —
//          exactly how the wave-1 PAT outage (#866: unreadable service token →
//          every cookie-less login broken for 9 days) stayed green under the
//          old `status < 400` probe.
//   login  flow: GET /oauth/v2/authorize?client_id=… → 302 into /ui/v2/login/…
//          → COLD 200 login screen (the per-visitor flow-initiation path that
//          500'd in #866). Needs the PUBLIC OIDC client id — set
//          PROD_IDP_CLIENT_ID (api.env IDP_CLIENT_ID; not a secret, it rides
//          every browser authorize URL); the probe prints SKIP when unset.
//   TLS    api. / app. / admin. / id.doctor.school    → cert valid, not near expiry
//
// The prod hostnames ARE the contract here (Caddy vhosts + Beget A-records +
// the deploy design spec) — not a per-developer recipe — so they are the
// documented defaults, overridable via env for a staging clone.
//
// Usage:
//   node tools/deploy/smoke-prod.mjs                 (exit 0 = green; non-zero = a probe failed)
//   node tools/deploy/smoke-prod.mjs --expect-sha <sha>   also assert /v1/health version === <sha>
//
// Invoked by `pnpm deploy:prod` after `up -d`; a red smoke fails the deploy loud.

import { createHash, randomBytes } from "node:crypto";
import https from "node:https";
import { resolve as resolvePath } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const PROBE_TIMEOUT_MS = 15000;
// Minimum cert lifetime we tolerate. Caddy auto-renews ~30d out, so anything
// under this floor signals a stuck ACME renewal worth paging on.
const TLS_MIN_DAYS = 7;

const API_HOST = process.env.PROD_API_HOST || "api.doctor.school";
const PORTAL_HOST = process.env.PROD_PORTAL_HOST || "app.doctor.school";
const ADMIN_HOST = process.env.PROD_ADMIN_HOST || "admin.doctor.school";
const ID_HOST = process.env.PROD_ID_HOST || "id.doctor.school";
// PUBLIC OIDC client id (api.env IDP_CLIENT_ID — visible in every browser
// authorize URL, NOT a credential). Opt-in: enables the full cookie-less
// authorize→login flow probe; unset ⇒ that one probe prints SKIP.
const IDP_CLIENT_ID = (process.env.PROD_IDP_CLIENT_ID || "").trim();
// Must match an OIDC redirect URI registered by provision.sh (deploy README
// step 9 registers https://<api>/auth/callback).
const IDP_REDIRECT_URI =
  process.env.PROD_IDP_REDIRECT_URI || `https://${API_HOST}/auth/callback`;

// --expect-sha <sha> (or EXPECT_DEPLOY_SHA) — assert the live build matches.
function parseExpectSha() {
  const i = process.argv.indexOf("--expect-sha");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1].trim();
  return (process.env.EXPECT_DEPLOY_SHA || "").trim() || null;
}
const EXPECT_SHA = parseExpectSha();

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: "GET", headers: { "User-Agent": "ds-smoke-prod" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(PROBE_TIMEOUT_MS, () =>
      req.destroy(new Error("socket timeout")),
    );
    req.end();
  });
}

// Cookie-less redirect follower (bounded). Every hop is a fresh request with
// no cookie jar — deliberately: the #866 outage only hit visitors WITHOUT a
// Zitadel session cookie, so a probe that accumulated cookies would drift
// back toward the warm path that stayed green through the outage.
async function httpsGetFollow(url, maxHops = 5) {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const res = await httpsGet(current);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      const next = new URL(res.headers.location, current);
      if (next.protocol !== "https:")
        throw new Error(`redirect left https: ${next.href.slice(0, 120)}`);
      current = next.href;
      continue;
    }
    return { ...res, url: current, hops: hop };
  }
  throw new Error(`more than ${maxHops} redirects from ${url}`);
}

// --- cold-surface page classification (#866; exported for unit tests) ------
//
// Next.js App Router streams RSC pages: when a server component throws in
// production, the 200 status line is already committed and the built-in error
// boundary ("Application error: a server-side exception has occurred …" +
// "Digest: <hash>") is rendered INTO the 200 body. `status < 400` therefore
// proves nothing about a cold surface — assert on the body: no error-boundary
// marker, and the real page markup actually present.

export const COLD_ERROR_MARKERS = [
  // Next.js production error boundary (App Router), all versions/wordings
  // share this prefix ("… has occurred", Next ≥15 appends "while loading <host>").
  "Application error: a server-side exception",
  // Its digest line — also covers a bare boundary body with rephrased copy.
  "Digest:",
  // The raw api/gateway 500 JSON the #866 outage served on flow initiation.
  "Internal server error",
];

export function findColdErrorMarker(body) {
  return COLD_ERROR_MARKERS.find((m) => body.includes(m)) ?? null;
}

// Throws unless `res` is a real, successfully rendered cold page: exact 200,
// no error-boundary marker, and (when given) the expected page markup present.
//
// `requireMarkup` is a single token OR a list of tokens that must ALL be present
// in the body. A server-rendered surface (the Zitadel-hosted login) asserts the
// literal form field "<input"; a CLIENT-rendered Next surface (the portal /login,
// #885) asserts a server-streamed app-shell signal instead — its <input> fields
// are drawn only after hydration, so requiring "<input" false-positives on a
// perfectly healthy cold page. The error-boundary markers above keep the #866
// teeth either way: a blank/degraded/proxy-error body carries none of the
// required markup and still fails.
export function checkColdPage(res, { requireMarkup = "<input" } = {}) {
  const where = res.url ? ` (${res.url})` : "";
  if (res.status !== 200)
    throw new Error(`→ ${res.status}${where} (expected 200)`);
  const marker = findColdErrorMarker(res.body);
  if (marker)
    throw new Error(
      `error page served WITH status 200${where} — body contains ${JSON.stringify(marker)}`,
    );
  const needed = Array.isArray(requireMarkup) ? requireMarkup : [requireMarkup];
  for (const token of needed) {
    if (token && !res.body.includes(token))
      throw new Error(
        `200${where} but expected markup ${JSON.stringify(token)} missing (${res.body.length} bytes) — blank/degraded render`,
      );
  }
}

// A probe may throw this to report SKIP (visible, but not a failure).
class SkipProbe extends Error {}

// --- probes ---------------------------------------------------------------

async function probeApiHealth() {
  const res = await httpsGet(`https://${API_HOST}/v1/health`);
  if (res.status !== 200) throw new Error(`/v1/health → ${res.status}`);
  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new Error(`/v1/health body is not JSON: ${res.body.slice(0, 120)}`);
  }
  if (json.status !== "ok") throw new Error(`status=${json.status}`);
  const shown = json.version ? ` · version=${json.version}` : " · version=(unset)";
  if (EXPECT_SHA) {
    // With --expect-sha the version MUST be present AND match. `main` carries
    // the /v1/health `version` field since #481, so an ABSENT version means
    // the deployed build is NOT the expected code — exactly the silent
    // no-op-build failure this assertion exists to catch (DSO-127 rework: a
    // transitional warn-on-absent mode masked a deploy that never rebuilt).
    if (json.version !== EXPECT_SHA) {
      throw new Error(
        `WRONG build live: version=${json.version ?? "(absent)"} !== expected ${EXPECT_SHA}`,
      );
    }
    return `200 · status=ok · version matches ${EXPECT_SHA}`;
  }
  return `200 · status=ok${shown}`;
}

async function probeApiReady() {
  const res = await httpsGet(`https://${API_HOST}/v1/ready`);
  if (res.status !== 200) throw new Error(`/v1/ready → ${res.status} (unready)`);
  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new Error(`/v1/ready body is not JSON: ${res.body.slice(0, 120)}`);
  }
  if (json.checks?.postgres !== "ok")
    throw new Error(`postgres=${json.checks?.postgres}`);
  if (json.checks?.pgvector !== "ok")
    throw new Error(`pgvector=${json.checks?.pgvector}`);
  return `200 · postgres=ok · pgvector=ok`;
}

async function probePortal() {
  // Cold entry: `/` redirects anonymous visitors onward (e.g. → /webinars) —
  // follow it and require the FINAL page to be a real render: < 500 and no
  // Next error-boundary markup in the body (#866: an error boundary streams
  // out with status 200, so status alone is a green proxy, not the surface).
  const res = await httpsGetFollow(`https://${PORTAL_HOST}/`);
  if (res.status >= 500) throw new Error(`/ → ${res.status}`);
  const marker = findColdErrorMarker(res.body);
  if (marker)
    throw new Error(
      `/ → ${res.status} but body contains ${JSON.stringify(marker)}`,
    );
  return `${res.status} after ${res.hops} redirect(s) (real render, no error boundary)`;
}

async function probePortalLoginCold() {
  // The portal's own cold login entry (#866): cookie-less GET /login must be
  // a REAL render — exact 200, no error boundary. UNLIKE the Zitadel-hosted
  // login (server-rendered, <input> in the raw HTML), the portal /login form is
  // CLIENT-rendered: Next.js streams the App-Router shell and the fields hydrate
  // client-side, so the raw cold HTML carries no <input> (#885 — asserting it
  // false-positived on a healthy page). Assert the server-present signal that
  // IS in the cold body: the RSC flight stream (`self.__next_f`), proof the
  // portal app server-rendered a real page. A blank/degraded/proxy-error render
  // carries no __next_f (and an error boundary trips the markers) — #866 holds.
  const res = await httpsGetFollow(`https://${PORTAL_HOST}/login`);
  checkColdPage(res, { requireMarkup: "self.__next_f" });
  return `200 · Next app-shell RSC stream · no error boundary (cookie-less, client-rendered)`;
}

async function probeLoginCold() {
  // Probe the actual login ENTRY screen, not the bare base path: the api-prod
  // Caddyfile routes `/ui/v2/login/*` (sub-paths) to the login container, so a
  // bare `/ui/v2/login` (no sub-path) falls through to Zitadel core and 404s —
  // `/ui/v2/login/loginname` is the real first screen (username entry).
  //
  // #866: this fetch is cookie-less BY DESIGN and asserts the BODY, not the
  // status. With the service PAT unreadable (600 root:root vs container uid
  // 1001) the login container served error pages to every cookie-less visitor
  // for 9 days while the old `status < 400` check stayed green.
  const res = await httpsGetFollow(`https://${ID_HOST}/ui/v2/login/loginname`);
  checkColdPage(res);
  return `200 · loginname form markup · no error boundary (cookie-less)`;
}

async function probeLoginColdFlow() {
  // The FULL per-visitor flow-initiation path that 500'd in #866:
  // /oauth/v2/authorize (Zitadel core mints an authRequest) → 302 into
  // /ui/v2/login/… where the login container, cookie-less, initiates the flow
  // via its service token — the first hop that dies when the PAT is
  // unreadable. Needs the public client id; SKIP (loudly) when unset.
  if (!IDP_CLIENT_ID)
    throw new SkipProbe(
      "set PROD_IDP_CLIENT_ID (public IDP_CLIENT_ID from api.env) to drive the authorize→login flow",
    );
  // Send a PKCE challenge unconditionally — legal for any client type, and we
  // never exchange the code, so no verifier/credential is needed.
  const challenge = createHash("sha256")
    .update(randomBytes(32).toString("base64url"))
    .digest("base64url");
  const authorize =
    `https://${ID_HOST}/oauth/v2/authorize?` +
    new URLSearchParams({
      client_id: IDP_CLIENT_ID,
      redirect_uri: IDP_REDIRECT_URI,
      response_type: "code",
      scope: "openid",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
  const first = await httpsGet(authorize);
  if (first.status < 300 || first.status >= 400)
    throw new Error(
      `authorize → ${first.status} (expected a 3xx into the hosted login)`,
    );
  const location = new URL(first.headers.location || "", authorize);
  if (!location.pathname.includes("/ui/v2/login/"))
    throw new Error(
      `authorize redirected outside the hosted login: ${location.href.slice(0, 140)}`,
    );
  const res = await httpsGetFollow(location.href);
  checkColdPage(res);
  return `authorize → 302 → 200 login screen after ${res.hops} hop(s) (cookie-less flow init OK)`;
}

function probeTls(host) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: PROBE_TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          reject(new Error("no peer certificate"));
          return;
        }
        const notAfter = new Date(cert.valid_to).getTime();
        const days = Math.floor((notAfter - Date.now()) / 86_400_000);
        if (Number.isNaN(notAfter)) {
          reject(new Error(`unparseable notAfter ${cert.valid_to}`));
          return;
        }
        if (days < TLS_MIN_DAYS) {
          reject(
            new Error(`cert expires in ${days}d (< ${TLS_MIN_DAYS}d floor)`),
          );
          return;
        }
        resolve(`valid · expires in ${days}d (${cert.valid_to})`);
      },
    );
    socket.on("error", reject);
    socket.setTimeout(PROBE_TIMEOUT_MS, () =>
      socket.destroy(new Error("tls timeout")),
    );
  });
}

// --- runner ---------------------------------------------------------------

async function probeAdmin() {
  const res = await httpsGet(`https://${ADMIN_HOST}/`);
  if (res.status >= 500) throw new Error(`/ → ${res.status}`);
  return `${res.status} (admin renders)`;
}

// The Caddy → centrifugo route (#729): a plain GET (no websocket upgrade) draws
// Centrifugo's own 400, so any < 500 proves the container is up AND routed;
// 502 = centrifugo down; 404 = the Caddy handle block is missing.
async function probeChatRoute() {
  const res = await httpsGet(`https://${API_HOST}/connection/websocket`);
  if (res.status >= 500 || res.status === 404)
    throw new Error(`/connection/websocket → ${res.status}`);
  return `${res.status} (centrifugo routed; 400 = expected non-upgrade reply)`;
}

const PROBES = [
  ["api /v1/health", probeApiHealth],
  ["api /v1/ready", probeApiReady],
  ["portal /", probePortal],
  ["portal /login cold", probePortalLoginCold],
  ["admin /", probeAdmin],
  ["chat ws route", probeChatRoute],
  ["login cold loginname", probeLoginCold],
  ["login cold flow", probeLoginColdFlow],
  [`TLS ${API_HOST}`, () => probeTls(API_HOST)],
  [`TLS ${PORTAL_HOST}`, () => probeTls(PORTAL_HOST)],
  [`TLS ${ADMIN_HOST}`, () => probeTls(ADMIN_HOST)],
  [`TLS ${ID_HOST}`, () => probeTls(ID_HOST)],
];

function withTimeout(promise, ms) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function main() {
  console.log(
    `prod smoke — api=${API_HOST} portal=${PORTAL_HOST} admin=${ADMIN_HOST} id=${ID_HOST}` +
      (EXPECT_SHA ? ` — expect-sha=${EXPECT_SHA}` : "") +
      ` — ${new Date().toISOString()}`,
  );
  console.log("─".repeat(72));
  let failed = 0;
  let skipped = 0;
  for (const [name, fn] of PROBES) {
    const t0 = Date.now();
    try {
      const detail = await withTimeout(fn(), PROBE_TIMEOUT_MS);
      console.log(
        `  PASS  ${name.padEnd(21)} ${String(Date.now() - t0).padStart(5)}ms  ${detail}`,
      );
    } catch (err) {
      if (err instanceof SkipProbe) {
        skipped += 1;
        console.log(
          `  SKIP  ${name.padEnd(21)} ${String(Date.now() - t0).padStart(5)}ms  ${err.message}`,
        );
        continue;
      }
      failed += 1;
      console.log(
        `  FAIL  ${name.padEnd(21)} ${String(Date.now() - t0).padStart(5)}ms  ${err.message}`,
      );
    }
  }
  console.log("─".repeat(72));
  const skipNote = skipped > 0 ? ` (${skipped} skipped)` : "";
  console.log(
    failed === 0
      ? `all ${PROBES.length - skipped} prod probes green${skipNote}`
      : `${failed}/${PROBES.length} prod probe(s) FAILED${skipNote}`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

// Import-safe (the cold-page checkers above are unit-tested): only run the
// probes when executed directly, mirroring tools/dev/port-pair.mjs.
const INVOKED = process.argv[1] ? resolvePath(process.argv[1]) : "";
const SELF = resolvePath(fileURLToPath(import.meta.url));
if (INVOKED === SELF) {
  main().catch((err) => {
    console.error(`smoke-prod: unexpected error — ${err.stack || err.message}`);
    process.exit(3);
  });
}
