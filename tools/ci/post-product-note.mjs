#!/usr/bin/env node
// tools/ci/post-product-note.mjs — deterministic delivery of a merged PR's
// "Product note (RU)" section to a Mattermost incoming webhook (Issue #654).
//
// Driven by `.github/workflows/product-note-mattermost.yml` on a merged
// `pull_request` into `main`. The PR body, title, and URL arrive through the
// process ENV (never interpolated into a shell string) so a `$(...)` or backtick
// in the body cannot be executed — the injection-safe path the Issue mandates.
//
// Behaviour:
//   - MATTERMOST_WEBHOOK_URL unset  → log + skip (webhook not provisioned yet, exit 0).
//   - note is `none`/absent/blank   → log + skip (internal-only PR, nothing to post, exit 0).
//   - labels are not feature/bug    → log + skip (process/dev PR, not a product-facing change,
//                                     exit 0) — full suppression of docs/tooling/chore/refactor/
//                                     dependencies notes from the product channel (Issue #847).
//   - DELIVERY_ENV unset/unknown    → FAIL LOUDLY (exit 1) — the mandatory environment
//                                     marker is the point, so an unmarked post is impossible.
//   - otherwise                     → POST a minimal markdown message: the note, then the PR
//                                     title linked to its URL, then the DELIVERY_ENV footer.
//
// Validation order (Issue #657): the DELIVERY_ENV check runs AFTER the two skip checks,
// immediately before the payload is built — so a legitimate skip (no webhook / `none` note)
// stays a clean green success and is never turned into a red job by a missing marker, while
// every message that is actually POSTed is guaranteed to carry its environment footer.
//
// The section-extraction mirrors tools/lint/product-note-lint.ts so the guard and
// the delivery read the same source of truth.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HEADING_RE = /^#{1,6}\s*product\s+note\b[^\n]*$/im;
// The section capture stops at the FIRST of: the next ATX heading (any level
// `#`–`######`), a markdown thematic break line (`---`/`***`/`___`, including the
// spaced variants `- - -` / `* * *` / `_ _ _`), or end of body. Anchored on a
// line boundary (leading `\n`, `$` under the `m` flag) so a `---` divider after a
// top-of-body note no longer lets the English PR summary bleed in (Issue #659).
const SECTION_STOP_RE =
  /\n(?:#{1,6}\s|[ \t]{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$)/m;
const MARKER_RE = /^[ \t>*-]*product[- ]note\s*:\s*(.*)$/im;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const NONE_RE = /^none[.!]?$/i;
const PLACEHOLDER_RE = /^(n\/?a|tbd|todo|xxx|\.\.\.|<.*>|_+|-+)$/i;

// Service-marker lines that must never reach a delivered product note (Issue
// #1040): when the note is the LAST section of the PR body, the section capture
// runs to end-of-body and swallows the PR's process tail (Stage-B record,
// author marker, Claude Code attribution, the claude.ai session link Mattermost
// unfurls into a preview card). Whole matching LINES are removed — real RU note
// text is preserved verbatim, so prose that merely mentions "Claude"
// mid-sentence is untouched. Anchored patterns allow a leading `>` quote,
// `*`/`-` bullet, and whitespace.
const SERVICE_LINE_RES = [
  /^[ \t>*-]*author:\s*(claude|codex|human)\s*$/i, // PR author marker
  /^[ \t>*-]*stage-b\s*:/i, // Stage-B gate record
  /^[ \t>*-]*registry-research\s*:/i, // registry-research verdict
  /claude\.ai\/code/i, // session link (anywhere in the line)
  /generated with.*claude\s+code/i, // 🤖 attribution line (markdown link or plain)
  /^[ \t>*-]*co-authored-by\s*:/i, // commit co-author trailer
  /^[ \t>*-]*claude-session\s*:/i, // commit session trailer
];

/**
 * Remove whole service-marker lines (Issue #1040) and collapse the blank-line
 * runs they leave behind. Non-matching lines pass through verbatim.
 */
export function stripServiceMarkers(text) {
  if (!text) return "";
  return text
    .split(/\r?\n/)
    .filter((line) => !SERVICE_LINE_RES.some((re) => re.test(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** The `## Product note (RU)` section body, or null when there is no such heading. */
function sectionBody(body) {
  const h = body.match(HEADING_RE);
  if (h?.index === undefined || h.index === null) return null;
  const rest = body.slice(h.index + h[0].length);
  const next = rest.search(SECTION_STOP_RE);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The Product note text with HTML comments and service-marker lines stripped
 *  (Issue #1040 — the sanitizer runs INSIDE the extraction so both delivery
 *  paths, the per-PR post and the aggregated PROD digest, inherit it), or ""
 *  when absent/empty. A note that is ONLY service lines sanitizes to "" and
 *  flows through the callers' existing `noteIsReal` green-skip. */
export function extractNote(body) {
  if (!body) return "";
  const section = sectionBody(body);
  if (section !== null)
    return stripServiceMarkers(section.replace(HTML_COMMENT_RE, "")).trim();
  const marker = body.match(MARKER_RE);
  if (marker)
    return stripServiceMarkers(
      (marker[1] ?? "").replace(HTML_COMMENT_RE, ""),
    ).trim();
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

/** PR kinds that represent a product-facing change; only these deliver to the
 *  product channel. Process PRs (docs/tooling/chore/refactor/dependencies) are
 *  suppressed entirely (Issue #847 — owner decision 2026-07-13: full suppression). */
const PRODUCT_KIND_LABELS = ["feature", "bug"];

/** True when the PR's label set marks a product-facing change (feature|bug).
 *  `labels` is the array of label NAME strings from the PR event payload. */
export function labelsAreProductKind(labels) {
  if (!Array.isArray(labels)) return false;
  const set = new Set(labels.map((l) => String(l).trim().toLowerCase()));
  return PRODUCT_KIND_LABELS.some((k) => set.has(k));
}

/** Parse the JSON array of label names passed via PR_LABELS. Malformed/absent
 *  input yields [] (→ suppressed), never a throw. */
export function parseLabels(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** The mandatory environment footer, keyed by DELIVERY_ENV (Issue #657). */
const ENV_FOOTERS = {
  dev: "🧪 Среда: DEV — смержено в разработку; на проде появится со следующим релизом.",
  prod: "🚀 Среда: PROD — выкачено на продакшен.",
};

/**
 * The environment footer for a DELIVERY_ENV value, or null for unset/unknown.
 * Case- and whitespace-insensitive so `DEV`/` dev ` still resolve; anything
 * outside {dev, prod} returns null → the caller fails loudly (no unmarked post).
 */
export function envFooter(deliveryEnv) {
  const key = (deliveryEnv ?? "").trim().toLowerCase();
  return ENV_FOOTERS[key] ?? null;
}

/**
 * Build the Mattermost `{ text }` payload: the note, the linked PR title, then
 * the mandatory environment footer as the last line.
 */
export function buildPayload(note, prTitle, prUrl, footer) {
  const title = (prTitle ?? "").trim() || "PR";
  const text = `${note.trim()}\n\n[${title}](${prUrl})\n\n${footer}`;
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
    log(
      "MATTERMOST_WEBHOOK_URL is not configured — skipping delivery (green).",
    );
    return;
  }

  const note = extractNote(body);
  if (!noteIsReal(note)) {
    log(
      "no real Product note (RU) in the PR body (`none`/absent) — nothing to deliver, skipping (green).",
    );
    return;
  }

  // Only product-kind PRs (labels feature|bug) deliver to the product channel;
  // process/dev PRs (docs/tooling/chore/refactor/dependencies) are suppressed
  // entirely (Issue #847). Placed before the DELIVERY_ENV fail-loud check so a
  // process PR stays green rather than failing on a missing marker.
  const labels = parseLabels(process.env.PR_LABELS);
  if (!labelsAreProductKind(labels)) {
    log(
      "PR is not a product-kind change (labels are not feature/bug) — process/dev PR, skipping delivery (green).",
    );
    return;
  }

  // Every POSTed message MUST carry its environment marker — an unmarked post is
  // impossible. Validated here (after the skip checks) so a legitimate skip stays
  // green, but a message that WILL post always has a footer.
  const footer = envFooter(process.env.DELIVERY_ENV);
  if (footer === null) {
    throw new Error(
      `DELIVERY_ENV must be 'dev' or 'prod' to mark the environment; got ${JSON.stringify(
        process.env.DELIVERY_ENV ?? null,
      )}. Refusing to post an unmarked Product note.`,
    );
  }

  const payload = buildPayload(note, prTitle, prUrl, footer);
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
