#!/usr/bin/env node
// DS Platform — `auth-burst` load scenario (#873 phase 1).
//
// Drives the BFF auth surface under concurrency: register → sign-in loop, the
// sign-in being the storefront journey through the sign-in host
// (`host-sign-in.mjs`). Two modes, both env-driven:
//   • default: register a fresh synthetic identity, then sign in.
//   • LOADTEST_USE_PROVISIONED=1: skip register, sign in the accounts in the
//     provision manifest (the password step is NOT bot-protected, recon fact 2)
//     — the clean way to measure sign-in capacity without tripping the
//     register bot-gate.
//
// HARD PROD GUARD (fail-closed, lib.mjs `productionGate`): this scenario
// REFUSES to run when any origin it requests is production — the api, the
// storefront and sign-in host its sign-in drives, the Centrifugo origin, or a
// URL a sign-in follows from a server answer (the IdP authorize hop, the
// storefront callback) — until `LOADTEST_SUPPRESSION_CONFIRMED=1` is set. Why:
// register traffic dispatches REAL mail unless the api runs with
// `LOADTEST_SUPPRESS_SYNTHETIC=true` (the #1068 seam drops
// `LOADTEST_SYNTHETIC_DOMAIN` recipients before the relay), and a single-source
// burst measures the rate limiter, not capacity: the verification and sending
// doors (20 failures / 60 sends per IP per 15 min, env-raisable in the window)
// and the fixed 1200 / 15 min sign-in entry and redeem scopes (README «Rate
// limits a single-source run meets»).
//
//   LOADTEST_API_ORIGIN=http://localhost:3000 LOADTEST_VUS=3 \
//   LOADTEST_DURATION_SECONDS=8 pnpm loadtest:auth

import {
  apiOrigin,
  floatEnv,
  intEnv,
  invokedDirectly,
  optEnv,
  productionGate,
  report,
  runVUs,
  timedFetch,
} from "./lib.mjs";
import { hostSignIn } from "./host-sign-in.mjs";
import { syntheticEmail } from "./zitadel.mjs";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SUPPRESSION_ISSUE = "#1068";

/** One stable browser fingerprint: the session binds to it (003 EARS-64). */
const SIGN_IN_HEADERS = {
  "user-agent": "ds-auth-burst/1",
  "accept-language": "en-US",
};

/**
 * Fail-closed prod tripwire (exported for the guard test). Throws unless every
 * origin the run requests (`origin` plus every lib.mjs `RUN_ORIGIN_ENV` value)
 * is non-prod OR the operator has explicitly confirmed the phase-2 suppression
 * decision via LOADTEST_SUPPRESSION_CONFIRMED=1. Returns the run's
 * `allowTarget` check for the URLs a sign-in follows from server answers.
 */
export function assertAuthBurstAllowed(origin, env = process.env) {
  return productionGate(
    {
      scenario: "auth-burst",
      confirmation: "LOADTEST_SUPPRESSION_CONFIRMED",
      refusal:
        `synthetic register/code traffic dispatches REAL mail unless the api runs ` +
        `with LOADTEST_SUPPRESS_SYNTHETIC=true (${SUPPRESSION_ISSUE}), and a ` +
        `single-source burst measures the rate limiter, not capacity. Set ` +
        `LOADTEST_SUPPRESSION_CONFIRMED=1 ONLY inside the owner-approved run window, ` +
        `after the window prerequisites (suppression on, per-IP raise applied) are ` +
        `in place on the api (tools/loadtest/README.md «Rate-limit window recipe»).`,
      origins: { LOADTEST_API_ORIGIN: origin },
    },
    env,
  );
}

function loadManifestEmails() {
  const path = optEnv(
    "LOADTEST_MANIFEST",
    resolve(process.cwd(), "tools/loadtest/.synthetic-users.json"),
  );
  if (!existsSync(path)) return [];
  const m = JSON.parse(readFileSync(path, "utf8"));
  return (m.users ?? [])
    .filter((u) => u.usable !== false)
    .map((u) => ({ email: u.email, password: u.password }));
}

async function main() {
  const origin = apiOrigin();
  // Guard FIRST — before any request is issued.
  const allowTarget = assertAuthBurstAllowed(origin);

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
    // The sign-in the storefronts run: every step of the host journey is a
    // sample — the storefront door (internal transport: the transaction), the
    // authorize hop, the host entry, the password step, and the storefront
    // callback (internal transport: the redeem).
    const { steps } = await hostSignIn(origin, {
      email,
      password,
      headers: SIGN_IN_HEADERS,
      allowTarget,
    });
    for (const step of steps) {
      samples.record({
        status: step.status,
        ms: step.ms,
        isError: step.status >= 500 || step.status === 0,
      });
    }
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
