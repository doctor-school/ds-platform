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

import { extractPrNumbers } from "../deploy/release-notes.mjs";

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

/**
 * All `release-*` tags in `existingTags`, newest FIRST, by the same (date,
 * ordinal) key `latestReleaseTag` maxes over. Malformed / unrelated tags are
 * dropped. Pure, deterministic, no I/O.
 */
export function sortReleaseTagsDesc(existingTags) {
  const tags = Array.isArray(existingTags) ? existingTags : [];
  return tags
    .map((tag) => ({ tag, parsed: parseReleaseTag(tag) }))
    .filter((e) => e.parsed !== null)
    .map((e) => ({
      tag: e.tag,
      key: `${e.parsed.date}#${String(e.parsed.ordinal).padStart(9, "0")}`,
    }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
    .map((e) => e.tag);
}

/**
 * The BASE release tag a new release's range starts at: the newest `release-*`
 * tag that is an ANCESTOR of the target SHA (#1881, spec §10.11) — not simply
 * the newest tag overall.
 *
 * Why ancestry and not tag order. A hotfix release is cut off the DEPLOYED SHA,
 * so it sits on a commit that is not on `origin/main`; the next ordinary
 * `origin/main` deploy therefore has a newest-by-order tag (the hotfix one) that
 * is NOT its ancestor. Basing on tag order there would either skip the cut (the
 * old `releaseIsAncestor === false` → skip rule) or diff against an unrelated
 * commit. Walking newest→oldest and taking the first ancestor gives both sides
 * the right base: the hotfix release bases on the deployed release, and the next
 * main release bases on the last release that IS on main.
 *
 * `isAncestor(tag)` is injected — the git query lives in `cutDeployRelease`, so
 * this stays pure and unit-testable.
 *
 * @param {string[]} existingTags
 * @param {(tag: string) => boolean} isAncestor
 * @returns {string|null}
 */
export function pickBaseReleaseTag(existingTags, isAncestor) {
  const probe = typeof isAncestor === "function" ? isAncestor : () => false;
  for (const tag of sortReleaseTagsDesc(existingTags)) {
    if (probe(tag)) return tag;
  }
  return null;
}

/**
 * The GitHub Release title + notes preamble for a HOTFIX cut (#1881). A hotfix
 * release must be identifiable at a glance in the Releases list — it does not
 * contain everything on `main` at that moment, only the deployed base plus the
 * cherry-picked fixes, and the PR list says exactly which. Pure.
 *
 * @param {{ tag: string, baseTag: string|null, prNumbers?: number[] }} facts
 * @returns {{ title: string, notes: string }}
 */
export function hotfixReleaseCopy({ tag, baseTag, prNumbers = [] } = {}) {
  const prs = Array.isArray(prNumbers) ? prNumbers : [];
  const base = baseTag ?? "(no prior release)";
  const picked = prs.length
    ? prs.map((n) => `- Cherry-picked #${n}`).join("\n")
    : "- No PR-referencing commits in the hotfix range.";
  return {
    title: `${tag} — Hotfix`,
    notes:
      `**Hotfix release.** Cut on top of \`${base}\` (the SHA running in production), NOT on \`main\`.\n` +
      `It contains the deployed base plus the cherry-picked fixes below — nothing else merged to \`main\` since.\n\n` +
      `${picked}\n`,
  };
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
 * `hotfix: true` (set by the `pnpm deploy:prod --ref <sha>` path, #1881) marks the
 * Release as a hotfix — the title carries the marker and the notes name the
 * cherry-picked PRs, because such a release does NOT contain everything on `main`
 * at cut time.
 *
 * @param {{ targetSha: string, hotfix?: boolean, cwd?: string, now?: Date, run?: (cmd: string, args: string[]) => { status: number|null, stdout?: string, stderr?: string } }} opts
 * @returns {{ cut: boolean, tag?: string, reason: string }}
 */
export function cutDeployRelease({
  targetSha,
  hotfix = false,
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

    // Resolve a tag to its commit SHA (`rev-list -n 1` dereferences an annotated
    // tag). Memoised so the newest→oldest ancestry walk resolves each tag once.
    const shaCache = new Map();
    const tagSha = (tag) => {
      if (shaCache.has(tag)) return shaCache.get(tag);
      const res = exec("git", ["rev-list", "-n", "1", tag]);
      const sha = res.status === 0 ? (res.stdout || "").trim() : null;
      shaCache.set(tag, sha);
      return sha;
    };

    // BASE tag = the newest `release-*` tag that is an ANCESTOR of the target
    // (#1881, spec §10.11) — the tag order alone is wrong once a hotfix release
    // exists off `main`. `merge-base --is-ancestor A B` exits 0 when A is an
    // ancestor of B; a tag at the target SHA counts (that is the redeploy case
    // the pure guard rejects next, by an empty range).
    const baseTag = pickBaseReleaseTag(existingTags, (tag) => {
      const sha = tagSha(tag);
      if (!sha) return false;
      if (sha === targetSha) return true;
      return (
        exec("git", ["merge-base", "--is-ancestor", sha, targetSha]).status === 0
      );
    });
    const latestReleaseSha = baseTag ? tagSha(baseTag) : null;

    // Non-empty-range guard (spec §10.5): the target must be a strict descendant
    // of the base release. With an ancestor-picked base, `releaseIsAncestor` is
    // true by construction whenever a base was found and it is not the target
    // itself; when NO tag is an ancestor the guard skips the cut, as before.
    const releaseIsAncestor = Boolean(
      latestReleaseSha && latestReleaseSha !== targetSha,
    );

    // Releases exist, but none of them is an ancestor of the target: the target
    // is behind or on an unrelated line of history. Never cut a backwards or
    // empty release (the pre-#1881 `releaseIsAncestor === false` branch).
    if (!latestReleaseSha && sortReleaseTagsDesc(existingTags).length > 0) {
      const reason =
        "no release tag is an ancestor of the target SHA (behind / diverged)";
      log(`no release cut — ${reason}.`);
      return { cut: false, reason };
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
    // the BASE tag (`--notes-start-tag`), not since whatever tag happens to sort
    // newest. `gh` creates the underlying git tag at --target (the deployed SHA)
    // when it does not yet exist.
    const args = ["release", "create", tag, "--generate-notes"];
    if (baseTag) args.push("--notes-start-tag", baseTag);
    args.push("--target", targetSha);

    if (hotfix) {
      // The cherry-picked PR list, from the same `(#N)` subject convention the
      // release digest reads (shared `extractPrNumbers` — never re-parsed here).
      let prNumbers = [];
      if (baseTag) {
        const logRes = exec("git", [
          "log",
          "--format=%s",
          `${baseTag}..${targetSha}`,
        ]);
        if (logRes.status === 0) {
          prNumbers = extractPrNumbers(
            (logRes.stdout || "").split(/\r?\n/).filter(Boolean),
          );
        }
      }
      const copy = hotfixReleaseCopy({ tag, baseTag, prNumbers });
      args.push("--title", copy.title, "--notes", copy.notes);
    } else {
      args.push("--title", tag);
    }

    const rel = exec("gh", args);
    if (rel.status !== 0) {
      log(
        `⚠ \`gh release create ${tag}\` failed — skipping (green): ${(
          rel.stderr || ""
        ).trim()}`,
      );
      return { cut: false, reason: "gh release create failed" };
    }
    log(
      `cut ${hotfix ? "HOTFIX release" : "release"} ${tag} at ${targetSha.slice(0, 12)}` +
        ` (base ${baseTag ?? "none"}; ${decision.reason}).`,
    );
    return { cut: true, tag, reason: decision.reason };
  } catch (e) {
    // Belt-and-braces: never fail the deploy from here (spec §5).
    log(`⚠ unexpected error, skipping (green): ${e?.message ?? String(e)}`);
    return { cut: false, reason: "unexpected error" };
  }
}
