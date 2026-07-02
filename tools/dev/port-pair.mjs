#!/usr/bin/env node
// DS Platform — per-session dev-server port pair prober (#428).
//
// Why: api/portal default to 3000/3001, which is the SINGLE-session default —
// with parallel sessions on one box, a second session booting the same pair
// tears down (or trips over) the first session's live-verify / Stage-B URL.
// The standing convention (#425, `.claude/rules/dev-stand.md`) is: parallel →
// probe the next free pair and NEVER kill listeners you did not start. This is
// the deterministic helper for that probe.
//
// Usage:
//   pnpm dev:ports            # prints the first free pair as env lines + URLs
//   pnpm dev:ports --json     # {"api":3100,"portal":3101} for tooling
//
// The probe BINDS each candidate port (net.createServer().listen) and releases
// it immediately — real availability, no netstat parsing, cross-platform. A
// port that is bound by anyone (another session's server included) simply
// skips the pair; nothing is inspected or killed. The probe→boot race window
// is accepted: ms-scale on a single dev box, and the "kill only YOUR OWN stale
// listeners" rule covers misfires.

import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// ── pure seams (unit-tested in tools/lint/guard-tests) ──────────────────────

/**
 * The candidate (api, portal) pairs, single-session default first, stepping by
 * 100 so each session's pair is visually distinct: (3000,3001) … (3900,3901).
 */
export function pairSequence() {
  const pairs = [];
  for (let base = 3000; base <= 3900; base += 100) pairs.push([base, base + 1]);
  return pairs;
}

/**
 * First pair whose BOTH ports probe free, or null when the whole range is
 * taken. `probe(port) → Promise<boolean>` is injected for testability.
 */
export async function firstFreePair(pairs, probe) {
  for (const pair of pairs) {
    if ((await probe(pair[0])) && (await probe(pair[1]))) return pair;
  }
  return null;
}

/**
 * Session-log labels + the REAL wiring: both apps consume `PORT` (api via
 * apps/api/src/main.ts, portal via next dev/start), so the boot lines below are
 * what actually binds the pair — API_PORT/PORTAL_PORT are handoff labels only.
 */
export function formatPair([api, portal]) {
  return [
    `API_PORT=${api}`,
    `PORTAL_PORT=${portal}`,
    `# boot api:    PORT=${api} pnpm --filter @ds/api start   → http://localhost:${api}`,
    `# boot portal: PORT=${portal} pnpm --filter @ds/portal start → http://localhost:${portal}`,
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
  const pair = await firstFreePair(pairSequence(), probePortFree);
  if (!pair) {
    console.error(
      "dev:ports: no free (api, portal) pair in 3000-3901 — the box is saturated; " +
        "finish or hand back a session before booting another.",
    );
    process.exit(1);
  }
  if (json) {
    console.log(JSON.stringify({ api: pair[0], portal: pair[1] }));
  } else {
    for (const line of formatPair(pair)) console.log(line);
  }
}

const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF) {
  await main();
}
