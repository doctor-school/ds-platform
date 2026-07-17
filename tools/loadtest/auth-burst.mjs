#!/usr/bin/env node
// DS Platform — `auth-burst` load scenario (#873 phase 1).
//
// Drives the BFF auth surface under concurrency: register → login loop
// (recon — auth.controller.ts). Two modes, both env-driven:
//   • default: register a fresh synthetic identity, then login.
//   • LOADTEST_USE_PROVISIONED=1: skip register, login the accounts in the
//     provision manifest (login is NOT bot-protected, recon fact 2) — the clean
//     way to measure login capacity without tripping the register bot-gate.
//
// HARD PROD GUARD (fail-closed, tracked as #1068): this scenario REFUSES to run
// against a prod host until `LOADTEST_SUPPRESSION_CONFIRMED=1` is set — because
// synthetic register/verify traffic to prod can dispatch REAL verification
// emails (no per-user delivery-suppression seam exists yet, recon fact 3) and a
// single-source burst measures the rate limiter (per-IP 20/15min, per-ASN
// 100/h, recon fact 2), not capacity. Both are phase-2 owner decisions.
//
//   LOADTEST_API_ORIGIN=http://localhost:3000 LOADTEST_VUS=3 \
//   LOADTEST_DURATION_SECONDS=8 pnpm loadtest:auth

import {
  apiOrigin,
  floatEnv,
  intEnv,
  invokedDirectly,
  isProdTarget,
  optEnv,
  report,
  runVUs,
  timedFetch,
} from "./lib.mjs";
import { syntheticEmail } from "./zitadel.mjs";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SUPPRESSION_ISSUE = "#1068";

/**
 * Fail-closed prod tripwire (exported for the guard test). Throws unless the
 * target is non-prod OR the operator has explicitly confirmed the phase-2
 * suppression decision via LOADTEST_SUPPRESSION_CONFIRMED=1.
 */
export function assertAuthBurstAllowed(origin, env = process.env) {
  if (!isProdTarget(origin)) return;
  if (env.LOADTEST_SUPPRESSION_CONFIRMED === "1") return;
  throw new Error(
    `REFUSING to run auth-burst against prod host ${JSON.stringify(origin)}: ` +
      `synthetic register/verify traffic can dispatch REAL emails and a ` +
      `single-source burst measures the rate limiter, not capacity. No ` +
      `per-user delivery-suppression seam exists yet — tracked as ${SUPPRESSION_ISSUE}. ` +
      `Set LOADTEST_SUPPRESSION_CONFIRMED=1 ONLY after the ${SUPPRESSION_ISSUE} owner ` +
      `decision (suppression seam + rate-limit treatment) is in place for the run window.`,
  );
}

function loadManifestEmails() {
  const path = optEnv(
    "LOADTEST_MANIFEST",
    resolve(process.cwd(), "tools/loadtest/.synthetic-users.json"),
  );
  if (!existsSync(path)) return [];
  const m = JSON.parse(readFileSync(path, "utf8"));
  return (m.users ?? []).map((u) => ({ email: u.email, password: u.password }));
}

async function main() {
  const origin = apiOrigin();
  // Guard FIRST — before any request is issued.
  assertAuthBurstAllowed(origin);

  const domain = optEnv("LOADTEST_SYNTHETIC_DOMAIN", "loadtest.invalid");
  const password = optEnv("LOADTEST_AUTH_PASSWORD", "LoadTest!" + "Passw0rd");
  const useProvisioned = optEnv("LOADTEST_USE_PROVISIONED", "") === "1";
  const pool = useProvisioned ? loadManifestEmails() : [];
  if (useProvisioned && pool.length === 0) {
    throw new Error(
      "LOADTEST_USE_PROVISIONED=1 but the manifest is empty — run `pnpm loadtest:provision` first",
    );
  }

  const opts = {
    vus: intEnv("LOADTEST_VUS", 3),
    durationSeconds: intEnv("LOADTEST_DURATION_SECONDS", 8),
    rampSeconds: intEnv("LOADTEST_RAMP_SECONDS", 0),
    label: `auth-burst (${useProvisioned ? "login-only" : "register+login"})`,
  };

  const samples = await runVUs(async ({ vu, samples }) => {
    let email;
    if (useProvisioned) {
      const cred = pool[(vu + samples.count) % pool.length];
      email = cred.email;
    } else {
      email = syntheticEmail(domain);
      const reg = await timedFetch(`${origin}/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // RegisterRequestSchema: email + password + a consent array
        // (purpose/version) — recon/auth.schema.ts. captchaToken is omitted; the
        // bot gate is exactly the prod wall this scenario's #1068 guard is about.
        body: JSON.stringify({
          email,
          password,
          consent: [{ purpose: "terms", version: "1" }],
        }),
      });
      // 429/403 are the limiter/bot wall (recon fact 2) — a measured outcome,
      // not a transport error. Only 5xx / transport count toward error-rate.
      samples.record({
        status: reg.status,
        ms: reg.ms,
        isError: reg.status >= 500 || reg.status === 0,
      });
    }
    const login = await timedFetch(`${origin}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: email, password }),
    });
    samples.record({
      status: login.status,
      ms: login.ms,
      isError: login.status >= 500 || login.status === 0,
    });
  }, opts);

  console.log(
    `  note: 429=rate-limited 403=bot-gated 401=bad-cred — expected limiter/gate outcomes, not capacity (${SUPPRESSION_ISSUE})`,
  );
  const code = report("auth-burst", samples, {
    p95Ms: intEnv("LOADTEST_P95_MS", 0) || undefined,
    errorRate: floatEnv("LOADTEST_ERROR_RATE", NaN) || undefined,
  });
  process.exit(code);
}

if (invokedDirectly(import.meta.url)) {
  main().catch((err) => {
    console.error(`auth-burst: ${err.message}`);
    process.exit(2);
  });
}
