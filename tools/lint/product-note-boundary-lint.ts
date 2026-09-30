#!/usr/bin/env tsx
/**
 * tools/lint/product-note-boundary-lint.ts — the `## Product note (RU)` section
 * must hold ONLY the product note (Issue #2489).
 *
 * Why this exists: the note section is delivered verbatim to the team's
 * Mattermost channel on merge and into the PROD release digest. When a PR body
 * put its heading-less delivery-evidence lines (`registry-research: …`,
 * `ui-render-desktop-light: https://…`, `Stage-B-owner-quote: …`) right after
 * the note, the section capture swallowed them (PR #2451). The shared extraction
 * (tools/ci/post-product-note.mjs `sectionBody`) now stops at the first
 * machine-marker line, so delivery is clean; this guard keeps the SOURCE clean
 * too, so the author sees the misplaced evidence at PR time instead of relying
 * on the delivery-side cut alone.
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * Take the Product note section heading → next heading / thematic break / end of
 * body WITHOUT the machine-marker stop (`rawSectionBody`). If it contains a
 * machine-marker line (`MACHINE_MARKER_LINE_RE`, the same definition the
 * delivery cut uses) → FAIL, naming the first offending line. No Product note
 * section, or a `none`/blank note (nothing is delivered) → PASS. RU prose,
 * including a sentence with a colon mid-line, is never a marker.
 *
 * Severity: BLOCK (not in guard-policy.mjs WARN_GUARDS). It checks only where
 * evidence sits in the body — the fix is always moving lines under
 * `## Delivery evidence`, never a judgement call.
 *
 * Inputs:
 *   - `--body-file <path>` → evaluate a saved PR body (local check, no gh).
 *   - otherwise PR-event-gated like `product-note`: reads the body via
 *     `gh pr view` (with the `PR_BODY` event-payload seam, lib/gh.ts); a non-PR
 *     run exits 0 with a skip note. Also run by `pnpm pr:preflight <N>`.
 * Failures: stderr, exit 1. Success: stdout summary, exit 0.
 *
 * Run: `pnpm lint:product-note-boundary [--body-file <path>]`.
 */
import { readFileSync } from "node:fs";

import {
  extractNote,
  firstMarkerLine,
  noteIsReal,
  rawSectionBody,
} from "../ci/post-product-note.mjs";
import { ghViewJson } from "./lib/gh";

const TAG = "[product-note-boundary]";

interface GhPR {
  number: number;
  body: string;
}

function fail(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}
function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** The first machine-marker line inside the raw Product note section, or null
 *  when the section is absent, carries no real note (`none`/blank — nothing is
 *  delivered), or holds prose only. */
function boundaryViolation(body: string): string | null {
  const raw = rawSectionBody(body);
  if (raw === null) return null;
  if (!noteIsReal(extractNote(body))) return null;
  return firstMarkerLine(raw);
}

function check(body: string, label: string): never {
  const offending = boundaryViolation(body);
  if (offending !== null) {
    fail(
      `${label}: the \`## Product note (RU)\` section contains a machine-marker line: ` +
        `"${offending.trim().slice(0, 120)}". The section is delivered verbatim to ` +
        `Mattermost and the release digest — keep it RU product prose only and ` +
        `move evidence under its own heading (## Delivery evidence).`,
    );
  }
  info(`${label}: Product note section holds no machine-marker line — OK`);
  process.exit(0);
}

function resolvePrNumber(): string {
  let prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber && process.env.GITHUB_REF) {
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  return prNumber;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const fileIdx = argv.indexOf("--body-file");
  if (fileIdx !== -1) {
    const path = argv[fileIdx + 1];
    if (!path) fail("--body-file needs a path");
    check(readFileSync(path, "utf8"), path);
  }

  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    info(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}), skipping`,
    );
    process.exit(0);
  }
  const prNumber = resolvePrNumber();
  if (!prNumber) {
    info("cannot determine PR number from environment, skipping");
    process.exit(0);
  }
  const res = await ghViewJson<GhPR>("pr", prNumber, "number,body");
  if (!res.ok) fail(`could not fetch PR #${prNumber} metadata: ${res.error}`);
  check(res.data.body ?? "", `PR #${res.data.number}`);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
