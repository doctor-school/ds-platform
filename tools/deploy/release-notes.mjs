#!/usr/bin/env node
// tools/deploy/release-notes.mjs — deterministic aggregated PROD release note to
// the Mattermost incoming webhook (Issue #868).
//
// This posts ONE Russian, product-language digest listing the "Product note (RU)"
// sections of every PR that carries a REAL note and entered the range between the
// previously-deployed prod SHA and the newly-deployed SHA. Inclusion is driven by
// the note alone, NOT by the kind label (#2241): a `refactor`/`tooling` PR whose
// author wrote a real Product note IS product-visible and belongs in the post;
// a `feature`/`bug` PR whose note is `none` stays out. The per-PR poster keeps its
// own `feature|bug` gate — only the DIGEST is note-driven. The digest is a DEPLOY
// event, so it is fired from CI by `.github/workflows/release-digest.yml` on
// `deployment_status: success` for the `production` environment (#968) — where
// `secrets.MATTERMOST_WEBHOOK_URL` already lives — via the thin resolver
// `tools/ci/post-release-digest.mjs` (which resolves the prev/new SHA range from
// the Deployment event + `gh api` and spawns this script). `deploy:prod` itself
// no longer posts the digest; it only RECORDS the GitHub Deployment (#942) whose
// `success` status is exactly the event that triggers the CI post. The webhook is
// `process.env`-only (CI secret); `--dry-run` renders offline with no webhook. It
// reuses the per-PR delivery's pure seams (Issue #654/#657/#847) so the guard, the
// per-PR note, and this digest read the SAME source of truth:
//   - extractNote / noteIsReal  — the `## Product note (RU)` section extraction.
//   - envFooter                 — the mandatory DEV/PROD environment footer (#657).
//
// The range is derived deterministically from git + PR data by PATCH ID, not by
// commit ancestry (#2241): `git cherry -v <prevSha> <newSha>` marks every commit
// that already has a patch-equivalent upstream with `-`, so the commits a `--ref`
// hotfix already shipped to prod (and main later carries as cherry-picks) are
// dropped instead of being announced a second time. Only `+` subjects survive →
// the LAST `(#N)` per subject (squash-merge appends the merged PR number) →
// `gh pr view` per PR. Notes go into the payload verbatim via
// `JSON.stringify({ text })` — no shell, no interpolation — so a `$(...)` or a
// backtick in a note body cannot be executed (the injection-safe path #654 set).
//
// Behaviour (all skips are GREEN — a digest failure must never fail a deploy):
//   - MATTERMOST_WEBHOOK_URL unset (not --dry-run) → log + skip (exit 0).
//   - DELIVERY_ENV unset/unknown                   → FAIL LOUDLY (exit 1); the
//                                                    deploy path passes `prod`.
//   - prev-sha missing/`none`/not 7–40 hex         → log + skip (first deploy? exit 0).
//   - prev-sha == new-sha                          → log + skip (redeploy, exit 0).
//   - `git cherry <range>` non-zero (bad anchor)   → warn + skip (exit 0, non-fatal).
//   - zero noted PRs in the range                  → post the "технический релиз" line.
//   - otherwise                                    → post the aggregated digest.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  envFooter,
  extractNote,
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
 * Parse `git cherry -v <upstream> <head>` output. Each line is
 * `<+|-> <sha> <subject>`: `+` means the commit has NO patch-equivalent upstream
 * (genuinely new in this range), `-` means an equivalent patch already exists
 * upstream — i.e. it was already shipped (a `--ref` hotfix) and main merely
 * replays it. Pure; malformed lines are ignored. A subject may legitimately be
 * empty (`git cherry` without `-v` output mixed in).
 *
 * @param {string} stdout
 * @returns {{ unmatched: {sha: string, subject: string}[], matched: {sha: string, subject: string}[] }}
 */
export function parseCherryVerbose(stdout) {
  const unmatched = [];
  const matched = [];
  for (const raw of String(stdout ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([+-])\s+([0-9a-f]{7,40})(?:\s+(.*))?$/i.exec(line);
    if (!m) continue;
    const entry = { sha: m[2].toLowerCase(), subject: (m[3] ?? "").trim() };
    (m[1] === "+" ? unmatched : matched).push(entry);
  }
  return { unmatched, matched };
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

/**
 * Compose the aggregated release-notes digest text for a `prevSha..newSha` range —
 * the ONE source of truth reused by both the Mattermost post (this script's
 * `main`) and the GitHub Deployment record (`deployment-record.mjs`, #942/#847):
 * derive the range's merged PR numbers BY PATCH ID (`git cherry -v`, so the commits
 * a `--ref` hotfix already shipped are not announced a second time) → `gh pr view`
 * each → keep every PR carrying a REAL `## Product note (RU)`, whatever its kind
 * label (#2241) → `buildDigest` (or `buildTechnicalReleaseLine` when zero).
 *
 * Returns `{ text, productCount }`, or `null` on the legitimate green-skip case
 * (a bad/expired anchor whose `git cherry <range>` fails — never break a deploy). The
 * caller owns the earlier green skips (no anchor / redeploy) and the webhook check;
 * `footer` MUST be non-null here (the caller validates DELIVERY_ENV first). Callers
 * that pass a range with a potentially-unvalidated env get a loud throw.
 *
 * @param {object}      args
 * @param {string}      args.prevSha  previously-deployed anchor (valid hex, != new).
 * @param {string}      args.newSha   newly-deployed SHA.
 * @param {string|null} args.footer   the mandatory DEV/PROD environment footer.
 * @param {string}     [args.cwd]     working dir for git/gh (defaults to cwd).
 * @param {Function}   [args.runCherry] test seam: `(prevSha, newSha) => { status, stdout, stderr }`.
 * @param {Function}   [args.runGh]     test seam: `(prNumber) => { status, stdout }`.
 * @returns {Promise<{ text: string, productCount: number } | null>}
 */
export async function composeDigest({
  prevSha,
  newSha,
  footer,
  cwd = process.cwd(),
  runCherry = (prev, next) =>
    spawnSync("git", ["cherry", "-v", prev, next], { encoding: "utf8", cwd }),
  runGh = (n) =>
    spawnSync(
      "gh",
      ["pr", "view", String(n), "--json", "number,title,url,body"],
      { encoding: "utf8", cwd },
    ),
}) {
  if (footer === null || footer === undefined) {
    throw new Error(
      `DELIVERY_ENV must be 'dev' or 'prod' to mark the environment; got ${JSON.stringify(
        process.env.DELIVERY_ENV ?? null,
      )}. Refusing to compose an unmarked release note.`,
    );
  }

  // `git cherry` reports no MERGE commit (a merge has no patch-id); harmless here
  // because `main` is squash-only (the linear-history ruleset), so every release
  // commit is a single-parent squash.
  // The range, BY PATCH ID (#2241). `git cherry -v <prev> <new>` marks with `-`
  // every commit of the range that already has a patch-equivalent upstream in
  // `<prev>` — exactly the commits a `pnpm deploy:prod --ref <sha>` hotfix already
  // shipped and that main merely replays as cherry-picks. Announcing those again
  // is what made the 2026-09-16 post repeat nine already-live notes. Only the `+`
  // subjects are genuinely new in this release. A non-zero exit means prevSha is
  // not in the local history (a bad/expired anchor) — warn and skip (green).
  const cherryRes = runCherry(prevSha, newSha);
  if (cherryRes.status !== 0) {
    log(
      `⚠ \`git cherry -v ${prevSha.slice(0, SHORT)} ${newSha.slice(0, SHORT)}\` failed ` +
        `(anchor not in local history?) — skipping (green): ${(cherryRes.stderr || "").trim()}`,
    );
    return null;
  }
  const { unmatched } = parseCherryVerbose(cherryRes.stdout || "");
  const prNums = extractPrNumbers(unmatched.map((e) => e.subject));

  // Fetch each PR; keep every PR whose author wrote a REAL `## Product note (RU)`.
  // The NOTE is the gate here, not the kind label (#2241): a `refactor`/`tooling`
  // PR with a real note is product-visible by the author's own declaration and
  // belongs in the digest, while a `feature`/`bug` PR whose note is `none` stays
  // out. (The per-PR poster keeps its own feature|bug gate — only this digest is
  // note-driven.)
  const notes = [];
  for (const n of prNums) {
    const r = runGh(n);
    // Non-zero: the number is an issue ref (not a PR) or a 404 — skip it.
    if (r.status !== 0) continue;
    let pr;
    try {
      pr = JSON.parse(r.stdout || "");
    } catch {
      continue;
    }
    const note = extractNote(pr.body ?? "");
    if (!noteIsReal(note)) continue;
    notes.push({ note, title: pr.title ?? "", url: pr.url ?? "" });
  }

  const payload =
    notes.length === 0
      ? buildTechnicalReleaseLine({ newSha, footer })
      : buildDigest({ notes, newSha, footer });
  return { text: payload.text, productCount: notes.length };
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

  // The webhook is `process.env`-only. This script fires from CI
  // (`release-digest.yml` on `deployment_status: success`), where
  // `secrets.MATTERMOST_WEBHOOK_URL` is injected into the step env (#968) — no
  // `.env.local` crutch (#950, retired). A `--dry-run` needs no webhook at all.
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
    log(
      "prev == new (redeploy of same SHA) — nothing entered, skipping (green).",
    );
    return;
  }

  // The environment footer is mandatory for any message that WILL be composed —
  // an unmarked release post is impossible. Validated AFTER the cheap green skips
  // but BEFORE any git/gh/network work (composeDigest throws on a null footer
  // before touching git), so an unknown DELIVERY_ENV fails loudly and
  // deterministically offline (the deploy passes DELIVERY_ENV=prod).
  const footer = envFooter(process.env.DELIVERY_ENV);

  // Compose the digest via the ONE shared seam (also used by the Deployment record
  // in deployment-record.mjs, #942). Null → a legitimate green skip already logged.
  const digest = await composeDigest({ prevSha, newSha, footer });
  if (!digest) return;
  const payload = { text: digest.text };

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
    `delivered the aggregated release note to Mattermost (${res.status}; ${digest.productCount} product PR(s)).`,
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
