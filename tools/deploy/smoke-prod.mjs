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
//   portal GET https://app.doctor.school/             → < 500 (Next renders)
//   admin  GET https://admin.doctor.school/           → < 500 (Next renders; #729)
//   chat   GET https://api.doctor.school/connection/websocket → < 500 (Caddy →
//          centrifugo route alive; a non-upgrade GET draws Centrifugo's 400,
//          while a down/unrouted centrifugo surfaces Caddy's 502; #729)
//   login  GET https://id.doctor.school/ui/v2/login   → < 400 (Zitadel Login V2)
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

import https from "node:https";
import tls from "node:tls";

const PROBE_TIMEOUT_MS = 15000;
// Minimum cert lifetime we tolerate. Caddy auto-renews ~30d out, so anything
// under this floor signals a stuck ACME renewal worth paging on.
const TLS_MIN_DAYS = 7;

const API_HOST = process.env.PROD_API_HOST || "api.doctor.school";
const PORTAL_HOST = process.env.PROD_PORTAL_HOST || "app.doctor.school";
const ADMIN_HOST = process.env.PROD_ADMIN_HOST || "admin.doctor.school";
const ID_HOST = process.env.PROD_ID_HOST || "id.doctor.school";

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
  const res = await httpsGet(`https://${PORTAL_HOST}/`);
  if (res.status >= 500) throw new Error(`/ → ${res.status}`);
  return `${res.status} (< 500 — Next renders)`;
}

async function probeLogin() {
  // Probe the actual login ENTRY screen, not the bare base path: the api-prod
  // Caddyfile routes `/ui/v2/login/*` (sub-paths) to the login container, so a
  // bare `/ui/v2/login` (no sub-path) falls through to Zitadel core and 404s —
  // `/ui/v2/login/loginname` is the real first screen (username entry) and 200s.
  const res = await httpsGet(`https://${ID_HOST}/ui/v2/login/loginname`);
  if (res.status >= 400)
    throw new Error(`/ui/v2/login/loginname → ${res.status}`);
  return `${res.status} (Zitadel Login V2 — loginname screen)`;
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
  ["admin /", probeAdmin],
  ["chat ws route", probeChatRoute],
  ["login /ui/v2/login", probeLogin],
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
  for (const [name, fn] of PROBES) {
    const t0 = Date.now();
    try {
      const detail = await withTimeout(fn(), PROBE_TIMEOUT_MS);
      console.log(
        `  PASS  ${name.padEnd(20)} ${String(Date.now() - t0).padStart(5)}ms  ${detail}`,
      );
    } catch (err) {
      failed += 1;
      console.log(
        `  FAIL  ${name.padEnd(20)} ${String(Date.now() - t0).padStart(5)}ms  ${err.message}`,
      );
    }
  }
  console.log("─".repeat(72));
  console.log(
    failed === 0
      ? `all ${PROBES.length} prod probes green`
      : `${failed}/${PROBES.length} prod probe(s) FAILED`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`smoke-prod: unexpected error — ${err.stack || err.message}`);
  process.exit(3);
});
