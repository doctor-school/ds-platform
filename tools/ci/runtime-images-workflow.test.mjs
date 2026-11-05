// runtime-images.yml contract (#3701): the registry has a fixed quota and reclaims a
// deleted manifest's bytes only at the provider's nightly GC, so what one day of runs
// uploads is the binding constraint (infra/deploy/README.md → Container registry).
// Two mechanisms keep it bounded: reproducible layers (an image-neutral commit
// re-uploads nothing; the API Dockerfile's `pnpm deploy` trees are part of that) and
// PR images pushed only on demand (the `stage-slot` label).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

import { parse } from "yaml";

import { PR_IMAGES_LABEL } from "../deploy/lib/registry.mjs";

const workflow = parse(
  readFileSync(new URL("../../.github/workflows/runtime-images.yml", import.meta.url), "utf8"),
);
const buildStep = workflow.jobs.build.steps.find((step) => step.id === "build");

/** Runs the `plan` step's shell with `env` and returns its step outputs. */
function plan(env) {
  const step = workflow.jobs.plan.steps.find((s) => s.id === "plan");
  const dir = mkdtempSync(join(tmpdir(), "runtime-images-plan-"));
  const output = join(dir, "out");
  try {
    const res = spawnSync("bash", ["-c", step.run], {
      env: { ...process.env, GITHUB_OUTPUT: output, ...env },
      encoding: "utf8",
    });
    assert.equal(res.status, 0, res.stderr);
    return Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SHA = "a".repeat(40);
const HEAD = "b".repeat(40);
const pr = (overrides) => ({
  EVENT: "pull_request",
  GIT_REF: "refs/pull/7/merge",
  SHA,
  PR_NUMBER: "7",
  PR_HEAD_SHA: HEAD,
  PR_HEAD_REPO: "o/r",
  REPO: "o/r",
  PR_IMAGES_LABELED: "false",
  ...overrides,
});

it("the label the slot tooling names is the label the workflow reads", () => {
  assert.equal(PR_IMAGES_LABEL, "stage-slot");
  assert.equal(
    workflow.jobs.plan.steps[0].env.PR_IMAGES_LABELED,
    `\${{ contains(github.event.pull_request.labels.*.name, '${PR_IMAGES_LABEL}') }}`,
  );
});

it("an internal PR pushes pr/* images only while it carries the stage-slot label", () => {
  assert.deepEqual(plan(pr()), { push: "false", sha: HEAD, ref: "pr/7", prefix: "pr/" });
  assert.deepEqual(plan(pr({ PR_IMAGES_LABELED: "true" })), {
    push: "true",
    sha: HEAD,
    ref: "pr/7",
    prefix: "pr/",
  });
  // A fork PR never logs in, labelled or not.
  assert.equal(plan(pr({ PR_HEAD_REPO: "fork/r", PR_IMAGES_LABELED: "true" })).push, "false");
  // main still pushes every merge.
  assert.equal(plan({ EVENT: "push", GIT_REF: "refs/heads/main", SHA }).push, "true");
});

it("an unpushed run records no images manifest, so a pr-slot finds nothing to pull", () => {
  // The refusal that names the label (registry.mjs resolveRecordedImages) relies on it.
  assert.equal(workflow.jobs.images.if, "needs.plan.outputs.push == 'true'");
});

it("adding the label starts a pushing run for the current head; any other label starts nothing", () => {
  const types = workflow.on.pull_request.types;
  for (const type of ["opened", "synchronize", "reopened", "labeled"]) assert.ok(types.includes(type), type);
  // An unrelated label (e.g. the track:* pr-track-sync adds right after open) must
  // neither run the build again nor cancel the head's in-progress run: it takes a
  // group of its own and its plan is skipped.
  assert.equal(
    workflow.jobs.plan.if,
    `github.event.action != 'labeled' || github.event.label.name == '${PR_IMAGES_LABEL}'`,
  );
  assert.equal(
    workflow.concurrency.group,
    "${{ github.event_name == 'pull_request' && (github.event.action != 'labeled' || github.event.label.name == 'stage-slot') && format('runtime-images-pr-{0}', github.event.pull_request.number) || github.event_name == 'pull_request' && format('runtime-images-pr-label-{0}', github.run_id) || 'registry-images' }}",
  );
});

it("layers are reproducible: a constant SOURCE_DATE_EPOCH and rewritten file timestamps", () => {
  // Constant, never the commit time — otherwise every rebuilt layer still differs.
  assert.equal(String(workflow.jobs.build.env.SOURCE_DATE_EPOCH), "0");
  // Both exporters (registry push and the verify tar) rewrite the timestamps; the
  // push goes through `outputs`, so `push:` stays off rather than adding a second exporter.
  assert.equal(
    buildStep.with.outputs,
    "${{ needs.plan.outputs.push == 'true' && 'type=image,push=true,rewrite-timestamp=true' || format('type=docker,dest={0}/image.tar,rewrite-timestamp=true', runner.temp) }}",
  );
  assert.equal(buildStep.with.push, undefined);
});

it("every `pnpm deploy` tree drops .modules.yaml, the one file pnpm writes in a per-run order", () => {
  // Measured on PR #3704: two builds of identical content differed in exactly this
  // file (its hoisted-dependency map is written in resolution order), which re-stored
  // the whole node_modules layer of api and api-migrate. Nothing in either image
  // reads it: node resolves through node_modules, `pnpm run` does not verify it.
  const dockerfile = readFileSync(new URL("../../apps/api/Dockerfile", import.meta.url), "utf8");
  const deploys = dockerfile.split("\n").filter((line) => /^RUN pnpm .*\bdeploy\b/.test(line));
  assert.equal(deploys.length, 2);
  for (const line of deploys) {
    const target = line.match(/--legacy (\S+)/)[1];
    assert.ok(line.endsWith(`&& rm ${target}/node_modules/.modules.yaml`), line);
  }
});
