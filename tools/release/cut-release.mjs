#!/usr/bin/env node
// tools/release/cut-release.mjs — W3/L1 of #927 (Issue #943).
//
// Cuts ONE repo-level git tag + a GitHub Release when the "Version Packages"
// merge commit lands on `main`. The trigger is NOT the changesets-action
// `published` output: every package here is private/`access: restricted`, so
// `changeset publish` is inert and `published` is ALWAYS false (spec §D2). The
// release.yml job gates on the head-commit subject beginning `Version Packages`
// (changesets' default squash-PR title; the repo squash-merges) and invokes this
// script, which applies a secondary `package.json` version-delta guard before
// cutting.
//
// Tag format (spec §D6): `release-YYYY.MM.DD-<n>` — calendar date + same-day
// monotonic ordinal, decoupled from per-package semver. The GitHub Release title
// mirrors the tag; notes are GitHub auto-generated (`--generate-notes`),
// categorised by `.github/release.yml`.
//
// Error handling (spec §5): this seam NEVER throws. Any failure to cut a tag is
// logged as a warning and the process exits 0 — cutting a release must not break
// release.yml's existing version-PR maintenance job. Mirrors the non-fatal
// posture of tools/deploy/release-notes.mjs.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TAG_RE = /^release-(\d{4}\.\d{2}\.\d{2})-(\d+)$/;

/**
 * Parse a release tag into `{ date, ordinal }`, or `null` if it does not match
 * the canonical `release-YYYY.MM.DD-<n>` shape (spec §D6). Pure, no I/O.
 */
export function parseReleaseTag(tag) {
  if (typeof tag !== "string") return null;
  const m = TAG_RE.exec(tag);
  if (!m) return null;
  return { date: m[1], ordinal: Number(m[2]) };
}

/**
 * Compute the next release tag for `dateStr` (a `YYYY.MM.DD` string INJECTED by
 * the caller — this fn never reads the clock) given the list of `existingTags`.
 *
 * The ordinal is (max `<n>` among existing tags whose date == `dateStr`) + 1,
 * else 1. Tags for other days and malformed/unrelated tags are ignored, and the
 * ordinal is max+1 (not count+1) so a gap in the sequence never re-issues a used
 * ordinal. Pure, deterministic, no I/O.
 */
export function nextReleaseTag(existingTags, dateStr) {
  const tags = Array.isArray(existingTags) ? existingTags : [];
  let max = 0;
  for (const tag of tags) {
    const parsed = parseReleaseTag(tag);
    if (parsed && parsed.date === dateStr && parsed.ordinal > max) {
      max = parsed.ordinal;
    }
  }
  return `release-${dateStr}-${max + 1}`;
}

function log(msg) {
  process.stdout.write(`[cut-release] ${msg}\n`);
}

/** Today's calendar date in the `YYYY.MM.DD` shape the tag id uses (UTC). */
function todayDateStr(now = new Date()) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd}`;
}

/**
 * I/O seam — cut the tag + GitHub Release for the current HEAD. NEVER throws:
 * every failure path logs a warning and returns, so the caller (the release.yml
 * job) exits 0 regardless (spec §5). `gh` reads `GH_TOKEN`/`GITHUB_TOKEN` from
 * the env, which the workflow provides.
 */
export function cutRelease({ cwd = process.cwd(), now = new Date() } = {}) {
  const run = (cmd, args) => spawnSync(cmd, args, { cwd, encoding: "utf8" });

  try {
    // Secondary guard (spec §D2): the HEAD commit must actually bump a
    // package.json `version`. A stray "Version Packages"-subject commit with no
    // version delta must NOT cut an empty release. Skip GREEN if absent.
    const diff = run("git", [
      "diff",
      "HEAD~1",
      "HEAD",
      "--",
      "**/package.json",
      "package.json",
    ]);
    if (diff.status !== 0) {
      log(
        `⚠ \`git diff HEAD~1 HEAD -- package.json\` failed (shallow history?) — skipping (green): ${(
          diff.stderr || ""
        ).trim()}`,
      );
      return;
    }
    const bumpsVersion = (diff.stdout || "")
      .split(/\r?\n/)
      .some((line) => /^[+-]\s*"version":/.test(line));
    if (!bumpsVersion) {
      log(
        "HEAD commit has no package.json version delta — not a Version-Packages release, skipping (green).",
      );
      return;
    }

    // Resolve HEAD sha for a stable --target.
    const headRes = run("git", ["rev-parse", "HEAD"]);
    if (headRes.status !== 0) {
      log(
        `⚠ could not resolve HEAD sha — skipping (green): ${(headRes.stderr || "").trim()}`,
      );
      return;
    }
    const headSha = (headRes.stdout || "").trim();

    // Existing release tags → next tag id.
    const tagRes = run("git", ["tag", "-l", "release-*"]);
    if (tagRes.status !== 0) {
      log(
        `⚠ \`git tag -l\` failed — skipping (green): ${(tagRes.stderr || "").trim()}`,
      );
      return;
    }
    const existingTags = (tagRes.stdout || "").split(/\r?\n/).filter(Boolean);
    const tag = nextReleaseTag(existingTags, todayDateStr(now));

    // Cut the GitHub Release with auto-generated, categorised notes. `gh`
    // creates the underlying git tag at --target when it does not yet exist.
    const rel = run("gh", [
      "release",
      "create",
      tag,
      "--generate-notes",
      "--target",
      headSha,
      "--title",
      tag,
    ]);
    if (rel.status !== 0) {
      log(
        `⚠ \`gh release create ${tag}\` failed — skipping (green): ${(
          rel.stderr || ""
        ).trim()}`,
      );
      return;
    }
    log(`cut release ${tag} at ${headSha.slice(0, 12)}.`);
  } catch (e) {
    // Belt-and-braces: the spec forbids ever failing the workflow from here.
    log(`⚠ unexpected error, skipping (green): ${e?.message ?? String(e)}`);
  }
}

// Run only as the entry point — keep the pure seams importable without any git/gh
// I/O (the same idiom as tools/deploy/release-notes.mjs).
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  cutRelease({});
}
