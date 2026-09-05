#!/usr/bin/env node
// tools/deploy/hotfix-ref.mjs — pure seams for the `pnpm deploy:prod --ref <sha>`
// hotfix path (Issue #1881, release-cycle spec §10.11).
//
// The default deploy ships `origin/main` WHOLE. A hotfix must ship the currently
// deployed SHA plus a cherry-pick of an already-merged fix — nothing else from
// main. This module holds the decision logic that says whether a given target
// SHA is a legitimate hotfix target; every git/gh query stays in
// `tools/deploy/prod.mjs`, so these functions are pure, deterministic and unit
// tested (`hotfix-ref.test.mjs`).
//
// What the hotfix path deliberately does NOT become: an arbitrary-branch deploy.
// The invariants below (strict descendant of live prod + every extra commit is a
// cherry-pick of a commit already on `origin/main`) are what keeps «deploy ships
// reviewed, merged code» true.

/** A full or abbreviated git commit SHA. */
const SHA_RE = /^[0-9a-f]{7,40}$/i;

export const REF_FLAG = "--ref";

/**
 * Parse the `--ref <sha>` flag out of `argv`. Pure — no I/O, no `process.argv`
 * read (the caller injects it), so the usage contract is unit-testable.
 *
 * Mirrors the `--rollback <sha>` / `--release-gate-exempt "<reason>"` contract:
 * a mistyped or bare flag fails FAST, before any network call.
 *
 * @param {string[]} argv
 * @returns {{ present: boolean, ref: string|null, error: string|null }}
 */
export function parseRefFlag(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const idx = args.indexOf(REF_FLAG);
  if (idx === -1) return { present: false, ref: null, error: null };

  if (args.indexOf(REF_FLAG, idx + 1) !== -1) {
    return {
      present: true,
      ref: null,
      error: `${REF_FLAG} may be passed only once`,
    };
  }
  if (args.includes("--rollback")) {
    return {
      present: true,
      ref: null,
      error: `${REF_FLAG} and --rollback are mutually exclusive — a hotfix deploy ships forward, a rollback ships backward`,
    };
  }

  const value = args[idx + 1];
  if (!value || value.startsWith("-")) {
    return {
      present: true,
      ref: null,
      error: `${REF_FLAG} requires a <sha> argument (the hotfix commit on origin, e.g. \`${REF_FLAG} 1a2b3c4d\`)`,
    };
  }
  if (!SHA_RE.test(value)) {
    return {
      present: true,
      ref: null,
      error: `${REF_FLAG} takes a commit SHA (7–40 hex chars), got: ${value} — branch names and tags are rejected on purpose (deploy ships an immutable commit)`,
    };
  }
  return { present: true, ref: value.toLowerCase(), error: null };
}

/**
 * Parse `git cherry <upstream> <head> [limit]` output. Lines are `+ <sha>` (the
 * commit has NO equivalent upstream) or `- <sha>` (an equivalent commit exists
 * upstream, i.e. it IS a cherry-pick of merged work). Pure.
 *
 * @param {string} stdout
 * @returns {{ unmatched: string[], matched: string[] }}
 */
export function parseCherryOutput(stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const unmatched = [];
  const matched = [];
  for (const line of lines) {
    const m = /^([+-])\s+([0-9a-f]{7,40})$/i.exec(line);
    if (!m) continue;
    (m[1] === "+" ? unmatched : matched).push(m[2].toLowerCase());
  }
  return { unmatched, matched };
}

/**
 * The hotfix pre-flight verdict, given the facts the caller resolved with git.
 *
 * Invariants (spec §10.11):
 *   1. the target is a STRICT descendant of the LIVE deployed SHA — a hotfix
 *      builds on what is running, it never rewinds prod and never re-deploys
 *      the same SHA under a hotfix banner;
 *   2. every commit in `deployed..target` has an equivalent commit on
 *      `origin/main` — i.e. it is a cherry-pick of already-merged, already-
 *      reviewed work. An unmatched (`+`) commit means unreviewed code would
 *      reach prod: refuse, naming it.
 *
 * @param {{ deployedSha: string, targetSha: string, targetIsDescendant: boolean, unmatched?: string[] }} facts
 * @returns {{ ok: boolean, error: string|null }}
 */
export function hotfixPreflightVerdict({
  deployedSha,
  targetSha,
  targetIsDescendant,
  unmatched = [],
} = {}) {
  if (!deployedSha)
    return {
      ok: false,
      error:
        "cannot resolve the live deployed SHA — a hotfix deploy must know what it is building on",
    };
  if (!targetSha) return { ok: false, error: `${REF_FLAG} target is missing` };
  if (deployedSha === targetSha)
    return {
      ok: false,
      error: `${REF_FLAG} target ${targetSha.slice(0, 12)} is already the deployed SHA — nothing to ship`,
    };
  if (!targetIsDescendant)
    return {
      ok: false,
      error:
        `${REF_FLAG} target ${targetSha.slice(0, 12)} is not a descendant of the deployed SHA ${deployedSha.slice(0, 12)} —` +
        ` a hotfix branch must be cut FROM the deployed SHA (rewinding prod is \`--rollback\`, not \`${REF_FLAG}\`)`,
    };
  if (unmatched.length > 0)
    return {
      ok: false,
      error:
        `${REF_FLAG} target carries ${unmatched.length} commit(s) with no equivalent on origin/main: ` +
        `${unmatched.map((s) => s.slice(0, 12)).join(", ")} —` +
        ` a hotfix may only cherry-pick ALREADY-MERGED commits. Land the fix on main first.`,
    };
  return { ok: true, error: null };
}
