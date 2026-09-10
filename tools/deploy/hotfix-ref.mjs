#!/usr/bin/env node
// tools/deploy/hotfix-ref.mjs — pure seams for the `pnpm deploy:prod --ref <sha>`
// hotfix path (Issue #1881, release-cycle spec §10.11).
//
// The default deploy ships `origin/main` WHOLE. A hotfix must ship the currently
// deployed SHA plus a cherry-pick of an already-merged fix — nothing else from
// main. This module holds the pure verdicts and the bounded Git replay proof
// (`hotfix-ref.test.mjs` covers real repository fixtures).
//
// What the hotfix path deliberately does NOT become: an arbitrary-branch deploy.
// The invariants below (strict descendant of live prod + every extra commit is a
// cherry-pick of a commit already on `origin/main`) are what keeps «deploy ships
// reviewed, merged code» true.

import { spawnSync } from "node:child_process";

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

/** Verify every range commit using native equivalence or an exact Git replay.
 * merge-tree writes only unreachable objects: no checkout, index or ref changes.
 * Git failures (including unsupported --merge-base) and conflicts fail closed.
 */
export function verifyHotfixCommits({ cwd, deployed, target }) {
  const replayed = [];
  try {
    const git = (...args) => {
      const result = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
      });
      if (result.error || result.status !== 0)
        throw new Error(
          `git ${args[0]} failed (exit ${result.status ?? "unknown"})`,
        );
      return result.stdout.trim();
    };
    if (!/^[0-9a-f]{40}$/i.test(deployed) || !/^[0-9a-f]{40}$/i.test(target))
      throw new Error("full commit SHAs required");
    if (deployed === target) throw new Error("empty hotfix range");
    git("merge-base", "--is-ancestor", deployed, target);
    const upstream = git("rev-parse", "origin/main^{commit}");
    const commits = git(
      "rev-list",
      "--reverse",
      `${deployed}..${target}`,
    ).split("\n");
    const parent = (sha) => {
      const parents = git("show", "-s", "--format=%P", sha).split(" ");
      if (parents.length !== 1 || !/^[0-9a-f]{40}$/.test(parents[0]))
        throw new Error(`${sha.slice(0, 12)} must have exactly one parent`);
      return parents[0];
    };
    const cherry = git("cherry", upstream, target, deployed);
    if (
      cherry &&
      !cherry.split("\n").every((line) => /^[+-] [0-9a-f]{40}$/.test(line))
    )
      throw new Error("malformed git cherry output");
    const { matched, unmatched } = parseCherryOutput(cherry);
    for (const commit of commits) {
      const targetParent = parent(commit); // git cherry omits merge commits.
      if (matched.includes(commit)) continue;
      if (!unmatched.includes(commit)) {
        git("merge-base", "--is-ancestor", commit, upstream);
        continue;
      }
      const body = git("show", "-s", "--format=%B", commit);
      const receipts = body
        .split("\n")
        .filter((line) => line.includes("cherry picked from commit"));
      const receipt =
        receipts.length === 1 &&
        /^\(cherry picked from commit ([0-9a-f]{40})\)$/.exec(receipts[0]);
      if (!receipt)
        throw new Error(
          `${commit.slice(0, 12)} needs one canonical cherry-pick -x receipt`,
        );
      const source = receipt[1];
      git("merge-base", "--is-ancestor", source, upstream);
      const sourceParent = parent(source);
      const tree = git(
        "-c",
        "merge.renormalize=false",
        "merge-tree",
        "--write-tree",
        "--no-messages",
        `--merge-base=${sourceParent}`,
        targetParent,
        source,
      );
      if (
        !/^[0-9a-f]{40}$/.test(tree) ||
        tree !== git("rev-parse", `${commit}^{tree}`)
      )
        throw new Error(
          `${commit.slice(0, 12)} differs from clean source replay`,
        );
      replayed.push({ target: commit, source });
    }
    return { ok: true, error: null, replayed };
  } catch (error) {
    return {
      ok: false,
      error: `hotfix proof refused: ${error.message}`,
      replayed: [],
    };
  }
}
