// tools/ci/affected-areas.test.mjs — tests for the heavy-e2e area classifier
// (Issue #2592: every code PR paid every heavy e2e job, even a copy edit in one
// package nothing boots). `node --test` (pnpm test:tools).
//
// There is NO feature-spec behind these ids: #2592 is an engineering-task
// (AGENTS.md §3.8), so the `EARS-N` titles follow the tools/** house convention
// (ADR-0006 §4 numbering style) and reference no spec clause.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  HEAVY_JOBS,
  classifyAffectedAreas,
  parseWorkspacePatterns,
  readWorkspaceAt,
  workspaceFromManifests,
  outputLines,
} from "./affected-areas.mjs";

// A miniature of the real graph: congress-submissions → doctor; schemas → api,
// portal, doctor (via auth-flow); design-system → every web app.
const WORKSPACE = workspaceFromManifests(
  ["apps/*", "packages/*", "tools/lint/guard-tests"],
  {
    "apps/api/package.json": {
      name: "@ds/api",
      dependencies: {
        "@ds/schemas": "workspace:*",
        "@ds/db": "workspace:*",
        "@ds/legal-content": "workspace:*",
      },
    },
    "apps/portal/package.json": {
      name: "@ds/portal",
      dependencies: {
        "@ds/auth-flow": "workspace:*",
        "@ds/legal-content": "workspace:*",
        "@ds/design-system": "workspace:*",
      },
    },
    "apps/doctor/package.json": {
      name: "@ds/doctor",
      dependencies: {
        "@ds/auth-flow": "workspace:*",
        "@ds/congress-submissions": "workspace:*",
        "@ds/design-system": "workspace:*",
        "@ds/legal-content": "workspace:*",
      },
    },
    "apps/admin/package.json": {
      name: "@ds/admin",
      dependencies: { "@ds/design-system": "workspace:*" },
    },
    "apps/showcase/package.json": {
      name: "@ds/showcase",
      dependencies: { "@ds/design-system": "workspace:*" },
    },
    "apps/academy-demo/package.json": {
      name: "@ds/academy-demo",
      devDependencies: { "@ds/design-system": "workspace:*" },
    },
    "apps/mobile/package.json": { name: "@ds/mobile", dependencies: {} },
    "packages/auth-flow/package.json": {
      name: "@ds/auth-flow",
      peerDependencies: { "@ds/schemas": "workspace:*" },
    },
    "packages/congress-submissions/package.json": {
      name: "@ds/congress-submissions",
      dependencies: { "@ds/design-system": "workspace:*" },
    },
    "packages/design-system/package.json": {
      name: "@ds/design-system",
      dependencies: { react: "^19" },
    },
    "packages/schemas/package.json": {
      name: "@ds/schemas",
      dependencies: { zod: "^4" },
    },
    "packages/db/package.json": { name: "@ds/db", dependencies: {} },
    "packages/legal-content/package.json": { name: "@ds/legal-content" },
    "packages/api-client/package.json": { name: "@ds/api-client" },
    "tools/lint/guard-tests/package.json": {
      name: "@ds/lint-guard-tests",
      devDependencies: { "@ds/schemas": "workspace:*" },
    },
  },
);

const pr = (paths) =>
  classifyAffectedAreas({ event: "pull_request", paths, workspace: WORKSPACE });
const running = (result) =>
  Object.keys(result.jobs)
    .filter((job) => result.jobs[job])
    .sort();
const ALL = Object.keys(HEAVY_JOBS).sort();

test("EARS-1: a package nothing heavy boots runs only the jobs of its dependents", () => {
  const result = pr(["packages/congress-submissions/src/copy.ts"]);
  assert.equal(result.fullRun, null);
  assert.deepEqual(running(result), [
    "playwright-axe-doctor",
    "standalone-boot",
  ]);
  assert.equal(result.jobs["api-e2e"], false);
});

test("EARS-2: an apps/api change runs api-e2e and every job that boots the api", () => {
  assert.deepEqual(running(pr(["apps/api/src/events/events.service.ts"])), [
    "admin-e2e",
    "api-e2e",
  ]);
});

test("EARS-3: dependents are transitive and follow every dependency field", () => {
  // schemas → auth-flow (peer) → portal, doctor; schemas → api.
  assert.deepEqual(running(pr(["packages/schemas/src/index.ts"])), [
    "admin-e2e",
    "api-e2e",
    "playwright-axe-doctor",
    "playwright-axe-portal",
    "standalone-boot",
  ]);
  // design-system reaches academy-demo through a devDependency.
  assert.ok(
    pr(["packages/design-system/src/button.tsx"]).jobs[
      "playwright-academy-demo"
    ],
  );
});

test("EARS-4: docs-class and agent-tooling paths affect no heavy job", () => {
  const result = pr([
    "README.md",
    "apps/docs/content/specs/x.mdx",
    "apps/docs/content/specs/features/012-content-taxonomy/012-requirements.md",
    "design-source/canvas.dc.html",
    ".claude/settings.json",
    ".changeset/config.json",
    ".github/ui-evidence/2433/desktop-dark.png",
    "tools/lint/route-target-lint.ts",
    "tools/lint/guard-tests/src/x.spec.ts",
    "apps/mobile/src/app.tsx",
  ]);
  assert.equal(result.fullRun, null);
  assert.deepEqual(running(result), []);
});

test("EARS-5: shared build/CI inputs fail open to the full set", () => {
  for (const path of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "turbo.json",
    "tsconfig.base.json",
    ".npmrc",
    ".nvmrc",
    ".github/workflows/ci.yml",
    "tools/ci/standalone-boot-check.mjs",
    "tools/scripts/api-e2e-diagnostics.mjs",
    "infra/dev-stand/idp/provision.sh",
    "apps/portal/Dockerfile",
    ".dockerignore",
    "eslint.config.js",
  ]) {
    const result = pr(["packages/congress-submissions/src/copy.ts", path]);
    assert.ok(result.fullRun, `${path} must fail open`);
    assert.deepEqual(running(result), ALL, path);
  }
});

test("EARS-6: a non-PR event, an empty diff, or a path no package owns runs everything", () => {
  const push = classifyAffectedAreas({
    event: "push",
    paths: ["apps/api/src/x.ts"],
    workspace: WORKSPACE,
  });
  assert.match(push.fullRun, /not a pull_request/);
  assert.deepEqual(running(push), ALL);
  assert.match(pr([]).fullRun, /empty/);
  // A deleted package's files map to no package at head — unattributable.
  const orphan = pr(["packages/gone/src/index.ts"]);
  assert.match(orphan.fullRun, /no workspace package/);
  assert.deepEqual(running(orphan), ALL);
});

test("EARS-7: workspace patterns parse the pnpm form and refuse unsupported globs", () => {
  assert.deepEqual(
    parseWorkspacePatterns(
      "packages:\n  - \"apps/*\"\n  - packages/*\n  - 'tools/lint/guard-tests'\n",
    ),
    ["apps/*", "packages/*", "tools/lint/guard-tests"],
  );
  assert.throws(
    () => parseWorkspacePatterns("packages:\n  - apps/**\n"),
    /unsupported/,
  );
  assert.throws(
    () => parseWorkspacePatterns("packages:\n  - '!apps/x'\n"),
    /unsupported/,
  );
  assert.throws(
    () => parseWorkspacePatterns("catalog:\n  react: 19\n"),
    /no workspace patterns/,
  );
});

test("EARS-8: every heavy job maps to real workspace packages and real extra inputs, and is wired in ci.yml", () => {
  const ci = readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(ci, /run: node tools\/ci\/affected-areas\.mjs/);
  assert.match(ci, /GRAPH_SHA: \$\{\{ github\.sha \}\}/);
  const real = readWorkspaceAt("HEAD");
  const tracked = spawnSync("git", ["ls-files"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stdout.split("\n");
  for (const [job, { packages, extraInputs }] of Object.entries(HEAVY_JOBS)) {
    for (const name of packages)
      assert.ok(real.byName.has(name), `${job}: ${name}`);
    for (const re of extraInputs)
      assert.ok(
        tracked.some((file) => re.test(file)),
        `${job}: extra input ${re} matches no tracked file`,
      );
    assert.match(
      ci,
      new RegExp(
        `run-${job}: \\$\\{\\{ steps\\.areas\\.outputs\\.run-${job} \\}\\}`,
      ),
      `${job} output`,
    );
    assert.match(
      ci,
      new RegExp(
        `\\n  ${job}:\\n    needs: changes\\n    if: needs\\.changes\\.outputs\\.code == 'true' && needs\\.changes\\.outputs\\.run-${job} == 'true'\\n`,
      ),
      `${job} gate`,
    );
  }
});

test("EARS-9: outputs carry one run-<job> line per heavy job", () => {
  const lines = outputLines(pr(["apps/api/src/x.ts"]));
  assert.deepEqual(
    lines,
    ALL.map((job) => `run-${job}=${job === "api-e2e" || job === "admin-e2e"}`),
  );
});

test("EARS-10: a docs-type file inside a package marks that package affected, also in a mixed PR", () => {
  // Legal documents are runtime content of portal, doctor and the api consent stamp.
  const legal = pr([
    "apps/admin/app/page.tsx",
    "packages/legal-content/documents/privacy-policy.md",
  ]);
  assert.equal(legal.fullRun, null);
  for (const job of [
    "api-e2e",
    "playwright-axe-portal",
    "playwright-axe-doctor",
  ])
    assert.ok(legal.jobs[job], job);
  // admin-authz-floor.e2e-spec.ts reads the matrix; it lives inside @ds/api.
  assert.ok(pr(["apps/api/docs/endpoint-authz-matrix.md"]).jobs["api-e2e"]);
});

test("EARS-11: a spec .feature runs admin-e2e (bddgen taxonomy project) and nothing else", () => {
  const result = pr([
    "apps/docs/content/specs/features/012-content-taxonomy/012-scenarios.feature",
  ]);
  assert.equal(result.fullRun, null);
  assert.deepEqual(running(result), ["admin-e2e"]);
});

test("EARS-12: files a job reads outside its dependency closure run that job", () => {
  // archived-speakers.e2e-spec.ts scans these; @ds/api depends on neither.
  assert.ok(pr(["apps/portal/app/webinars/[slug]/page.tsx"]).jobs["api-e2e"]);
  assert.ok(
    pr(["packages/design-system/src/blocks/event-page-view.ts"]).jobs[
      "api-e2e"
    ],
  );
  // hidden-rename.e2e-spec.ts reads the generated SDK snapshot.
  assert.deepEqual(running(pr(["packages/api-client/openapi.snapshot.json"])), [
    "api-e2e",
  ]);
  assert.equal(
    pr(["packages/design-system/src/button.tsx"]).jobs["api-e2e"],
    false,
  );
});

test("EARS-13: a HEAVY_JOBS package missing from the workspace throws (the caller fails open)", () => {
  const partial = workspaceFromManifests(["apps/*"], {
    "apps/api/package.json": { name: "@ds/api" },
  });
  assert.throws(
    () =>
      classifyAffectedAreas({
        event: "pull_request",
        paths: ["apps/api/src/x.ts"],
        workspace: partial,
      }),
    /unknown package @ds\/admin/,
  );
});
