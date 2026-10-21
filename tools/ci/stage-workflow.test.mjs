import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

/**
 * `.github/workflows/stage.yml` (#2985) — the static promises a public repository's
 * Actions run must keep (release-pipeline-off-workstation spec §4): the stage report
 * never becomes an Actions artifact, and the `stage` environment's secrets reach only
 * the two jobs that need them.
 */
const WORKFLOWS = fileURLToPath(
  new URL("../../.github/workflows/", import.meta.url),
);
const read = (name) => readFileSync(path.join(WORKFLOWS, name), "utf8");
const stage = parse(read("stage.yml"));

const environmentOf = (job) =>
  typeof job.environment === "string" ? job.environment : job.environment?.name;

describe("stage.yml", () => {
  it("has no upload-artifact step in any job", () => {
    for (const [name, job] of Object.entries(stage.jobs)) {
      for (const step of job.steps ?? []) {
        assert.equal(
          String(step.uses ?? "").startsWith("actions/upload-artifact"),
          false,
          `job ${name} uploads an artifact`,
        );
      }
    }
    assert.equal(read("stage.yml").includes("upload-artifact"), false);
  });

  it("uses environment `stage` only in its converge and suite jobs", () => {
    const withStage = Object.entries(stage.jobs)
      .filter(([, job]) => environmentOf(job) === "stage")
      .map(([name]) => name)
      .sort();
    assert.deepEqual(withStage, ["converge", "suite"]);
  });

  it("is the only workflow that names environment `stage`", () => {
    for (const file of readdirSync(WORKFLOWS).filter((f) =>
      /\.ya?ml$/.test(f),
    )) {
      if (file === "stage.yml") continue;
      for (const [name, job] of Object.entries(parse(read(file)).jobs ?? {})) {
        assert.notEqual(environmentOf(job), "stage", `${file} job ${name}`);
      }
    }
  });

  it("runs only on a successful push run of runtime-images on main; only that run joins the never-cancelled stage-main group", () => {
    assert.deepEqual(stage.on.workflow_run.workflows, ["Runtime images"]);
    assert.equal(parse(read("runtime-images.yml")).name, "Runtime images");
    const gate = stage.jobs.converge.if;
    assert.match(gate, /workflow_run\.conclusion == 'success'/);
    assert.match(gate, /workflow_run\.event == 'push'/);
    assert.match(gate, /workflow_run\.head_branch == 'main'/);
    // Only a successful push-to-main run joins `stage-main`; every other
    // (skipped) run gets its own per-run group so it can never cancel main's
    // pending run.
    assert.equal(stage.concurrency["cancel-in-progress"], false);
    const group = stage.concurrency.group;
    assert.match(group, /workflow_run\.conclusion == 'success'/);
    assert.match(group, /workflow_run\.event == 'push'/);
    assert.match(group, /workflow_run\.head_branch == 'main'/);
    assert.ok(group.includes("&& 'stage-main' ||"), group);
    assert.ok(group.includes("format('stage-other-{0}', github.run_id)"), group);
    assert.deepEqual(stage.permissions, { contents: "read" });
    assert.deepEqual(stage.jobs.suite.needs, "converge");
  });

  it("runs the suite in public-log mode, as the release check", () => {
    const suite = stage.jobs.suite;
    assert.equal(suite.env.E2E_PUBLIC_LOG, "1");
    assert.equal(suite.env.CI, "1");
    const run = suite.steps.find((s) => s.id === "suite").run;
    assert.match(
      run,
      /node tools\/staging\/e2e-stage\.mjs main --expect-sha "\$SHA"/,
    );
    const ship = suite.steps.find(
      (s) => s.name === "Ship the report to the box",
    );
    assert.equal(ship.if, "always()");
    assert.match(ship.run, /upload-report \$SHA/);
  });

  it("3119: the suite reads the box through the CI key's observe verb, written before it runs", () => {
    const steps = stage.jobs.suite.steps;
    const key = steps.findIndex((s) => s.name === "Write the ssh key");
    const suite = steps.findIndex((s) => s.id === "suite");
    assert.ok(key >= 0 && key < suite, "the key is written before the suite");
    const run = steps[suite].run;
    assert.match(
      run,
      /export E2E_STAGE_OBSERVE_SSH="\$STAGE_SSH_USER@\$STAGE_SSH_HOST"/,
    );
    assert.match(
      run,
      /export E2E_STAGE_OBSERVE_KEY="\$RUNNER_TEMP\/stage-ssh\/key"/,
    );
    assert.match(
      run,
      /export E2E_STAGE_OBSERVE_KNOWN_HOSTS="\$RUNNER_TEMP\/stage-ssh\/known_hosts"/,
    );
    assert.equal(
      JSON.stringify(steps[suite].env ?? {}).includes("STAGE_SSH_KEY"),
      false,
      "the key itself never reaches the suite env",
    );
  });

  it("ships the report under pipefail and surfaces a failed upload as a warning", () => {
    const ship = stage.jobs.suite.steps.find(
      (s) => s.name === "Ship the report to the box",
    );
    assert.match(ship.run, /set -o pipefail/);
    assert.match(ship.run, /::warning::report upload failed/);
    assert.match(ship.run, /GITHUB_STEP_SUMMARY/);
  });

  it("closes a stage-suite status the suite job never reached", () => {
    const close = stage.jobs["close-status"];
    assert.deepEqual(close.needs, ["converge", "suite"]);
    assert.match(close.if, /always\(\)/);
    assert.match(close.if, /needs\.converge\.result == 'success'/);
    assert.match(close.if, /needs\.suite\.result != 'success'/);
    assert.match(close.if, /needs\.suite\.result != 'failure'/);
    assert.equal(environmentOf(close), undefined);
    assert.match(close.steps[0].run, /state=failure/);
  });
});
