#!/usr/bin/env node
// tools/deploy/release-notes.mjs — deterministic aggregated PROD release note to
// the Mattermost incoming webhook (Issue #868).
//
// On a successful `deploy:prod`, this posts ONE Russian, product-language digest
// listing the "Product note (RU)" sections of every product-kind (feature|bug) PR
// merged between the previously-deployed prod SHA and the newly-deployed SHA. It
// reuses the per-PR delivery's pure seams (Issue #654/#657/#847) so the guard, the
// per-PR note, and this digest read the SAME source of truth:
//   - extractNote / noteIsReal  — the `## Product note (RU)` section extraction.
//   - labelsAreProductKind      — the feature|bug product-kind gate (#847).
//   - envFooter                 — the mandatory DEV/PROD environment footer (#657).
//
// The range is derived deterministically from git + PR data: commit subjects of
// `<prevSha>..<newSha>` → the LAST `(#N)` per subject (squash-merge appends the
// merged PR number) → `gh pr view` per PR. Notes go into the payload verbatim via
// `JSON.stringify({ text })` — no shell, no interpolation — so a `$(...)` or a
// backtick in a note body cannot be executed (the injection-safe path #654 set).
//
// Behaviour (all skips are GREEN — a digest failure must never fail a deploy):
//   - MATTERMOST_WEBHOOK_URL unset (not --dry-run) → log + skip (exit 0).
//   - DELIVERY_ENV unset/unknown                   → FAIL LOUDLY (exit 1); the
//                                                    deploy path passes `prod`.
//   - prev-sha missing/`none`/not 7–40 hex         → log + skip (first deploy? exit 0).
//   - prev-sha == new-sha                          → log + skip (redeploy, exit 0).
//   - `git log <range>` non-zero (bad anchor)      → warn + skip (exit 0, non-fatal).
//   - zero product PRs in the range                → post the "технический релиз" line.
//   - otherwise                                    → post the aggregated digest.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  envFooter,
  extractNote,
  labelsAreProductKind,
  noteIsReal,
} from "../ci/post-product-note.mjs";

const SHORT = 12;

/**
 * Extract the merged PR numbers from an array of git-log commit subjects.
 *
 * A squash-merge subject carries the merged PR number as the LAST `(#N)` — a
 * subject like `"tooling(ci): re-run guards (#651) (#875)"` refers to PR #875
 * (an earlier `(#651)` is a reference inside the title, not the merge). Returns
 * a deduped array of numbers, order preserved by first appearance; subjects with
 * no `(#N)` are skipped.
 */
export function extractPrNumbers(subjects) {
  const seen = new Set();
  const out = [];
  const re = /\(#(\d+)\)/g;
  for (const subject of Array.isArray(subjects) ? subjects : []) {
    let last = null;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(String(subject))) !== null) last = Number(m[1]);
    if (last === null || seen.has(last)) continue;
    seen.add(last);
    out.push(last);
  }
  return out;
}

/**
 * Build the aggregated Mattermost `{ text }` digest for a non-empty product-note
 * list. `notes` is `{ note, title, url }[]` (already filtered to REAL product
 * notes). The footer (prod env marker) is always the final line. Injection-safe:
 * every field is embedded verbatim and delivered via JSON.stringify by the caller.
 */
export function buildDigest({ notes, newSha, footer }) {
  const header = `## 🚀 Релиз на PROD\nЧто вошло в поставку (\`${newSha.slice(
    0,
    SHORT,
  )}\`):`;
  const blocks = notes.map(
    ({ note, title, url }) =>
      `${note.trim()}\n[${(title ?? "").trim() || "PR"}](${url})`,
  );
  const text = `${header}\n\n${blocks.join("\n\n")}\n\n${footer}`;
  return { text };
}

/**
 * Build the `{ text }` payload for a valid range that contained ZERO product PRs
 * — a technical release. The footer is the final line.
 */
export function buildTechnicalReleaseLine({ newSha, footer }) {
  const text =
    `## 🚀 Релиз на PROD\n` +
    `Технический релиз (\`${newSha.slice(
      0,
      SHORT,
    )}\`) — пользовательских изменений в этой поставке нет.\n\n` +
    `${footer}`;
  return { text };
}

function log(msg) {
  process.stdout.write(`[release-notes] ${msg}\n`);
}

/** Parse `--flag value` / `--flag` from argv. */
function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  return {
    prevSha: get("--prev-sha"),
    newSha: get("--new-sha"),
    dryRun: argv.includes("--dry-run"),
  };
}

const HEX_RE = /^[0-9a-f]{7,40}$/i;

async function main() {
  const { prevSha, newSha, dryRun } = parseArgs(process.argv.slice(2));

  // A missing --new-sha is a caller error (the deploy always passes it).
  if (!newSha || !HEX_RE.test(newSha)) {
    throw new Error(
      `--new-sha must be a git SHA (7–40 hex chars); got ${JSON.stringify(newSha ?? null)}.`,
    );
  }

  // No webhook (and not composing a dry-run) → clean green skip, same posture as
  // the per-PR delivery: the channel isn't provisioned yet, nothing to post.
  if (!dryRun && !process.env.MATTERMOST_WEBHOOK_URL) {
    log("MATTERMOST_WEBHOOK_URL is not configured — skipping (green).");
    return;
  }

  // No previous deploy anchor → we cannot compute a range. Do NOT fabricate an
  // all-history range (it would dump every product PR ever). A legitimate
  // "nothing to post" skip stays GREEN and is checked BEFORE the DELIVERY_ENV
  // fail-loud, so a missing marker never turns a clean skip red (the per-PR
  // delivery's ordering, #657).
  if (!prevSha || prevSha === "none" || !HEX_RE.test(prevSha)) {
    log(
      "no previous deploy anchor (first deploy?) — cannot compute range, skipping (green).",
    );
    return;
  }

  // Redeploy of the same SHA — nothing entered the range. Skip green.
  if (prevSha === newSha) {
    log("prev == new (redeploy of same SHA) — nothing entered, skipping (green).");
    return;
  }

  // The environment footer is mandatory for any message that WILL be composed —
  // an unmarked release post is impossible. Validated AFTER the cheap green skips
  // but BEFORE any git/gh/network work, so an unknown DELIVERY_ENV fails loudly
  // and deterministically offline (the deploy passes DELIVERY_ENV=prod).
  const footer = envFooter(process.env.DELIVERY_ENV);
  if (footer === null) {
    throw new Error(
      `DELIVERY_ENV must be 'dev' or 'prod' to mark the environment; got ${JSON.stringify(
        process.env.DELIVERY_ENV ?? null,
      )}. Refusing to post an unmarked release note.`,
    );
  }

  // Commit subjects of prevSha..newSha. A non-zero exit means prevSha is not in
  // the local history (a bad/expired anchor) — warn and skip, never break.
  const logRes = spawnSync(
    "git",
    ["log", "--format=%s", `${prevSha}..${newSha}`],
    { encoding: "utf8" },
  );
  if (logRes.status !== 0) {
    log(
      `⚠ \`git log ${prevSha.slice(0, SHORT)}..${newSha.slice(0, SHORT)}\` failed ` +
        `(anchor not in local history?) — skipping (green): ${(logRes.stderr || "").trim()}`,
    );
    return;
  }
  const subjects = (logRes.stdout || "").split(/\r?\n/).filter(Boolean);
  const prNums = extractPrNumbers(subjects);

  // Fetch each PR; keep only product-kind PRs (feature|bug) with a REAL note.
  const notes = [];
  for (const n of prNums) {
    const r = spawnSync(
      "gh",
      ["pr", "view", String(n), "--json", "number,title,url,body,labels"],
      { encoding: "utf8" },
    );
    // Non-zero: the number is an issue ref (not a PR) or a 404 — skip it.
    if (r.status !== 0) continue;
    let pr;
    try {
      pr = JSON.parse(r.stdout || "");
    } catch {
      continue;
    }
    const labelNames = Array.isArray(pr.labels)
      ? pr.labels.map((l) => (l && typeof l === "object" ? l.name : l))
      : [];
    if (!labelsAreProductKind(labelNames)) continue;
    const note = extractNote(pr.body ?? "");
    if (!noteIsReal(note)) continue;
    notes.push({ note, title: pr.title ?? "", url: pr.url ?? "" });
  }

  const payload =
    notes.length === 0
      ? buildTechnicalReleaseLine({ newSha, footer })
      : buildDigest({ notes, newSha, footer });

  if (dryRun) {
    process.stdout.write(`${payload.text}\n`);
    return;
  }

  const res = await fetch(process.env.MATTERMOST_WEBHOOK_URL, {
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
  log(
    `delivered the aggregated release note to Mattermost (${res.status}; ${notes.length} product PR(s)).`,
  );
}

// Run only as the entry point — keep the pure seams importable without POSTing.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`[release-notes] ${e.stack ?? String(e)}\n`);
    process.exit(1);
  });
}
