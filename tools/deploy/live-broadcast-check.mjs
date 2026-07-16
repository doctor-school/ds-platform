#!/usr/bin/env node
// DS Platform — read-only live-broadcast (эфир) probe (#1000, T2 of #996).
//
// Release-cycle spec §10.4 item 7: a prod deploy's <60s container recreation
// blips a live webinar room, so a deploy MUST NOT run while a broadcast is
// live — regardless of change-class. This probe is the detection wiring: it
// reads the PUBLIC upcoming-broadcasts listing (`GET /v1/public/events`,
// apps/api/src/events/events.public.controller.ts — returns `published`/`live`
// `UpcomingBroadcastCard[]`) and reports whether any item carries
// `state: "live"`.
//
//   Usage:  pnpm deploy:check-live
//
//   Exit 0 — `CLEAR …`                     no live broadcast; deploy may proceed.
//   Exit 1 — `LIVE: <slug — title> …`      a broadcast is live; HOLD the deploy.
//   Exit 1 — `UNKNOWN (probe failed: …) …` network/HTTP/shape failure — FAIL-CLOSED
//                                          (spec §10.2: uncertainty ⇒ hold/escalate).
//
// Wired into `tools/deploy/prod.mjs` pre-flight as a hold; escape hatch
// `--allow-live-broadcast` (owner-approved urgent ship only) mirrors
// `--skip-ci-check`. Pure seams (`findLiveEvent`, `evaluateBroadcastProbe`,
// `formatVerdict`) are exported and unit-tested WITHOUT network
// (tools/lint/guard-tests/live-broadcast-check.spec.ts); the fetch lives only
// in the CLI entry, guarded by the same entry-point idiom as release-notes.mjs.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The prod public upcoming-broadcasts listing (same prod-URL precedent as
 *  tools/deploy/smoke-prod.mjs). Read-only, unauthenticated, cacheable. */
export const PUBLIC_EVENTS_URL = "https://api.doctor.school/v1/public/events";

/**
 * Pure: the first item of the listing payload carrying `state: "live"`, or
 * `undefined` when none (or when the payload is not an array — the caller
 * treats a non-array as UNKNOWN, never as CLEAR).
 */
export function findLiveEvent(payload) {
  if (!Array.isArray(payload)) return undefined;
  return payload.find(
    (item) => item && typeof item === "object" && item.state === "live",
  );
}

/**
 * Pure: reduce a probe result (`{ payload }` or `{ error }`) to a verdict.
 * Fail-closed: any error or unexpected payload shape is `unknown`, never
 * `clear` — uncertainty holds the deploy (spec §10.4 item 7).
 */
export function evaluateBroadcastProbe({ payload, error }) {
  if (error) return { kind: "unknown", error };
  if (!Array.isArray(payload)) {
    return { kind: "unknown", error: "response body was not an array" };
  }
  const live = findLiveEvent(payload);
  if (live) {
    const slug = typeof live.slug === "string" ? live.slug : "?";
    const title = typeof live.title === "string" ? live.title : "?";
    return { kind: "live", label: `${slug} — ${title}` };
  }
  return { kind: "clear" };
}

/** Pure: verdict → the single machine-parseable output line + exit code. */
export function formatVerdict(verdict) {
  switch (verdict.kind) {
    case "clear":
      return {
        line: "CLEAR — no live broadcast on prod; deploy may proceed (§10.4 item 7).",
        exitCode: 0,
      };
    case "live":
      return {
        line: `LIVE: ${verdict.label} — a broadcast is live on prod; HOLD the deploy (§10.4 item 7).`,
        exitCode: 1,
      };
    default:
      return {
        line: `UNKNOWN (probe failed: ${verdict.error}) — fail-closed; HOLD the deploy (§10.4 item 7).`,
        exitCode: 1,
      };
  }
}

// ── I/O (CLI entry only — never fired on import) ────────────────────────────

async function probeListing(url, timeoutMs = 10000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { payload: await res.json() };
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return { error: msg };
  } finally {
    clearTimeout(timer);
  }
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  const result = await probeListing(PUBLIC_EVENTS_URL);
  const { line, exitCode } = formatVerdict(evaluateBroadcastProbe(result));
  console.log(line);
  process.exit(exitCode);
}
