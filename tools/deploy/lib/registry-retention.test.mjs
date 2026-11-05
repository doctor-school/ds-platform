// tools/deploy/lib/registry-retention.test.mjs — the registry retention planner
// (#3110). `node --test` (pnpm test:tools).

import test from "node:test";
import assert from "node:assert/strict";

import {
  RetentionError,
  REGISTRY_DISK_FAIL_RATIO,
  REGISTRY_DISK_WARN_RATIO,
  STAGE_SUITE_WALK_DEPTH,
  TIMEWEB_REGISTRY_ID,
  activeRunTargets,
  assessRegistryDisk,
  findGreenStageSuite,
  readRegistryDisk,
  parseBearerChallenge,
  nextTagRequest,
  parseNextLink,
  planRetention,
  renderPlanSummary,
  retentionRepos,
} from "./registry-retention.mjs";

const sha = (n) => n.toString(16).padStart(40, "0");
const digest = (n) => `sha256:${n.toString(16).padStart(64, "0")}`;
const RELEASE_REPOS = [
  "api",
  "api-migrate",
  "portal",
  "admin",
  "doctor",
  "login",
];

/** Every image repo carries the same tags; `pr/*` the same PR tags. */
function registry(mainTags, prTags = []) {
  const tags = {};
  for (const name of RELEASE_REPOS) {
    tags[name] = mainTags.map(([tag, d]) => ({ tag, digest: d }));
    tags[`pr/${name}`] = prTags.map(([tag, d]) => ({ tag, digest: d }));
  }
  return tags;
}

const releases = (...pairs) => pairs.map(([tag, s]) => ({ tag, sha: s }));

function baseInput(overrides = {}) {
  // main history, newest first: 20 .. 1
  const mainHistory = Array.from({ length: 20 }, (_, i) => sha(20 - i));
  const history = overrides.mainHistory ?? mainHistory;
  return {
    // the newest main commit is the green release candidate unless a test says otherwise
    stageSuite: { greenSha: history[0] ?? null, walked: 1, ahead: [] },
    activeStageShas: [],
    deployTargets: [],
    tags: registry(mainHistory.map((s, i) => [s, digest(1000 + i)])),
    releases: releases(
      ["release-2026.10.20-1", sha(10)],
      ["release-2026.10.19-2", sha(8)],
      ["release-2026.10.19-1", sha(6)],
      ["release-2026.10.18-1", sha(4)],
    ),
    mainHistory,
    openPrHeads: [],
    hotfixHeads: [],
    productionSha: sha(10),
    ...overrides,
  };
}

test("retentionRepos: the six release repos and their pr/ twins", () => {
  assert.deepEqual(retentionRepos(), [
    ...RELEASE_REPOS,
    ...RELEASE_REPOS.map((n) => `pr/${n}`),
  ]);
});

test("release repos keep the latest 3 releases and the newest 3 main SHAs; the rest is deleted", () => {
  const plan = planRetention(baseInput());
  assert.deepEqual(plan.releaseShas, [sha(10), sha(8), sha(6)]);
  assert.deepEqual(plan.mainShas, [sha(20), sha(19), sha(18)]);
  const api = plan.repos.find((r) => r.repo === "api");
  assert.deepEqual(
    api.keep.map((k) => k.tag).sort(),
    [sha(20), sha(19), sha(18), sha(10), sha(8), sha(6)].sort(),
  );
  assert.equal(api.delete.length, 14);
  const deletedTags = api.delete.flatMap((d) => d.tags);
  assert.ok(deletedTags.includes(sha(4)));
  assert.ok(deletedTags.includes(sha(17)));
});

test("releases are ordered by date and sequence, not by input order", () => {
  const plan = planRetention(
    baseInput({
      releases: releases(
        ["release-2026.10.18-1", sha(4)],
        ["release-2026.10.19-10", sha(9)],
        ["release-2026.10.20-1", sha(10)],
        ["release-2026.10.19-2", sha(8)],
      ),
    }),
  );
  assert.deepEqual(plan.releaseShas, [sha(10), sha(9), sha(8)]);
});

test("main SHAs follow first-parent history and skip commits with no image in the registry", () => {
  const input = baseInput();
  // 20 and 18 have no image anywhere (e.g. a failed build) — they do not count.
  for (const name of RELEASE_REPOS) {
    input.tags[name] = input.tags[name].filter(
      (t) => t.tag !== sha(20) && t.tag !== sha(18),
    );
  }
  const plan = planRetention(input);
  assert.deepEqual(plan.mainShas, [sha(19), sha(17), sha(16)]);
});

test("a SHA tagged in only some release repos still counts as a main SHA everywhere", () => {
  const input = baseInput();
  input.tags.api.push({ tag: sha(99), digest: digest(5) });
  const plan = planRetention({
    ...input,
    mainHistory: [sha(99), ...input.mainHistory],
  });
  assert.deepEqual(plan.mainShas, [sha(99), sha(20), sha(19)]);
});

test("pr/ repos keep only the heads of open PRs", () => {
  const input = baseInput({
    tags: registry(
      [
        [sha(10), digest(1)],
        [sha(8), digest(2)],
        [sha(6), digest(3)],
      ],
      [
        [sha(200), digest(20)],
        [sha(201), digest(21)],
        [sha(202), digest(22)],
      ],
    ),
    mainHistory: [sha(10), sha(8), sha(6)],
    openPrHeads: [sha(201)],
  });
  const plan = planRetention(input);
  const pr = plan.repos.find((r) => r.repo === "pr/portal");
  assert.deepEqual(
    pr.keep.map((k) => k.tag),
    [sha(201)],
  );
  assert.deepEqual(pr.delete.map((d) => d.digest).sort(), [
    digest(20),
    digest(22),
  ]);
});

test("digest guard: a digest a kept tag resolves to is never deleted", () => {
  const input = baseInput();
  // sha(1) is an identical rebuild of the kept release sha(10).
  const keptDigest = input.tags.api.find((t) => t.tag === sha(10)).digest;
  input.tags.api = input.tags.api.map((t) =>
    t.tag === sha(1) ? { ...t, digest: keptDigest } : t,
  );
  const plan = planRetention(input);
  const api = plan.repos.find((r) => r.repo === "api");
  assert.ok(!api.delete.some((d) => d.digest === keptDigest));
  assert.deepEqual(api.guarded, [{ tag: sha(1), digest: keptDigest }]);
});

test("one DELETE per digest: deletable tags that share a digest are grouped", () => {
  const input = baseInput();
  input.tags.api = input.tags.api.map((t) =>
    t.tag === sha(2) ? { ...t, digest: digest(42) } : t,
  );
  input.tags.api = input.tags.api.map((t) =>
    t.tag === sha(3) ? { ...t, digest: digest(42) } : t,
  );
  const plan = planRetention(input);
  const api = plan.repos.find((r) => r.repo === "api");
  const group = api.delete.filter((d) => d.digest === digest(42));
  assert.equal(group.length, 1);
  assert.deepEqual(group[0].tags.sort(), [sha(2), sha(3)].sort());
});

test("tags that are not 40-hex SHAs are left alone", () => {
  const input = baseInput();
  input.tags.api.push({ tag: "latest", digest: digest(7) });
  input.tags.api.push({ tag: "buildcache", digest: digest(8) });
  const plan = planRetention(input);
  const api = plan.repos.find((r) => r.repo === "api");
  assert.deepEqual(api.ignored.map((t) => t.tag).sort(), [
    "buildcache",
    "latest",
  ]);
  assert.ok(
    !api.delete.some((d) => d.digest === digest(7) || d.digest === digest(8)),
  );
});

test("a digest shared by an ignored (non-SHA) tag is not deleted either", () => {
  const input = baseInput();
  const d = input.tags.api.find((t) => t.tag === sha(1)).digest;
  input.tags.api.push({ tag: "latest", digest: d });
  const plan = planRetention(input);
  const api = plan.repos.find((r) => r.repo === "api");
  assert.ok(!api.delete.some((x) => x.digest === d));
});

test("release repos keep the heads of open hotfix branches — a pending hotfix's images survive until deploy", () => {
  // A hotfix SHA is cut from production, so it is neither a release nor on
  // first-parent `main`; its images live in the release namespace.
  const plan = planRetention(baseInput({ hotfixHeads: [sha(2)] }));
  for (const name of RELEASE_REPOS) {
    const repo = plan.repos.find((r) => r.repo === name);
    const kept = repo.keep.find((k) => k.tag === sha(2));
    assert.ok(kept, `${name} keeps the hotfix head`);
    assert.equal(kept.reason, "hotfix branch");
    assert.ok(!repo.delete.some((d) => d.tags.includes(sha(2))));
  }
  assert.deepEqual(plan.hotfixHeads, [sha(2)]);
});

test("release repos keep open PR heads too", () => {
  const plan = planRetention(baseInput({ openPrHeads: [sha(3)] }));
  const api = plan.repos.find((r) => r.repo === "api");
  assert.equal(api.keep.find((k) => k.tag === sha(3))?.reason, "open PR");
});

test("release repos keep the latest successful production deployment even without a release", () => {
  const plan = planRetention(baseInput({ productionSha: sha(5) }));
  assert.equal(plan.productionSha, sha(5));
  const admin = plan.repos.find((r) => r.repo === "admin");
  assert.equal(
    admin.keep.find((k) => k.tag === sha(5))?.reason,
    "production deployment",
  );
});

test("fail closed: hotfix branches not listed, or a head that is not a full SHA", () => {
  assert.throws(
    () => planRetention(baseInput({ hotfixHeads: undefined })),
    /hotfix/,
  );
  assert.throws(
    () => planRetention(baseInput({ hotfixHeads: ["main"] })),
    /hotfix/,
  );
});

test("fail closed: the production deployment SHA is missing or not a full SHA", () => {
  assert.throws(
    () => planRetention(baseInput({ productionSha: undefined })),
    /production deployment/,
  );
  assert.throws(
    () => planRetention(baseInput({ productionSha: "abc" })),
    /production deployment/,
  );
});

test("nextTagRequest follows a Link header", () => {
  const known = new Set();
  const step = nextTagRequest({
    repo: "api",
    page: ["a", "b"],
    known,
    link: "/v2/api/tags/list?last=b&n=2",
    probed: false,
    pageSize: 2,
  });
  assert.deepEqual(step, {
    next: "/v2/api/tags/list?last=b&n=2",
    probe: false,
    fresh: ["a", "b"],
  });
});

test("nextTagRequest confirms the end of a Link-less listing with a last= probe", () => {
  const step = nextTagRequest({
    repo: "pr/api",
    page: ["a", "b"],
    known: new Set(),
    link: null,
    probed: false,
    pageSize: 100,
  });
  assert.deepEqual(step, {
    next: "/v2/pr/api/tags/list?n=100&last=b",
    probe: true,
    fresh: ["a", "b"],
  });
});

test("nextTagRequest: an empty probe page ends the listing", () => {
  assert.deepEqual(
    nextTagRequest({
      repo: "api",
      page: [],
      known: new Set(["a", "b"]),
      link: null,
      probed: true,
      pageSize: 100,
    }),
    { next: null, probe: false, fresh: [] },
  );
});

test("nextTagRequest: a probe that finds new tags (a silently truncated page) keeps listing", () => {
  const step = nextTagRequest({
    repo: "api",
    page: ["c"],
    known: new Set(["a", "b"]),
    link: null,
    probed: true,
    pageSize: 100,
  });
  assert.deepEqual(step, {
    next: "/v2/api/tags/list?n=100&last=c",
    probe: true,
    fresh: ["c"],
  });
});

test("fail closed: a probe answered with only known tags — the registry ignores last=, completeness unprovable", () => {
  assert.throws(
    () =>
      nextTagRequest({
        repo: "api",
        page: ["a", "b"],
        known: new Set(["a", "b"]),
        link: null,
        probed: true,
        pageSize: 100,
      }),
    /api.*last=/,
  );
});

test("fail closed: no release listed", () => {
  assert.throws(
    () => planRetention(baseInput({ releases: [] })),
    RetentionError,
  );
  assert.throws(
    () => planRetention(baseInput({ releases: undefined })),
    RetentionError,
  );
  assert.throws(
    () => planRetention(baseInput({ releases: releases(["v1.0.0", sha(10)]) })),
    /no release-YYYY\.MM\.DD-N release/,
  );
});

test("fail closed: a release whose target is not a full SHA", () => {
  assert.throws(
    () =>
      planRetention(
        baseInput({ releases: releases(["release-2026.10.20-1", "main"]) }),
      ),
    /release-2026\.10\.20-1.*not a full/,
  );
});

test("fail closed: open PRs not listed, or a head that is not a full SHA", () => {
  assert.throws(
    () => planRetention(baseInput({ openPrHeads: undefined })),
    RetentionError,
  );
  assert.throws(
    () => planRetention(baseInput({ openPrHeads: ["abc"] })),
    RetentionError,
  );
});

test("fail closed: empty main history or a repo with no tag listing", () => {
  assert.throws(
    () => planRetention(baseInput({ mainHistory: [] })),
    RetentionError,
  );
  const input = baseInput();
  delete input.tags["pr/doctor"];
  assert.throws(() => planRetention(input), /pr\/doctor/);
});

test("fail closed: a tag with an unusable digest", () => {
  const input = baseInput();
  input.tags.api[0] = { tag: input.tags.api[0].tag, digest: "md5:nope" };
  assert.throws(() => planRetention(input), /digest/);
});

test("renderPlanSummary names the mode, kept SHAs and per-repo counts", () => {
  const plan = planRetention(baseInput());
  const text = renderPlanSummary(plan, { dryRun: true });
  assert.match(text, /dry run/i);
  assert.match(text, new RegExp(sha(10)));
  assert.match(text, /\| api \| 20 \| 6 \| 14 \| 14 \| 0 \| 0 \|/);
});

test("parseNextLink follows the registry's Link header", () => {
  assert.equal(
    parseNextLink('</v2/api/tags/list?last=abc&n=100>; rel="next"'),
    "/v2/api/tags/list?last=abc&n=100",
  );
  assert.equal(parseNextLink(null), null);
  assert.equal(parseNextLink('</x>; rel="prev"'), null);
});

test("parseBearerChallenge reads realm, service and scope", () => {
  assert.deepEqual(
    parseBearerChallenge(
      'Bearer realm="https://r.example/token",service="r.example",scope="repository:api:pull"',
    ),
    {
      realm: "https://r.example/token",
      service: "r.example",
      scope: "repository:api:pull",
    },
  );
  assert.equal(parseBearerChallenge('Basic realm="x"'), null);
});

const GREEN_LABEL = "newest green stage-suite";

test("the newest green stage-suite main commit is kept beyond the 3-main window (release candidate, #3240)", () => {
  // main moved 6 commits past the green candidate, each with a red stage-suite
  const plan = planRetention(
    baseInput({
      stageSuite: { greenSha: sha(14), walked: 7, ahead: [] },
    }),
  );
  assert.deepEqual(plan.mainShas, [sha(20), sha(19), sha(18)]);
  const api = plan.repos.find((r) => r.repo === "api");
  const kept = api.keep.find((k) => k.tag === sha(14));
  assert.ok(kept, "the green candidate is kept");
  assert.equal(kept.reason, GREEN_LABEL);
  assert.ok(!api.delete.flatMap((d) => d.tags).includes(sha(14)));
  assert.match(
    renderPlanSummary(plan, { dryRun: true }),
    new RegExp(`${GREEN_LABEL}.*${sha(14)}`),
  );
});

test("fail closed: the stage-suite walk result is missing, has no green commit, or is not a main commit", () => {
  assert.throws(
    () => planRetention(baseInput({ stageSuite: undefined })),
    RetentionError,
  );
  // an unconcluded walk never reaches the planner as a partial keep
  assert.throws(
    () => planRetention(baseInput({ stageSuite: { greenSha: null } })),
    RetentionError,
  );
  assert.throws(
    () => planRetention(baseInput({ stageSuite: { greenSha: "abc" } })),
    RetentionError,
  );
  assert.throws(
    () => planRetention(baseInput({ stageSuite: { greenSha: sha(99) } })),
    /not in main history/,
  );
});

test("findGreenStageSuite walks main newest-first and stops at the first success", async () => {
  const states = {
    [sha(20)]: "failure",
    [sha(19)]: "pending",
    [sha(18)]: null,
    [sha(17)]: "success",
  };
  const read = [];
  const result = await findGreenStageSuite(
    Array.from({ length: 20 }, (_, i) => sha(20 - i)),
    async (s) => {
      read.push(s);
      return states[s] ?? "failure";
    },
  );
  assert.equal(result.greenSha, sha(17));
  assert.equal(result.walked, 4);
  assert.deepEqual(read, [sha(20), sha(19), sha(18), sha(17)]);
});

test("fail closed: a stage-suite status that cannot be read refuses the whole run — the green candidate may lie further back", async () => {
  // sha(17) is green, but the walk cannot see past the unreadable sha(19)
  const states = { [sha(17)]: "success" };
  await assert.rejects(
    findGreenStageSuite([sha(20), sha(19), sha(18), sha(17)], async (s) => {
      if (s === sha(19)) throw new Error("HTTP 502");
      return states[s] ?? "failure";
    }),
    (error) =>
      error instanceof RetentionError &&
      error.message.includes(sha(19)) &&
      /HTTP 502/.test(error.message),
  );
});

test(`fail closed: no green stage-suite within STAGE_SUITE_WALK_DEPTH (${STAGE_SUITE_WALK_DEPTH}) main commits refuses the run`, async () => {
  assert.equal(STAGE_SUITE_WALK_DEPTH, 200);
  let reads = 0;
  await assert.rejects(
    findGreenStageSuite(
      Array.from({ length: 250 }, (_, i) => sha(250 - i)),
      async () => {
        reads += 1;
        return "pending";
      },
    ),
    (error) =>
      error instanceof RetentionError && /newest 200/.test(error.message),
  );
  assert.equal(reads, STAGE_SUITE_WALK_DEPTH);
});

test("fail closed: a main history shorter than the bound with no green stage-suite refuses the run", async () => {
  await assert.rejects(
    findGreenStageSuite([sha(2), sha(1)], async () => null),
    (error) =>
      error instanceof RetentionError && /2 main commits/.test(error.message),
  );
});

// ── Registry disk usage (#3724) ─────────────────────────────────────────────────

const TOKEN = "twc-read-secret-value";

/** A `fetch` stub that records its calls and answers with `respond(url, init)`. */
function stubFetch(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(url, init);
  };
  return { calls, fetchImpl };
}

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("readRegistryDisk: GETs the registry with the bearer token and returns disk_stats", async () => {
  const { calls, fetchImpl } = stubFetch(() =>
    jsonResponse(200, {
      container_registry: {
        id: TIMEWEB_REGISTRY_ID,
        preset_id: 1945,
        disk_stats: { size: 50, used: 21 },
      },
    }),
  );
  const disk = await readRegistryDisk({ token: TOKEN, fetchImpl });
  assert.deepEqual(disk, { ok: true, used: 21, size: 50 });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://api.timeweb.cloud/api/v1/container-registry/${TIMEWEB_REGISTRY_ID}`,
  );
  assert.equal(calls[0].init.method ?? "GET", "GET");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
});

test("readRegistryDisk: no token is a failed read, nothing is fetched", async () => {
  const { calls, fetchImpl } = stubFetch(() => jsonResponse(200, {}));
  const disk = await readRegistryDisk({ token: "", fetchImpl });
  assert.equal(disk.ok, false);
  assert.match(disk.reason, /TWC_READ_TOKEN is not set/);
  assert.equal(calls.length, 0);
});

test("readRegistryDisk: an unauthorized answer is a failed read that never echoes the token", async () => {
  const { fetchImpl } = stubFetch(() =>
    jsonResponse(403, { message: `token ${TOKEN} has no access` }),
  );
  const disk = await readRegistryDisk({ token: TOKEN, fetchImpl });
  assert.equal(disk.ok, false);
  assert.match(disk.reason, /HTTP 403/);
  assert.ok(!disk.reason.includes(TOKEN));
});

test("readRegistryDisk: a network error is a failed read that never echoes the token", async () => {
  const { fetchImpl } = stubFetch(() => {
    throw new Error(`connect ECONNREFUSED (auth ${TOKEN})`);
  });
  const disk = await readRegistryDisk({ token: TOKEN, fetchImpl });
  assert.equal(disk.ok, false);
  assert.match(disk.reason, /ECONNREFUSED/);
  assert.ok(!disk.reason.includes(TOKEN));
});

test("readRegistryDisk: a body without numeric disk_stats is a failed read", async () => {
  for (const body of [
    {},
    { container_registry: {} },
    { container_registry: { disk_stats: { size: 0, used: 0 } } },
    { container_registry: { disk_stats: { size: "50", used: 3 } } },
  ]) {
    const { fetchImpl } = stubFetch(() => jsonResponse(200, body));
    const disk = await readRegistryDisk({ token: TOKEN, fetchImpl });
    assert.equal(disk.ok, false, JSON.stringify(body));
    assert.match(disk.reason, /disk_stats/);
  }
});

test("assessRegistryDisk: below 70 % is ok, from 70 % a warning, from 90 % a failure", () => {
  assert.equal(REGISTRY_DISK_WARN_RATIO, 0.7);
  assert.equal(REGISTRY_DISK_FAIL_RATIO, 0.9);
  const level = (used, size) =>
    assessRegistryDisk({ ok: true, used, size }).level;
  assert.equal(level(34, 50), "ok");
  assert.equal(level(35, 50), "warn");
  assert.equal(level(44, 50), "warn");
  assert.equal(level(45, 50), "fail");
  assert.equal(level(50, 50), "fail");
});

test("assessRegistryDisk: the summary line reads used/size GB and the percentage", () => {
  const a = assessRegistryDisk({ ok: true, used: 36, size: 50 });
  assert.equal(a.line, "registry disk: 36/50 GB (72%)");
  assert.match(a.message, /registry disk: 36\/50 GB \(72%\)/);
  assert.match(a.message, /70%/);
  const f = assessRegistryDisk({ ok: true, used: 46, size: 50 });
  assert.match(f.message, /90%/);
});

test("assessRegistryDisk: a failed read is a warning, never a failure", () => {
  const a = assessRegistryDisk({ ok: false, reason: "HTTP 401" });
  assert.equal(a.level, "warn");
  assert.match(a.line, /registry disk: unknown/);
  assert.match(a.message, /HTTP 401/);
});

// ── In-flight release candidates (#3752) and pending prod deploys (#3654) ───────

test("a main SHA whose stage-suite is pending keeps its images outside the newest 3 (#3752)", () => {
  // sha(17) is the in-flight candidate: its suite is running while main moved 3
  // commits past it; sha(10) is the newest green one.
  const plan = planRetention(
    baseInput({
      stageSuite: {
        greenSha: sha(10),
        walked: 11,
        ahead: [
          { sha: sha(20), state: null },
          { sha: sha(19), state: null },
          { sha: sha(18), state: "failure" },
          { sha: sha(17), state: "pending" },
          { sha: sha(16), state: "error" },
        ],
      },
    }),
  );
  assert.deepEqual(plan.mainShas, [sha(20), sha(19), sha(18)]);
  assert.deepEqual(plan.inFlightShas, [sha(17)]);
  const api = plan.repos.find((r) => r.repo === "api");
  const kept = new Map(api.keep.map((k) => [k.tag, k.reason]));
  assert.equal(kept.get(sha(17)), "in-flight stage-suite");
  const deleted = api.delete.flatMap((d) => d.tags);
  assert.ok(deleted.includes(sha(16)), "a terminal red suite is not in flight");
  assert.ok(!deleted.includes(sha(17)));
});

test("a main SHA with no stage-suite yet is in flight only while a Stage main run for it is queued or running (#3752)", () => {
  const input = (activeStageShas) =>
    baseInput({
      stageSuite: {
        greenSha: sha(10),
        walked: 11,
        ahead: [
          { sha: sha(20), state: null },
          { sha: sha(19), state: null },
          { sha: sha(18), state: null },
          { sha: sha(17), state: null },
          { sha: sha(16), state: null },
        ],
      },
      activeStageShas,
    });
  assert.deepEqual(planRetention(input([sha(16)])).inFlightShas, [sha(16)]);
  // its Stage run was replaced in the queue: no suite will ever run for it
  const plan = planRetention(input([]));
  assert.deepEqual(plan.inFlightShas, []);
  const api = plan.repos.find((r) => r.repo === "api");
  assert.ok(api.delete.flatMap((d) => d.tags).includes(sha(16)));
});

test("fail closed: a stage-suite walk without the states ahead of the candidate, or no active Stage runs listed", () => {
  assert.throws(
    () =>
      planRetention(
        baseInput({ stageSuite: { greenSha: sha(20), walked: 1 } }),
      ),
    (error) => error instanceof RetentionError && /ahead/.test(error.message),
  );
  assert.throws(
    () => planRetention(baseInput({ activeStageShas: undefined })),
    (error) =>
      error instanceof RetentionError && /Stage main runs/.test(error.message),
  );
});

test("findGreenStageSuite returns the states of the commits it read before the green one", async () => {
  const states = {
    [sha(20)]: "pending",
    [sha(19)]: null,
    [sha(18)]: "success",
  };
  const result = await findGreenStageSuite(
    [sha(20), sha(19), sha(18), sha(17)],
    async (s) => (s in states ? states[s] : "failure"),
  );
  assert.equal(result.greenSha, sha(18));
  assert.deepEqual(result.ahead, [
    { sha: sha(20), state: "pending" },
    { sha: sha(19), state: null },
  ]);
});

test("a SHA with a queued or in-progress deploy-prod run keeps its images (#3654)", () => {
  // sha(5): a rollback or a release proposed earlier — on no other keep list
  const plan = planRetention(baseInput({ deployTargets: [sha(5)] }));
  assert.deepEqual(plan.deployTargets, [sha(5)]);
  const api = plan.repos.find((r) => r.repo === "api");
  const kept = new Map(api.keep.map((k) => [k.tag, k.reason]));
  assert.equal(kept.get(sha(5)), "deploy-prod run");
  assert.ok(!api.delete.flatMap((d) => d.tags).includes(sha(5)));
});

test("fail closed: deploy-prod targets not listed, or one that is not a full SHA", () => {
  for (const deployTargets of [undefined, ["main"]]) {
    assert.throws(
      () => planRetention(baseInput({ deployTargets })),
      (error) =>
        error instanceof RetentionError && /deploy-prod/.test(error.message),
    );
  }
});

test("activeRunTargets reads each queued or running run's target SHA from its title", () => {
  assert.deepEqual(
    activeRunTargets(
      [
        { id: 1, title: `Deploy prod release ${sha(5)}` },
        { id: 2, title: `Deploy prod rollback ${sha(6)}` },
      ],
      "deploy-prod",
    ),
    [sha(5), sha(6)],
  );
  assert.deepEqual(activeRunTargets([], "deploy-prod"), []);
});

test("fail closed: an active run whose target SHA cannot be determined deletes nothing", () => {
  for (const runs of [
    [{ id: 7, title: "Deploy prod" }],
    [{ id: 7, title: `Deploy prod release ${sha(5)}x` }],
    [{ id: 7 }],
    "not a list",
  ]) {
    assert.throws(
      () => activeRunTargets(runs, "deploy-prod"),
      (error) =>
        error instanceof RetentionError && /deploy-prod/.test(error.message),
    );
  }
});

test("renderPlanSummary names the in-flight candidates and the deploy-prod targets", () => {
  const plan = planRetention(
    baseInput({
      stageSuite: {
        greenSha: sha(10),
        walked: 2,
        ahead: [{ sha: sha(20), state: "pending" }],
      },
      deployTargets: [sha(5)],
    }),
  );
  const text = renderPlanSummary(plan, { dryRun: true });
  assert.match(text, new RegExp(`In-flight stage-suite kept.*${sha(20)}`));
  assert.match(text, new RegExp(`deploy-prod.*${sha(5)}`));
});
