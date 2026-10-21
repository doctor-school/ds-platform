#!/usr/bin/env node
// DS Platform — per-session dev-server port prober (#428, extended to the
// two-storefront triple in #1440 and the sign-in host in #3170).
//
// Why: api/portal/doctor/login default to 3000/3001/3004/3005, which is the SINGLE-session
// default — with parallel sessions on one box, a second session booting the same
// ports tears down (or trips over) the first session's live-verify / Stage-B URL.
// The standing convention (#425, `.claude/rules/dev-stand.md`) is: parallel →
// probe the next free set and NEVER kill listeners you did not start. This is
// the deterministic helper for that probe.
//
// Usage:
//   pnpm dev:ports            # prints the first free set as env lines + URLs
//   pnpm dev:ports --json     # {"api":3100,"portal":3101,"doctor":3104,"login":3105}
//
// The probe BINDS each candidate port (net.createServer().listen) and releases
// it immediately — real availability, no netstat parsing, cross-platform. A
// port that is bound by anyone (another session's server included) simply
// skips the whole set; nothing is inspected or killed. The probe→boot race
// window is accepted: ms-scale on a single dev box, and the "kill only YOUR OWN
// stale listeners" rule covers misfires.

import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// ── pure seams (unit-tested in tools/lint/guard-tests) ──────────────────────

/**
 * Offsets from a set's base port. The two storefronts of ADR-0015 and the
 * sign-in host (`apps/login`, ADR-0015 §4) each need a dev server, so a session
 * claims FOUR ports.
 *
 * `doctor` is +4, not the contiguous +2: `@ds/showcase` and `@ds/academy-demo`
 * hold fixed dev ports 3002 and 3003, so a contiguous triple would collide with
 * them in the single-session default set. +4 keeps the default set (3000, 3001,
 * 3004) collision-free while every later set stays visually one block. `login`
 * takes the next free offset, +5 (default 3005 — the dev sign-in host origin the
 * IdP provisioning registers as IDP_SIGN_IN_BASE_URI).
 */
export const PORT_OFFSETS = { api: 0, portal: 1, doctor: 4, login: 5 };

/**
 * The candidate (api, portal, doctor, login) sets, single-session default
 * first, stepping by 100 so each session's set is visually distinct:
 * (3000,3001,3004,3005) … (3900,3901,3904,3905).
 */
export function portSetSequence() {
  const sets = [];
  for (let base = 3000; base <= 3900; base += 100) {
    sets.push([
      base + PORT_OFFSETS.api,
      base + PORT_OFFSETS.portal,
      base + PORT_OFFSETS.doctor,
      base + PORT_OFFSETS.login,
    ]);
  }
  return sets;
}

/**
 * First set whose ALL ports probe free, or null when the whole range is taken.
 * `probe(port) → Promise<boolean>` is injected for testability.
 */
export async function firstFreePortSet(sets, probe) {
  for (const set of sets) {
    let free = true;
    for (const port of set) {
      if (!(await probe(port))) {
        free = false;
        break;
      }
    }
    if (free) return set;
  }
  return null;
}

/**
 * Session-log labels + the REAL wiring: every app consumes `PORT` (api via
 * apps/api/src/main.ts, the Next apps via next dev/start), so the boot lines
 * below are what actually binds the set — API_PORT/PORTAL_PORT/DOCTOR_PORT/
 * LOGIN_PORT are handoff labels only.
 */
export function formatPortSet([api, portal, doctor, login]) {
  return [
    `API_PORT=${api}`,
    `PORTAL_PORT=${portal}`,
    `DOCTOR_PORT=${doctor}`,
    `LOGIN_PORT=${login}`,
    `# boot api:    PORT=${api} pnpm --filter @ds/api start   → http://localhost:${api}`,
    `# boot portal: PORT=${portal} pnpm --filter @ds/portal start → http://localhost:${portal}`,
    `# boot doctor: PORT=${doctor} pnpm --filter @ds/doctor start → http://localhost:${doctor}`,
    `# boot login:  PORT=${login} pnpm --filter @ds/login start  → http://localhost:${login}`,
  ];
}

/**
 * Real probe: try to bind the port on the unspecified host (what Next/Nest
 * bind by default), release immediately. `false` on EADDRINUSE/EACCES.
 */
export function probePortFree(port) {
  return new Promise((resolveProbe) => {
    const srv = createServer();
    srv.once("error", () => resolveProbe(false));
    srv.listen(port, () => srv.close(() => resolveProbe(true)));
  });
}

// ── impure CLI (skipped on import) ──────────────────────────────────────────

async function main() {
  const json = process.argv.includes("--json");
  const set = await firstFreePortSet(portSetSequence(), probePortFree);
  if (!set) {
    console.error(
      "dev:ports: no free (api, portal, doctor, login) set in 3000-3905 — the box is " +
        "saturated; finish or hand back a session before booting another.",
    );
    process.exit(1);
  }
  if (json) {
    console.log(
      JSON.stringify({
        api: set[0],
        portal: set[1],
        doctor: set[2],
        login: set[3],
      }),
    );
  } else {
    for (const line of formatPortSet(set)) console.log(line);
  }
}

const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF) {
  await main();
}
