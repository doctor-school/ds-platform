#!/usr/bin/env node
// DS Platform — load-test harness shared library (Issue #873 phase 1).
//
// Zero-dependency, Node-native (root `engines.node`: ^22.22.2 || ^24.15.0 ||
// >=26.0.0; global `fetch` + global `WebSocket`).
// Everything a scenario needs — env-driven config, a prod-host tripwire, a VU
// ramp runner, a p95/error-rate aggregator, and a compact reporter — lives here
// so the scenario files stay thin and declarative.
//
// CONVENTIONS (recon fact 6): flat `tools/` scripts, NEVER hardcode a host or
// credential — EVERY target/secret is read from a `LOADTEST_*` env var. There is
// no default host: an unset `LOADTEST_API_ORIGIN` is a hard error, not a silent
// fallback to prod. This mirrors tools/deploy/smoke-prod.mjs (documented,
// env-overridable) but inverts its default: a load generator must never point at
// prod by accident.

import { isIP } from "node:net";
import { resolve as resolvePath } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

// --- env + target resolution ----------------------------------------------

/** Read a required env var; throw a pointed error naming it when absent. */
export function reqEnv(name) {
  const v = (process.env[name] ?? "").trim();
  if (!v) {
    throw new Error(
      `missing required env ${name} — every load-test target/credential is env-driven (see tools/loadtest/README.md), nothing is hardcoded`,
    );
  }
  return v;
}

/** Read an optional env var with a fallback default. */
export function optEnv(name, fallback) {
  const v = (process.env[name] ?? "").trim();
  return v || fallback;
}

/** Read an integer env var with a fallback default. */
export function intEnv(name, fallback) {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`env ${name}=${JSON.stringify(raw)} is not an integer`);
  }
  return n;
}

/** Read a float env var with a fallback default. */
export function floatEnv(name, fallback) {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`env ${name}=${JSON.stringify(raw)} is not a number`);
  }
  return n;
}

// Production-target tripwire. The scenarios that load a live room or mutate
// state through the api (room-fanout, auth-burst, the room-behavior verifier)
// run through `productionGate` below, each behind its own explicit confirmation
// env (the verifier behind none), so a production run is never an accident.
// `isProdTarget` decides what production is; it is name-based and fails closed:
//
// • Every name under the `doctor.school` apex is production — the api, the
//   sign-in host `login.`, both storefronts (`new.`, `academy.`), the IdP `id.`
//   and the shared `stage.` slots alike (README «Targets»). A fully qualified
//   name with its trailing root dot (`api.doctor.school.`) is the same host to
//   DNS and TLS, so trailing dots are stripped before the match.
// • Every IP literal is production unless `LOADTEST_NON_PROD_IPS` names it
//   exactly. All production vhosts answer on one box address behind Caddy
//   (infra/deploy/compose/api-prod/Caddyfile), so a bare address reaches
//   production with no doctor.school name for the apex rule to see; an address
//   cannot be told apart by its shape (the dev stand is a private LAN address,
//   a cloud network is private too), so only the operator can vouch for one.
//   The WHATWG URL parser canonicalises alternative IPv4 spellings (`0x…`,
//   a single decimal) and IPv4-mapped IPv6 first, so they cannot dodge it.
// • Loopback (127.0.0.0/8, ::1) is non-production, exactly like `localhost`,
//   which the name rule already treats as non-production: a tunnel from a local
//   port into production is invisible to any host check, which is why the run
//   protocol, not this function, governs tunnels.
// No DNS lookup happens here: a non-doctor.school name that resolves to the
// production box is the operator's configuration, covered by the run protocol.
const PROD_APEX_RE = /(^|\.)doctor\.school$/;

/**
 * The canonical lower-case hostname of a URL/origin or a bare host string:
 * no port, no IPv6 brackets, no trailing root dots. Alternative IPv4 spellings
 * come back as dotted quads (the WHATWG URL host parser).
 */
export function targetHostname(origin) {
  const raw = String(origin ?? "").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  // A bare host ("doctor.school.", "77.233.220.222", "[::1]:3000") is not an
  // absolute URL; parse it as the host of one so it is canonicalised the same way.
  if (!url || !url.hostname) {
    try {
      url = new URL(`http://${raw}`);
    } catch {
      return raw.toLowerCase().replace(/\.+$/, "");
    }
  }
  return url.hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.+$/, "");
}

/** True for a loopback IP literal (127.0.0.0/8, ::1, IPv4-mapped loopback). */
function isLoopbackIp(ip) {
  if (isIP(ip) === 4) return ip.startsWith("127.");
  const v6 = ip.toLowerCase();
  if (v6 === "::1") return true;
  // The URL parser renders ::ffff:127.0.0.1 as ::ffff:7f00:1.
  return /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(v6);
}

/** The exact IP literals `LOADTEST_NON_PROD_IPS` vouches for, canonicalised. */
function nonProdIps(env) {
  const raw = (env.LOADTEST_NON_PROD_IPS ?? "").trim();
  if (!raw) return new Set();
  const ips = new Set();
  for (const entry of raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    // The bare entry itself must be an address: parsing it as a URL first would
    // quietly turn a range like "192.168.1.0/24" into the one host 192.168.1.0.
    if (isIP(entry.replace(/^\[(.*)\]$/, "$1")) === 0) {
      throw new Error(
        `LOADTEST_NON_PROD_IPS entry ${JSON.stringify(entry)} is not an IP literal — ` +
          `the allowlist names exact non-production addresses only (no ranges, no hostnames)`,
      );
    }
    ips.add(targetHostname(entry));
  }
  return ips;
}

/** True when a URL/origin is, or may be, a production host (see above). */
export function isProdTarget(origin, env = process.env) {
  const host = targetHostname(origin);
  if (PROD_APEX_RE.test(host)) return true;
  if (isIP(host) === 0) return false;
  if (isLoopbackIp(host)) return false;
  return !nonProdIps(env).has(host);
}

/**
 * Every env var naming an origin a gated run requests or presents itself as:
 * the api, the storefront whose door and callback a sign-in drives, the sign-in
 * host the password step posts as, and the Centrifugo origin. One list for
 * every gate, so no scenario can leave one of them unchecked: a production
 * value in any of them is a production run.
 */
export const RUN_ORIGIN_ENV = Object.freeze([
  "LOADTEST_API_ORIGIN",
  "LOADTEST_STOREFRONT_ORIGIN",
  "LOADTEST_SIGN_IN_HOST_ORIGIN",
  "LOADTEST_CENTRIFUGO_ORIGIN",
]);

/** The origin of a URL for a refusal message, never its path or query (a callback carries a code). */
function displayOrigin(url) {
  try {
    const { origin } = new URL(String(url).trim());
    if (origin && origin !== "null") return origin;
  } catch {
    // A bare host: fall through to its canonical name.
  }
  return targetHostname(url);
}

/**
 * The one production gate of a gated scenario. Before any request it checks
 * every origin the run will request: each `RUN_ORIGIN_ENV` value that is set,
 * plus `origins` (label → origin) the caller resolved itself. It returns
 * `allowTarget(url, what)`, which the run calls before each request to a URL
 * no env var names — the IdP authorize hop and the storefront callback a
 * sign-in follows, the WebSocket a room grant names — so a server answer
 * cannot route the run into production either.
 *
 * A production target is refused unless `confirmation` names an env var set
 * to exactly `1`; `confirmation: null` refuses production outright. One
 * scenario's confirmation never unlocks another's gate.
 */
export function productionGate(
  { scenario, confirmation = null, refusal, origins = {} },
  env = process.env,
) {
  const confirmed = confirmation !== null && env[confirmation] === "1";
  const allowTarget = (url, what) => {
    if (confirmed || !isProdTarget(url, env)) return;
    throw new Error(
      `REFUSING to run ${scenario} against production target ${what} ` +
        `${JSON.stringify(displayOrigin(url))}: ${refusal}`,
    );
  };
  for (const name of RUN_ORIGIN_ENV) {
    const value = (env[name] ?? "").trim();
    if (value) allowTarget(value, name);
  }
  for (const [what, origin] of Object.entries(origins)) {
    if (origin) allowTarget(origin, what);
  }
  return allowTarget;
}

/**
 * Resolve the api origin (no trailing slash, no `/v1`). Scenarios append the
 * versioned path. Throws when unset — never defaults to a host.
 */
export function apiOrigin() {
  return reqEnv("LOADTEST_API_ORIGIN").replace(/\/+$/, "");
}

// --- HTTP with timing ------------------------------------------------------

/**
 * A single timed HTTP request. Never throws on a non-2xx — a 4xx/5xx is a
 * measured outcome (the caller decides whether it counts as an error), only a
 * transport/timeout failure rejects. Returns { ok, status, ms, body, error }.
 */
export async function timedFetch(url, opts = {}) {
  const t0 = performance.now();
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const body = await res.text();
    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      ms: performance.now() - t0,
      body,
      headers: res.headers,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: performance.now() - t0,
      body: "",
      error: err.name === "AbortError" ? `timeout>${timeoutMs}ms` : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

// --- sample aggregation ----------------------------------------------------

/** Collector for per-request latency + status samples. */
export class Samples {
  constructor() {
    this.latencies = [];
    this.count = 0;
    this.errors = 0;
    this.byStatus = new Map();
  }

  /** Record one request outcome. `isError` overrides the default (status<400 ok). */
  record({ status, ms, isError }) {
    this.count += 1;
    this.latencies.push(ms);
    this.byStatus.set(status, (this.byStatus.get(status) ?? 0) + 1);
    const failed = isError ?? !(status >= 200 && status < 400);
    if (failed) this.errors += 1;
  }

  percentile(p) {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.ceil((p / 100) * sorted.length) - 1,
    );
    return sorted[Math.max(0, idx)];
  }

  get errorRate() {
    return this.count === 0 ? 0 : this.errors / this.count;
  }

  statusLine() {
    return [...this.byStatus.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([s, n]) => `${s || "ERR"}:${n}`)
      .join(" ");
  }
}

// --- VU ramp runner --------------------------------------------------------

/**
 * Run `vus` virtual users, each looping `unit(ctx)` until the steady-state
 * deadline, ramping VU start over `rampSeconds`. `unit` records its own samples
 * on the shared collector it is handed. Returns the collector.
 *
 *   opts: { vus, durationSeconds, rampSeconds, label }
 *   unit: async (ctx) => void   // ctx = { vu, samples, deadline }
 */
export async function runVUs(unit, opts) {
  const {
    vus = 1,
    durationSeconds = 5,
    rampSeconds = 0,
    label = "scenario",
  } = opts;
  const samples = new Samples();
  const startedAt = performance.now();
  const deadline = startedAt + durationSeconds * 1000;
  const rampStepMs = vus > 1 ? (rampSeconds * 1000) / vus : 0;

  console.log(
    `▶ ${label}: vus=${vus} ramp=${rampSeconds}s steady=${durationSeconds}s`,
  );

  const workers = [];
  for (let vu = 0; vu < vus; vu += 1) {
    const startDelay = Math.round(vu * rampStepMs);
    workers.push(
      (async () => {
        if (startDelay > 0) await sleep(startDelay);
        while (performance.now() < deadline) {
          await unit({ vu, samples, deadline });
        }
      })(),
    );
  }
  await Promise.all(workers);
  return samples;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- verdict + report ------------------------------------------------------

/**
 * Print a scenario summary and return an exit code. Fails (1) when p95 exceeds
 * `p95Ms` (when set) or error rate exceeds `errorRate` (when set). A pure smoke
 * run (thresholds unset) reports and passes as long as the transport worked.
 */
export function report(name, samples, { p95Ms, errorRate } = {}) {
  const p50 = samples.percentile(50).toFixed(0);
  const p95 = samples.percentile(95).toFixed(0);
  const p99 = samples.percentile(99).toFixed(0);
  const er = (samples.errorRate * 100).toFixed(1);
  console.log("─".repeat(72));
  console.log(
    `${name}: n=${samples.count} err=${er}% p50=${p50}ms p95=${p95}ms p99=${p99}ms`,
  );
  console.log(`  status: ${samples.statusLine() || "(none)"}`);

  const failures = [];
  if (p95Ms != null && samples.percentile(95) > p95Ms) {
    failures.push(`p95 ${p95}ms > threshold ${p95Ms}ms`);
  }
  if (errorRate != null && samples.errorRate > errorRate) {
    failures.push(
      `error-rate ${er}% > threshold ${(errorRate * 100).toFixed(1)}%`,
    );
  }
  if (samples.count === 0) failures.push("zero requests issued");

  if (failures.length > 0) {
    console.log(`  VERDICT: FAIL — ${failures.join("; ")}`);
    return 1;
  }
  console.log(`  VERDICT: PASS`);
  return 0;
}

/** True when this module's caller was executed directly (not imported). */
export function invokedDirectly(importMetaUrl) {
  const invoked = process.argv[1] ? resolvePath(process.argv[1]) : "";
  return invoked === resolvePath(fileURLToPath(importMetaUrl));
}
