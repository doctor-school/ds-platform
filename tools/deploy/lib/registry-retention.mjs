// tools/deploy/lib/registry-retention.mjs — what the container registry keeps (#3110).
//
// The registry has a fixed quota; every `main` merge and every head of a
// `stage-slot`-labelled internal PR pushes six images (`RECORDED_IMAGE_NAMES`,
// `registry.mjs`), so without retention it fills and every
// push fails. The owner's policy (2026-10-20, #3110): keep the production build
// and at most a couple of previous ones for rollback. Concretely, per release repo
// (`RECORDED_IMAGE_NAMES`): the targets of the latest
// RELEASES_KEPT `release-*` releases (prod + rollback targets — `pnpm deploy:prod
// --rollback` re-pulls a pruned SHA's recorded digests) ∪ the newest MAIN_SHAS_KEPT
// first-parent `main` commits that have an image (stage `main`) ∪ the newest `main`
// commit whose `stage-suite` status is `success` (the release candidate, #3240)
// ∪ every newer first-parent `main` commit whose `stage-suite` is still in flight —
// `pending`, or not yet set while a Stage main run for it is queued or running — so
// a candidate whose suite is running keeps its images however far `main` moves
// (#3752) ∪ the target of every queued or in-progress `deploy-prod.yml` run, so a
// dispatched release, rollback or redeploy never loses its images (#3654) ∪ the SHA of the latest successful production GitHub Deployment
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
// Pure: the I/O lives in `tools/deploy/registry-retention.mjs`; `readRegistryDisk`
// takes its `fetch` from the caller.

import { RECORDED_IMAGE_NAMES } from "./registry.mjs";

export class RetentionError extends Error {
  constructor(message) {
    super(message);
    this.name = "RetentionError";
  }
}

export const RELEASES_KEPT = 3;
export const MAIN_SHAS_KEPT = 3;
/** How many first-parent `main` commits the `stage-suite` walk reads at most — a
 *  cost bound (one status read each), not a policy: ~10 days of `main` at the
 *  observed 142 first-parent commits a week, within the token's hourly API budget. */
export const STAGE_SUITE_WALK_DEPTH = 200;
const GREEN_STAGE_SUITE = "newest green stage-suite";
const IN_FLIGHT_STAGE_SUITE = "in-flight stage-suite";
const DEPLOY_PROD_RUN = "deploy-prod run";

/**
 * The release candidate: the newest `main` commit whose `stage-suite` commit status
 * is `success` (#3240) — a release refuses any other. `readState(sha)` resolves the
 * state (null when there is none) and throws when the status cannot be read. The walk
 * stops at the first green commit, at the first unreadable status (the candidate may
 * lie further back, so nothing past it is known) or at `depth` commits. `ahead` holds
 * the states read before the green commit, newest first — the commits whose suite
 * may still be in flight (#3752).
 * Shared by registry retention and `pnpm release:lane` (#3561).
 *
 * @returns {Promise<{greenSha: string | null, walked: number,
 *   unreadable: {sha: string, message: string} | null, bounded: boolean,
 *   ahead: {sha: string, state: string | null}[]}>}
 */
export async function newestGreenStageSuite(
  mainHistory,
  readState,
  depth = STAGE_SUITE_WALK_DEPTH,
) {
  const walk = mainHistory.slice(0, depth);
  const ahead = [];
  for (let i = 0; i < walk.length; i += 1) {
    let state;
    try {
      state = await readState(walk[i]);
    } catch (error) {
      return {
        greenSha: null,
        walked: i + 1,
        unreadable: { sha: walk[i], message: error.message },
        bounded: false,
        ahead,
      };
    }
    if (state === "success")
      return {
        greenSha: walk[i],
        walked: i + 1,
        unreadable: null,
        bounded: false,
        ahead,
      };
    ahead.push({ sha: walk[i], state: state ?? null });
  }
  return {
    greenSha: null,
    walked: walk.length,
    unreadable: null,
    bounded: walk.length === depth,
    ahead,
  };
}

/**
 * The release candidate retention keeps. Pruning it blocks the release once `main`
 * moves MAIN_SHAS_KEPT commits past it with a red suite, so a walk that does not find
 * it — an unreadable status, or the bound reached — throws a `RetentionError`: no
 * partial keep is safe and nothing is deleted.
 *
 * @returns {Promise<{greenSha: string, walked: number,
 *   ahead: {sha: string, state: string | null}[]}>}
 */
export async function findGreenStageSuite(
  mainHistory,
  readState,
  depth = STAGE_SUITE_WALK_DEPTH,
) {
  const result = await newestGreenStageSuite(mainHistory, readState, depth);
  if (result.greenSha)
    return {
      greenSha: result.greenSha,
      walked: result.walked,
      ahead: result.ahead,
    };
  if (result.unreadable)
    throw new RetentionError(
      `stage-suite of main commit ${result.unreadable.sha} could not be read (${result.unreadable.message}) — the release candidate may lie further back; refusing to delete anything`,
    );
  throw new RetentionError(
    result.bounded
      ? `no green stage-suite among the newest ${depth} main commits (STAGE_SUITE_WALK_DEPTH) — the release candidate is further back or absent; refusing to delete anything`
      : `no green stage-suite among all ${result.walked} main commits — refusing to delete anything`,
  );
}

/** The release candidate `planRetention` keeps; anything else is unusable. */
function stageSuiteKeep(stageSuite, mainHistory) {
  const greenSha = stageSuite?.greenSha;
  if (greenSha == null) {
    throw new RetentionError(
      "stage-suite walk found no release candidate — refusing to delete anything",
    );
  }
  if (!FULL_SHA_RE.test(String(greenSha))) {
    throw new RetentionError(
      `stage-suite walk: green commit ${JSON.stringify(greenSha)} is not a full 40-character SHA`,
    );
  }
  if (!mainHistory.includes(greenSha)) {
    throw new RetentionError(
      `stage-suite walk: green commit ${greenSha} is not in main history`,
    );
  }
  return greenSha;
}

/**
 * The `main` commits newer than the release candidate whose `stage-suite` is still in
 * flight (#3752): `pending` (the converge or the suite is running), or no status yet
 * while a Stage main run for the commit is queued or running (`activeStageShas`). A
 * missing status with no such run is not in flight: its Stage run was replaced in the
 * queue, so no suite will run for it. Terminal states (`failure`, `error`) are not in
 * flight. The states come from the bounded walk, so this adds no status read.
 */
function inFlightKeep(stageSuite, activeStageShas, mainHistory) {
  const ahead = stageSuite?.ahead;
  if (!Array.isArray(ahead)) {
    throw new RetentionError(
      "stage-suite walk: the states ahead of the release candidate are not listed — refusing to delete anything",
    );
  }
  assertShaList(activeStageShas, "queued or running Stage main runs");
  const active = new Set(activeStageShas);
  const out = [];
  for (const entry of ahead) {
    const s = String(entry?.sha ?? "");
    if (!FULL_SHA_RE.test(s) || !mainHistory.includes(s)) {
      throw new RetentionError(
        `stage-suite walk: commit ${JSON.stringify(entry?.sha ?? null)} ahead of the release candidate is not a main commit`,
      );
    }
    const state = entry.state ?? null;
    if (state === "pending" || (state === null && active.has(s))) out.push(s);
  }
  return out;
}

/**
 * The target SHA of each queued or in-progress run of `workflow` (`deploy-prod` or
 * `stage`), read from its title: both workflows set `run-name` to end with the target
 * SHA (`deploy-prod.yml`: the `sha` input; `stage.yml`: the triggering Runtime images
 * run's head SHA). A run's own `head_sha` is the head of the ref it ran on, not its
 * target. A run whose title does not end with a full SHA (one started before
 * `run-name`, or a malformed input) throws: its target is unknown, so nothing is
 * deleted until it completes.
 *
 * @param {{id: number, title?: string, url?: string}[]} runs
 * @returns {string[]}
 */
export function activeRunTargets(runs, workflow) {
  if (!Array.isArray(runs))
    throw new RetentionError(
      `queued or running ${workflow} runs not listed — refusing to delete anything`,
    );
  return runs.map((run) => {
    const m = String(run?.title ?? "").match(/ ([0-9a-f]{40})$/);
    if (!m)
      throw new RetentionError(
        `${workflow} run ${run?.url ?? run?.id ?? "?"} is queued or running, but its title ${JSON.stringify(run?.title ?? null)} names no target SHA — refusing to delete anything until it completes`,
      );
    return m[1];
  });
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
 * @param {string[]} input.activeStageShas targets of the queued or running Stage
 *   main runs (`activeRunTargets`)
 * @param {string[]} input.deployTargets targets of the queued or running
 *   `deploy-prod.yml` runs (`activeRunTargets`)
 */
export function planRetention({
  tags,
  releases,
  mainHistory,
  openPrHeads,
  hotfixHeads,
  productionSha,
  stageSuite,
  activeStageShas,
  deployTargets,
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
  const greenSha = stageSuiteKeep(stageSuite, mainHistory);
  const inFlightShas = inFlightKeep(stageSuite, activeStageShas, mainHistory);
  assertShaList(deployTargets, "queued or running deploy-prod runs");

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
  keepOnce(greenSha, GREEN_STAGE_SUITE);
  for (const s of inFlightShas) keepOnce(s, IN_FLIGHT_STAGE_SUITE);
  for (const s of deployTargets) keepOnce(s, DEPLOY_PROD_RUN);
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
    stageSuite: { greenSha, walked: stageSuite.walked ?? null },
    inFlightShas,
    deployTargets: [...deployTargets],
    hotfixHeads: [...hotfixHeads],
    openPrHeads: [...openPrHeads],
    repos: plan,
  };
}

function stageSuiteSummary({ greenSha, walked }) {
  return `Release candidate kept (${GREEN_STAGE_SUITE}, ${walked ?? "?"} of at most ${STAGE_SUITE_WALK_DEPTH} main commits read): \`${greenSha}\``;
}

/** Markdown for `$GITHUB_STEP_SUMMARY` and the log. */
export function renderPlanSummary(plan, { dryRun }) {
  const list = (shas) => shas.map((s) => `\`${s}\``).join(", ") || "none";
  const lines = [
    `### Registry retention — ${dryRun ? "dry run (nothing deleted)" : "deleting"}`,
    "",
    `- Releases kept (latest ${RELEASES_KEPT}): ${plan.releaseShas.map((s) => `\`${s}\``).join(", ")}`,
    `- Main SHAs kept (newest ${MAIN_SHAS_KEPT} with an image): ${plan.mainShas.map((s) => `\`${s}\``).join(", ") || "none"}`,
    `- Latest successful production deployment kept: \`${plan.productionSha}\``,
    `- ${stageSuiteSummary(plan.stageSuite)}`,
    `- In-flight stage-suite kept (newer main commits whose suite is pending or queued): ${list(plan.inFlightShas)}`,
    `- Queued or running deploy-prod run targets kept: ${list(plan.deployTargets)}`,
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

// ── Registry disk usage (#3724) ─────────────────────────────────────────────────
// The quota fills silently: a full registry surfaces only as a failed `main` push
// (`403 no_free_space_left_in_registry`), and a DELETE frees space only at the
// provider's nightly GC. So every retention run reads `disk_stats` from the Timeweb
// API with a read-only, project-scoped token and reports it. The read is advisory:
// it never blocks or alters the prune; the runner fails the run at the fail ratio
// only after the prune has finished.

/** Timeweb Cloud id of the `ds-platform` registry (infra/deploy/README.md). */
export const TIMEWEB_REGISTRY_ID = 31207;
export const REGISTRY_DISK_WARN_RATIO = 0.7;
export const REGISTRY_DISK_FAIL_RATIO = 0.9;
const TIMEWEB_API = "https://api.timeweb.cloud/api/v1";
const DISK_READ_TIMEOUT_MS = 15_000;

/**
 * Read the registry's `disk_stats` (GB). Never throws and never puts the token in
 * a reason: a failed read is `{ok: false, reason}` for the caller to warn about.
 *
 * @returns {Promise<{ok: true, used: number, size: number} | {ok: false, reason: string}>}
 */
export async function readRegistryDisk({
  token,
  fetchImpl = fetch,
  registryId = TIMEWEB_REGISTRY_ID,
}) {
  if (!token) return { ok: false, reason: "TWC_READ_TOKEN is not set" };
  const redact = (text) => String(text).split(token).join("***");
  const url = `${TIMEWEB_API}/container-registry/${registryId}`;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(DISK_READ_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: redact(
          `GET ${url} answered HTTP ${res.status}: ${body.slice(0, 200)}`,
        ),
      };
    }
    const stats = (await res.json())?.container_registry?.disk_stats;
    const { used, size } = stats ?? {};
    if (
      !Number.isFinite(used) ||
      !Number.isFinite(size) ||
      size <= 0 ||
      used < 0
    )
      return {
        ok: false,
        reason: `GET ${url} carries no usable disk_stats: ${redact(JSON.stringify(stats ?? null)).slice(0, 200)}`,
      };
    return { ok: true, used, size };
  } catch (error) {
    return {
      ok: false,
      reason: redact(`GET ${url} failed: ${error?.message ?? error}`),
    };
  }
}

/**
 * The verdict on a `readRegistryDisk` result: `line` for the step summary,
 * `level` ok | warn | fail, `message` for the warning or the failure. A failed read
 * is a warning, never a failure.
 */
export function assessRegistryDisk(disk) {
  if (!disk.ok)
    return {
      level: "warn",
      line: "registry disk: unknown (usage read failed)",
      message: `registry disk usage could not be read: ${disk.reason}`,
    };
  const ratio = disk.used / disk.size;
  const line = `registry disk: ${disk.used}/${disk.size} GB (${Math.round(ratio * 100)}%)`;
  const pct = (r) => `${Math.round(r * 100)}%`;
  if (ratio >= REGISTRY_DISK_FAIL_RATIO)
    return {
      level: "fail",
      line,
      message: `${line} is at or above ${pct(REGISTRY_DISK_FAIL_RATIO)} — the next pushes may fail; free space or grow the preset`,
    };
  if (ratio >= REGISTRY_DISK_WARN_RATIO)
    return {
      level: "warn",
      line,
      message: `${line} is at or above ${pct(REGISTRY_DISK_WARN_RATIO)}`,
    };
  return { level: "ok", line, message: line };
}
