#!/usr/bin/env node
// DS Platform — load-test harness shared library (Issue #873 phase 1).
//
// Zero-dependency, Node-native (Node >=22: global `fetch` + global `WebSocket`).
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

// Prod-host tripwire. A single-source burst against prod measures the rate
// limiter, not capacity (recon fact 2 — per-IP 20/15min, per-ASN 100/h), and
// synthetic prod auth traffic can trip real delivery/suppression seams that do
// not exist yet (Issue #1068). So any scenario that MUTATES prod state gates on
// this. Match is deliberately broad: the public prod origins all live under the
// `doctor.school` apex (AGENTS.md §1), so a substring test cannot be dodged by a
// staging subdomain typo.
const PROD_HOST_RE = /(^|\.)doctor\.school$/i;

/** True when a URL/origin resolves to a live prod host. */
export function isProdTarget(origin) {
  let host;
  try {
    host = new URL(origin).host.split(":")[0];
  } catch {
    // Not a URL — treat a bare "doctor.school" string as prod too.
    host = String(origin).trim();
  }
  return PROD_HOST_RE.test(host);
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
    failures.push(`error-rate ${er}% > threshold ${(errorRate * 100).toFixed(1)}%`);
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
