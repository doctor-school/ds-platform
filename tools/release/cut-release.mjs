#!/usr/bin/env node
// tools/release/cut-release.mjs — L1 of #927 (Issue #943), relocated to the
// deploy pipeline by #996/§10.5 (Issue #999, "Option A").
//
// The agent-run `pnpm deploy:prod` is now the release INITIATOR: on a successful
// deploy, `tools/deploy/prod.mjs` calls `cutDeployRelease(...)` here to cut ONE
// repo-level git tag + GitHub Release at the DEPLOYED SHA, so a changeset-less
// product/app-only wave still lands in a `release-*` Release — "release == what
// shipped" (spec §10.5). The former trigger (the `Version Packages` merge, via
// the retired `release.yml` `tag-release` job with a `package.json` version-delta
// guard) NEVER fired for such a wave; that guard is replaced here by the
// non-empty-range guard (`shouldCutDeployRelease`): cut only if the deployed SHA
// is a strict descendant of the latest `release-*` tag. Per-package `version` +
// `CHANGELOG.md` maintenance stays on the changesets `release` job (§D1); only the
// repo-level release cut moved to deploy time.
//
// Tag format (spec §D6): `release-YYYY.MM.DD-<n>` — calendar date + same-day
// monotonic ordinal, decoupled from per-package semver. The GitHub Release title
// mirrors the tag; notes are GitHub auto-generated (`--generate-notes` diffs since
// the previous release), categorised by `.github/release.yml`.
//
// Error handling (spec §5): the I/O seam NEVER throws. Any failure to cut a tag is
// logged as a warning and the seam returns `{ cut: false }` — cutting a release is
// non-fatal to the deploy, which has already succeeded. Mirrors the non-fatal
// posture of tools/deploy/release-notes.mjs. The pure seams (`parseReleaseTag`,
// `nextReleaseTag`, `latestReleaseTag`, `shouldCutDeployRelease`) do no I/O and are
// unit-tested directly (`tools/lint/guard-tests/cut-release.spec.ts`).

import { spawnSync } from "node:child_process";

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

/**
 * Return the most recent `release-*` tag among `existingTags`, or `null` if none
 * match. "Most recent" = max by (date, ordinal): the `YYYY.MM.DD` date sorts
 * lexically == chronologically, and the ordinal is zero-padded so `-10` beats
 * `-2`. Malformed / unrelated tags are ignored. Pure, deterministic, no I/O.
 */
export function latestReleaseTag(existingTags) {
  const tags = Array.isArray(existingTags) ? existingTags : [];
  let best = null;
  let bestKey = null;
  for (const tag of tags) {
    const parsed = parseReleaseTag(tag);
    if (!parsed) continue;
    const key = `${parsed.date}#${String(parsed.ordinal).padStart(9, "0")}`;
    if (bestKey === null || key > bestKey) {
      bestKey = key;
      best = tag;
    }
  }
  return best;
}

/**
 * Non-empty-range guard for the deploy-initiated cut (spec §10.5). Decide whether
 * to cut a release, given the git-range facts the caller resolved (all pure — the
 * git/gh queries live in `cutDeployRelease`). Rule: cut only if the deployed SHA is
 * a STRICT descendant of the latest `release-*` tag — i.e. the range
 * `latestReleaseSha..deployedSha` (commits reachable from the deployed SHA but not
 * from the release tag) is non-empty.
 *
 *   - No prior release tag (first ever release)            → cut.
 *   - deployedSha === latestReleaseSha (redeploy)          → skip (empty range).
 *   - latest release NOT an ancestor of the deployed SHA   → skip (nothing new /
 *     behind / diverged — never cut an empty or backwards release).
 *   - otherwise (new commits since the last release)       → cut.
 *
 * Note the operand order: `git A..B` is "in B, not in A"; a normal forward deploy
 * has new commits AFTER the last release, so the last-release tag is `A` and the
 * deployed SHA is `B`. Equivalent to
 * `git rev-list --count latestReleaseSha..deployedSha > 0`.
 *
 * @param {{ latestReleaseSha: string|null, deployedSha: string, releaseIsAncestor?: boolean }} facts
 * @returns {{ cut: boolean, reason: string }}
 */
export function shouldCutDeployRelease({
  latestReleaseSha,
  deployedSha,
  releaseIsAncestor = false,
} = {}) {
  if (!deployedSha) return { cut: false, reason: "no deployed SHA" };
  if (!latestReleaseSha)
    return { cut: true, reason: "no prior release — first release" };
  if (deployedSha === latestReleaseSha)
    return {
      cut: false,
      reason: "deployed SHA already released (empty range)",
    };
  if (!releaseIsAncestor)
    return {
      cut: false,
      reason:
        "latest release is not an ancestor of the deployed SHA (nothing new / diverged)",
    };
  return { cut: true, reason: "new commits since the latest release" };
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
 * I/O seam — cut the tag + GitHub Release for the DEPLOYED SHA (spec §10.5,
 * Option A). Called in-process by `tools/deploy/prod.mjs` after a successful
 * deploy, BEFORE `recordDeployment`, so the Deployment record references the
 * freshly-cut tag. NEVER throws: every failure path logs a warning and returns
 * `{ cut: false }` — the cut is non-fatal to the deploy (spec §5). `gh` reads
 * `GH_TOKEN`/`GITHUB_TOKEN` (or the local `gh` auth) from the environment.
 *
 * `targetSha` is the explicit deployed SHA (`origin/main`'s SHA the deploy fixed
 * at pre-flight) — NOT local `HEAD`, so the tag lands on exactly what shipped even
 * when local `HEAD` differs (the deploy tool may run from a maintenance branch).
 *
 * @param {{ targetSha: string, cwd?: string, now?: Date, run?: (cmd: string, args: string[]) => { status: number|null, stdout?: string, stderr?: string } }} opts
 * @returns {{ cut: boolean, tag?: string, reason: string }}
 */
export function cutDeployRelease({
  targetSha,
  cwd = process.cwd(),
  now = new Date(),
  run,
} = {}) {
  const exec =
    run || ((cmd, args) => spawnSync(cmd, args, { cwd, encoding: "utf8" }));

  try {
    if (!targetSha || !/^[0-9a-f]{7,40}$/i.test(targetSha)) {
      log(
        `⚠ deploy-initiated cut needs an explicit target SHA, got: ${
          targetSha ?? "(none)"
        } — skipping (green).`,
      );
      return { cut: false, reason: "no valid target SHA" };
    }

    // The deploy env fetches origin/main but not tags — make the `release-*` tags
    // present locally so the range guard sees the real latest release. Non-fatal:
    // fall through to whatever tags exist if the fetch fails.
    const fetched = exec("git", ["fetch", "--tags", "--force", "origin"]);
    if (fetched.status !== 0) {
      log(
        `⚠ \`git fetch --tags\` failed (continuing with local tags): ${(
          fetched.stderr || ""
        ).trim()}`,
      );
    }

    const tagRes = exec("git", ["tag", "-l", "release-*"]);
    if (tagRes.status !== 0) {
      log(
        `⚠ \`git tag -l\` failed — skipping (green): ${(tagRes.stderr || "").trim()}`,
      );
      return { cut: false, reason: "git tag -l failed" };
    }
    const existingTags = (tagRes.stdout || "").split(/\r?\n/).filter(Boolean);
    const latestTag = latestReleaseTag(existingTags);

    // Resolve the latest release tag's commit SHA (null when no release exists
    // yet). `rev-list -n 1` dereferences an annotated tag to its commit.
    let latestReleaseSha = null;
    if (latestTag) {
      const shaRes = exec("git", ["rev-list", "-n", "1", latestTag]);
      if (shaRes.status !== 0) {
        log(
          `⚠ could not resolve SHA of ${latestTag} — skipping (green): ${(
            shaRes.stderr || ""
          ).trim()}`,
        );
        return { cut: false, reason: `cannot resolve ${latestTag}` };
      }
      latestReleaseSha = (shaRes.stdout || "").trim();
    }

    // Non-empty-range guard (spec §10.5): the deployed SHA must be a strict
    // descendant of the latest release. `merge-base --is-ancestor A B` exits 0
    // when A is an ancestor of B; only checked when the two SHAs differ (an equal
    // SHA is an ancestor of itself, but that is the empty-range redeploy case the
    // pure guard rejects first).
    let releaseIsAncestor = false;
    if (latestReleaseSha && latestReleaseSha !== targetSha) {
      releaseIsAncestor =
        exec("git", [
          "merge-base",
          "--is-ancestor",
          latestReleaseSha,
          targetSha,
        ]).status === 0;
    }

    const decision = shouldCutDeployRelease({
      latestReleaseSha,
      deployedSha: targetSha,
      releaseIsAncestor,
    });
    if (!decision.cut) {
      log(`no release cut — ${decision.reason}.`);
      return { cut: false, reason: decision.reason };
    }

    const tag = nextReleaseTag(existingTags, todayDateStr(now));

    // Cut the GitHub Release with auto-generated, categorised notes diffed since
    // the previous release. `gh` creates the underlying git tag at --target (the
    // deployed SHA) when it does not yet exist.
    const rel = exec("gh", [
      "release",
      "create",
      tag,
      "--generate-notes",
      "--target",
      targetSha,
      "--title",
      tag,
    ]);
    if (rel.status !== 0) {
      log(
        `⚠ \`gh release create ${tag}\` failed — skipping (green): ${(
          rel.stderr || ""
        ).trim()}`,
      );
      return { cut: false, reason: "gh release create failed" };
    }
    log(
      `cut release ${tag} at ${targetSha.slice(0, 12)} (${decision.reason}).`,
    );
    return { cut: true, tag, reason: decision.reason };
  } catch (e) {
    // Belt-and-braces: never fail the deploy from here (spec §5).
    log(`⚠ unexpected error, skipping (green): ${e?.message ?? String(e)}`);
    return { cut: false, reason: "unexpected error" };
  }
}
