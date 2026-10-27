// tools/deploy/lib/registry-retention.mjs — what the container registry keeps (#3110).
//
// The registry has a fixed quota; every `main` merge and every internal PR head
// pushes five images (`registry.mjs`), so without retention it fills and every
// push fails. The owner's policy (2026-10-20, #3110): keep the production build
// and at most a couple of previous ones for rollback. Concretely, per release repo
// (`RECORDED_IMAGE_NAMES`): the targets of the latest
// RELEASES_KEPT `release-*` releases (prod + rollback targets — `pnpm deploy:prod
// --rollback` re-pulls a pruned SHA's recorded digests) ∪ the newest MAIN_SHAS_KEPT
// first-parent `main` commits that have an image (stage `main`) ∪ the newest `main`
// commit whose `stage-suite` status is `success` (the release candidate, #3240;
// an unreadable status keeps every `main` commit back to it) ∪ the SHA of the latest successful production GitHub Deployment
// (the release cut is non-fatal to a deploy, so a running SHA may have no release)
// ∪ the heads of the open `hotfix/*` branches (a hotfix is cut from production and
// pushes under the release namespace, so its pending images are on neither of the
// other lists) ∪ the open PR heads. Per `pr/*` repo: the heads of the open PRs
// (their stage slots).
//
// Deletion is by manifest digest (Docker Registry v2 has no tag delete), which
// removes every tag pointing at that digest — hence the digest guard: a digest any
// kept or non-SHA tag of the same repo resolves to is never deleted. Every unusable
// input throws a `RetentionError`, so the caller deletes nothing (fail closed).
//
// Pure: the I/O lives in `tools/deploy/registry-retention.mjs`.

import { RECORDED_IMAGE_NAMES } from "./registry.mjs";

export class RetentionError extends Error {
  constructor(message) {
    super(message);
    this.name = "RetentionError";
  }
}

export const RELEASES_KEPT = 3;
export const MAIN_SHAS_KEPT = 3;
/** How many first-parent `main` commits the `stage-suite` walk reads at most. */
export const STAGE_SUITE_WALK_DEPTH = 50;
const GREEN_STAGE_SUITE = "newest green stage-suite";
const STAGE_SUITE_UNREADABLE = "stage-suite unreadable (fail closed)";

/**
 * The release candidate: the newest `main` commit whose `stage-suite` commit status
 * is `success` (#3240) — a release refuses any other, so pruning it blocks the
 * release once `main` moves MAIN_SHAS_KEPT commits past it with a red suite.
 * `readState(sha)` resolves the state (null when there is none) and throws when the
 * status cannot be read; a throw ends the walk unconcluded at that commit.
 *
 * @returns {Promise<{greenSha: string|null, unreadableSha: string|null,
 *   reason: string|null, walked: number}>}
 */
export async function findGreenStageSuite(
  mainHistory,
  readState,
  depth = STAGE_SUITE_WALK_DEPTH,
) {
  const walk = mainHistory.slice(0, depth);
  for (let i = 0; i < walk.length; i += 1) {
    let state;
    try {
      state = await readState(walk[i]);
    } catch (error) {
      return {
        greenSha: null,
        unreadableSha: walk[i],
        reason: `stage-suite of ${walk[i]} could not be read: ${error.message}`,
        walked: i + 1,
      };
    }
    if (state === "success")
      return {
        greenSha: walk[i],
        unreadableSha: null,
        reason: null,
        walked: i + 1,
      };
  }
  return {
    greenSha: null,
    unreadableSha: null,
    reason: `no green stage-suite among the newest ${depth} main commits`,
    walked: walk.length,
  };
}

/** The SHAs the `stage-suite` walk keeps, each with its reason. */
function stageSuiteKeeps(stageSuite, mainHistory) {
  if (!stageSuite || typeof stageSuite !== "object") {
    throw new RetentionError(
      "stage-suite walk result missing — refusing to decide what the release candidate is",
    );
  }
  const { greenSha, unreadableSha } = stageSuite;
  for (const [name, value] of [
    ["green", greenSha],
    ["unreadable", unreadableSha],
  ]) {
    if (value != null && !FULL_SHA_RE.test(String(value))) {
      throw new RetentionError(
        `stage-suite walk: ${name} commit ${JSON.stringify(value)} is not a full 40-character SHA`,
      );
    }
    if (value != null && !mainHistory.includes(value)) {
      throw new RetentionError(
        `stage-suite walk: ${name} commit ${value} is not in main history`,
      );
    }
  }
  if (greenSha && unreadableSha) {
    throw new RetentionError(
      "stage-suite walk: both a green and an unreadable commit — inconsistent result",
    );
  }
  if (unreadableSha) {
    const upTo = mainHistory.indexOf(unreadableSha);
    return mainHistory
      .slice(0, upTo + 1)
      .map((s) => [s, STAGE_SUITE_UNREADABLE]);
  }
  return greenSha ? [[greenSha, GREEN_STAGE_SUITE]] : [];
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const RELEASE_TAG_RE = /^release-(\d{4})\.(\d{2})\.(\d{2})-(\d+)$/;

/** The repositories retention manages, release namespace first. */
export function retentionRepos() {
  return [
    ...RECORDED_IMAGE_NAMES,
    ...RECORDED_IMAGE_NAMES.map((name) => `pr/${name}`),
  ];
}

function releaseOrderKey(tag) {
  const m = tag.match(RELEASE_TAG_RE);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
}

function compareKeysDesc(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

/** SHAs of the latest `keep` `release-YYYY.MM.DD-N` releases, newest first. */
function latestReleaseShas(releases, keep) {
  if (!Array.isArray(releases) || releases.length === 0) {
    throw new RetentionError(
      "no releases listed — refusing to decide what production may roll back to",
    );
  }
  const ordered = releases
    .map((r) => ({ ...r, key: releaseOrderKey(String(r?.tag ?? "")) }))
    .filter((r) => r.key)
    .sort((a, b) => compareKeysDesc(a.key, b.key));
  if (ordered.length === 0) {
    throw new RetentionError(
      "no release-YYYY.MM.DD-N release listed — refusing to decide what production runs",
    );
  }
  return ordered.slice(0, keep).map((r) => {
    if (!FULL_SHA_RE.test(String(r.sha ?? ""))) {
      throw new RetentionError(
        `release ${r.tag} targets ${JSON.stringify(r.sha)}, not a full 40-character SHA — cannot resolve what it deployed`,
      );
    }
    return r.sha;
  });
}

function assertShaList(list, what) {
  if (!Array.isArray(list))
    throw new RetentionError(
      `${what} not listed — refusing to delete anything`,
    );
  for (const s of list) {
    if (!FULL_SHA_RE.test(String(s ?? ""))) {
      throw new RetentionError(
        `${what}: ${JSON.stringify(s)} is not a full 40-character SHA`,
      );
    }
  }
}

function assertTagListing(tags, repos) {
  if (!tags || typeof tags !== "object")
    throw new RetentionError("no registry tag listing");
  for (const repo of repos) {
    const list = tags[repo];
    if (!Array.isArray(list))
      throw new RetentionError(`no tag listing for repository ${repo}`);
    for (const entry of list) {
      if (typeof entry?.tag !== "string" || !entry.tag) {
        throw new RetentionError(
          `repository ${repo}: a tag entry has no tag name`,
        );
      }
      if (!DIGEST_RE.test(String(entry.digest ?? ""))) {
        throw new RetentionError(
          `repository ${repo}: tag ${entry.tag} resolved to ${JSON.stringify(entry.digest)}, not a sha256 digest`,
        );
      }
    }
  }
}

/**
 * @param {object} input
 * @param {Record<string, {tag: string, digest: string}[]>} input.tags every repo of
 *   `retentionRepos()` → its tags, each resolved to its manifest digest
 * @param {{tag: string, sha: string}[]} input.releases GitHub Releases (any order)
 * @param {string[]} input.mainHistory first-parent `main` commits, newest first
 * @param {string[]} input.openPrHeads head SHAs of the open PRs
 * @param {string[]} input.hotfixHeads head SHAs of the `hotfix/*` branches
 * @param {string} input.productionSha SHA of the latest successful production
 *   GitHub Deployment
 * @param {object} input.stageSuite the `findGreenStageSuite` result over
 *   `mainHistory`
 */
export function planRetention({
  tags,
  releases,
  mainHistory,
  openPrHeads,
  hotfixHeads,
  productionSha,
  stageSuite,
}) {
  const repos = retentionRepos();
  assertTagListing(tags, repos);
  const releaseShas = latestReleaseShas(releases, RELEASES_KEPT);
  assertShaList(mainHistory, "main history");
  if (mainHistory.length === 0)
    throw new RetentionError(
      "main history is empty — refusing to delete anything",
    );
  assertShaList(openPrHeads, "open PR heads");
  assertShaList(hotfixHeads, "hotfix branch heads");
  if (!FULL_SHA_RE.test(String(productionSha ?? ""))) {
    throw new RetentionError(
      `latest successful production deployment: ${JSON.stringify(productionSha)} is not a full 40-character SHA — refusing to decide what production runs`,
    );
  }
  const stageSuiteKept = stageSuiteKeeps(stageSuite, mainHistory);

  const releaseRepos = repos.filter((r) => !r.startsWith("pr/"));
  const inRegistry = new Set(
    releaseRepos.flatMap((repo) => tags[repo].map((t) => t.tag)),
  );
  const mainShas = mainHistory
    .filter((s) => inRegistry.has(s))
    .slice(0, MAIN_SHAS_KEPT);

  const releaseKeep = new Map();
  for (const s of releaseShas) releaseKeep.set(s, "release");
  const keepOnce = (s, reason) => {
    if (!releaseKeep.has(s)) releaseKeep.set(s, reason);
  };
  keepOnce(productionSha, "production deployment");
  for (const s of mainShas) keepOnce(s, "main");
  for (const [s, reason] of stageSuiteKept) keepOnce(s, reason);
  for (const s of hotfixHeads) keepOnce(s, "hotfix branch");
  for (const s of openPrHeads) keepOnce(s, "open PR");
  const prKeep = new Map(openPrHeads.map((s) => [s, "open PR"]));

  const plan = repos.map((repo) => {
    const keepSet = repo.startsWith("pr/") ? prKeep : releaseKeep;
    const keep = [];
    const ignored = [];
    const candidates = [];
    for (const entry of tags[repo]) {
      if (!FULL_SHA_RE.test(entry.tag))
        ignored.push({ tag: entry.tag, digest: entry.digest });
      else if (keepSet.has(entry.tag))
        keep.push({
          tag: entry.tag,
          digest: entry.digest,
          reason: keepSet.get(entry.tag),
        });
      else candidates.push({ tag: entry.tag, digest: entry.digest });
    }
    const protectedDigests = new Set(
      [...keep, ...ignored].map((t) => t.digest),
    );
    const guarded = [];
    const byDigest = new Map();
    for (const c of candidates) {
      if (protectedDigests.has(c.digest)) guarded.push(c);
      else byDigest.set(c.digest, [...(byDigest.get(c.digest) ?? []), c.tag]);
    }
    const del = [...byDigest.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([digest, tagList]) => ({ digest, tags: tagList.sort() }));
    return {
      repo,
      total: tags[repo].length,
      keep,
      delete: del,
      guarded,
      ignored,
    };
  });

  return {
    releaseShas,
    mainShas,
    productionSha,
    stageSuite: {
      greenSha: stageSuite.greenSha ?? null,
      unreadableSha: stageSuite.unreadableSha ?? null,
      reason: stageSuite.reason ?? null,
      walked: stageSuite.walked ?? null,
    },
    hotfixHeads: [...hotfixHeads],
    openPrHeads: [...openPrHeads],
    repos: plan,
  };
}

function stageSuiteSummary({ greenSha, unreadableSha, reason, walked }) {
  if (greenSha)
    return `Release candidate kept (${GREEN_STAGE_SUITE}, ${walked} of at most ${STAGE_SUITE_WALK_DEPTH} main commits read): \`${greenSha}\``;
  if (unreadableSha)
    return `${STAGE_SUITE_UNREADABLE}: every main commit back to and including \`${unreadableSha}\` kept — ${reason}`;
  return `Release candidate: none kept — ${reason}`;
}

/** Markdown for `$GITHUB_STEP_SUMMARY` and the log. */
export function renderPlanSummary(plan, { dryRun }) {
  const lines = [
    `### Registry retention — ${dryRun ? "dry run (nothing deleted)" : "deleting"}`,
    "",
    `- Releases kept (latest ${RELEASES_KEPT}): ${plan.releaseShas.map((s) => `\`${s}\``).join(", ")}`,
    `- Main SHAs kept (newest ${MAIN_SHAS_KEPT} with an image): ${plan.mainShas.map((s) => `\`${s}\``).join(", ") || "none"}`,
    `- Latest successful production deployment kept: \`${plan.productionSha}\``,
    `- ${stageSuiteSummary(plan.stageSuite)}`,
    `- Hotfix branch heads kept: ${plan.hotfixHeads.map((s) => `\`${s}\``).join(", ") || "none"}`,
    `- Open PR heads kept (release and \`pr/\` repos): ${plan.openPrHeads.length}`,
    "",
    "| repo | tags | kept tags | deleted tags | digests to delete | guarded tags | non-SHA tags |",
    "| ---- | ---- | --------- | ------------ | ----------------- | ------------ | ------------ |",
  ];
  for (const r of plan.repos) {
    const deletedTags = r.delete.reduce((n, d) => n + d.tags.length, 0);
    lines.push(
      `| ${r.repo} | ${r.total} | ${r.keep.length} | ${deletedTags} | ${r.delete.length} | ${r.guarded.length} | ${r.ignored.length} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** The `rel="next"` target of a registry `Link` header, or null. */
export function parseNextLink(header) {
  if (!header) return null;
  const m = String(header).match(/<([^>]+)>\s*;\s*rel="?next"?/);
  return m ? m[1] : null;
}

/**
 * The next `tags/list` request for `repo`, or `next: null` when the listing is
 * complete. Some registries cap a page without a `Link` header, so a Link-less page
 * does not prove the end: it is confirmed by a `last=` probe (the Registry v2
 * pagination parameter), which must come back empty. A probe answered with only
 * already-listed tags means the registry ignores `last=` — completeness cannot be
 * proven, and an incomplete listing would let an unlisted kept tag's digest be
 * deleted, so that throws.
 *
 * @returns {{next: string|null, probe: boolean, fresh: string[]}} `fresh` = the
 *   page's tags not listed before
 */
export function nextTagRequest({ repo, page, known, link, probed, pageSize }) {
  const fresh = page.filter((t) => !known.has(t));
  if (probed && page.length > 0 && fresh.length === 0) {
    throw new RetentionError(
      `listing ${repo}: the registry ignored last= and repeated known tags — cannot prove the tag listing is complete`,
    );
  }
  if (link) return { next: link, probe: false, fresh };
  if (page.length === 0) return { next: null, probe: false, fresh };
  const last = page[page.length - 1];
  return {
    next: `/v2/${repo}/tags/list?n=${pageSize}&last=${encodeURIComponent(last)}`,
    probe: true,
    fresh,
  };
}

/** `{realm, service, scope}` of a `WWW-Authenticate: Bearer …` challenge, or null. */
export function parseBearerChallenge(header) {
  const text = String(header ?? "");
  if (!/^Bearer\s/i.test(text)) return null;
  const out = {};
  for (const m of text.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
