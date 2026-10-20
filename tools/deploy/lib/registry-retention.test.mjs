// tools/deploy/lib/registry-retention.test.mjs — the registry retention planner
// (#3110). `node --test` (pnpm test:tools).

import test from "node:test";
import assert from "node:assert/strict";

import {
  RetentionError,
  parseBearerChallenge,
  nextTagRequest,
  parseNextLink,
  planRetention,
  renderPlanSummary,
  retentionRepos,
} from "./registry-retention.mjs";

const sha = (n) => n.toString(16).padStart(40, "0");
const digest = (n) => `sha256:${n.toString(16).padStart(64, "0")}`;
const RELEASE_REPOS = ["api", "api-migrate", "portal", "admin", "doctor"];

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
  return {
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

test("retentionRepos: the five release repos and their pr/ twins", () => {
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
