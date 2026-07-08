#!/usr/bin/env node
// tools/ci/post-product-note.mjs — deterministic delivery of a merged PR's
// "Product note (RU)" section to a Mattermost incoming webhook (Issue #654).
//
// Driven by `.github/workflows/product-note-mattermost.yml` on a merged
// `pull_request` into `main`. The PR body, title, and URL arrive through the
// process ENV (never interpolated into a shell string) so a `$(...)` or backtick
// in the body cannot be executed — the injection-safe path the Issue mandates.
//
// Behaviour (all exit 0 — a skip is a clean success, never a red delivery job):
//   - MATTERMOST_WEBHOOK_URL unset  → log + skip (webhook not provisioned yet).
//   - note is `none`/absent/blank   → log + skip (internal-only PR, nothing to post).
//   - otherwise                     → POST a minimal markdown message
//                                     (the note, then the PR title linked to its URL).
//
// The section-extraction mirrors tools/lint/product-note-lint.ts so the guard and
// the delivery read the same source of truth.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HEADING_RE = /^#{1,6}\s*product\s+note\b[^\n]*$/im;
const NEXT_HEADING_RE = /\n#{1,6}\s/;
const MARKER_RE = /^[ \t>*-]*product[- ]note\s*:\s*(.*)$/im;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const NONE_RE = /^none[.!]?$/i;
const PLACEHOLDER_RE = /^(n\/?a|tbd|todo|xxx|\.\.\.|<.*>|_+|-+)$/i;

/** The `## Product note (RU)` section body, or null when there is no such heading. */
function sectionBody(body) {
  const h = body.match(HEADING_RE);
  if (h?.index === undefined || h.index === null) return null;
  const rest = body.slice(h.index + h[0].length);
  const next = rest.search(NEXT_HEADING_RE);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The Product note text with HTML comments stripped, or "" when absent/empty. */
export function extractNote(body) {
  if (!body) return "";
  const section = sectionBody(body);
  if (section !== null) return section.replace(HTML_COMMENT_RE, "").trim();
  const marker = body.match(MARKER_RE);
  if (marker) return (marker[1] ?? "").replace(HTML_COMMENT_RE, "").trim();
  return "";
}

/** True when the note is a REAL product note (not `none`, blank, or placeholder). */
export function noteIsReal(note) {
  const firstLine = note.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const v = firstLine.trim();
  if (v.length === 0) return false;
  if (NONE_RE.test(v)) return false;
  if (PLACEHOLDER_RE.test(v)) return false;
  return note.trim().length >= 8;
}

/** Build the Mattermost `{ text }` payload: the note, then the linked PR title. */
export function buildPayload(note, prTitle, prUrl) {
  const title = (prTitle ?? "").trim() || "PR";
  const text = `${note.trim()}\n\n[${title}](${prUrl})`;
  return { text };
}

function log(msg) {
  process.stdout.write(`[product-note-mattermost] ${msg}\n`);
}

async function main() {
  const webhook = process.env.MATTERMOST_WEBHOOK_URL;
  const body = process.env.PR_BODY ?? "";
  const prTitle = process.env.PR_TITLE ?? "";
  const prUrl = process.env.PR_URL ?? "";

  if (!webhook) {
    log("MATTERMOST_WEBHOOK_URL is not configured — skipping delivery (green).");
    return;
  }

  const note = extractNote(body);
  if (!noteIsReal(note)) {
    log(
      "no real Product note (RU) in the PR body (`none`/absent) — nothing to deliver, skipping (green).",
    );
    return;
  }

  const payload = buildPayload(note, prTitle, prUrl);
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Mattermost webhook POST failed: ${res.status} ${res.statusText} ${detail.slice(0, 200)}`,
    );
  }
  log(`delivered the Product note to Mattermost (${res.status}).`);
}

// Run only as the entry point — keep the pure seams importable without POSTing.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`[product-note-mattermost] ${e.stack ?? String(e)}\n`);
    process.exit(1);
  });
}
