import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

/**
 * `.github/workflows/stage.yml` (#2985) — the static promises a public repository's
 * Actions run must keep (release-pipeline-off-workstation spec §4): the stage report
 * never becomes an Actions artifact, the `stage` environment's secrets reach only the
 * two `main` jobs that need them, and the PR-slot run (#4202) takes `stage-pr`'s.
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

  it("uses environment `stage` only in its converge and suite jobs; the PR-slot run uses `stage-pr`", () => {
    const withStage = Object.entries(stage.jobs)
      .filter(([, job]) => environmentOf(job) === "stage")
      .map(([name]) => name)
      .sort();
    assert.deepEqual(withStage, ["converge", "suite"]);
    const withStagePr = Object.entries(stage.jobs)
      .filter(([, job]) => environmentOf(job) === "stage-pr")
      .map(([name]) => name);
    assert.deepEqual(withStagePr, ["slot-suite"]);
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
    assert.ok(
      group.includes("format('stage-other-{0}', github.run_id)"),
      group,
    );
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
    assert.match(ship.run, /"upload-report \$SHA \$key"/);
  });

  it("4250: ships each attempt to its own box dir, keyed by e2e-stage.mjs", () => {
    const ship = stage.jobs.suite.steps.find((s) => s.name === "Ship the report to the box");
    const m = ship.run.match(/node --input-type=module -e '([\s\S]*?)' "\$SHA"/);
    assert.ok(m, "the key comes from tools/staging/e2e-stage.mjs");
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const out = (attempt) =>
      execFileSync(process.execPath, ["--input-type=module", "-e", m[1], sha], {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        env: { ...process.env, GITHUB_RUN_ATTEMPT: attempt, GITHUB_RUN_ID: "19876543210" },
        encoding: "utf8",
      }).trim();
    assert.equal(
      out("1"),
      `attempt-1-run-19876543210 /var/lib/ds-platform/e2e-reports/${sha}/attempt-1-run-19876543210/`,
    );
    assert.notEqual(out("2"), out("1"), "a re-run is a new dir");
    assert.match(ship.run, /echo "report: \$box_dir on the stage box"/);
    assert.doesNotMatch(ship.run, /e2e-reports\/\$SHA\//, "no flat per-SHA path left");
  });

  it("scopes staff credentials to the timed suite invocation", () => {
    const suite = stage.jobs.suite.steps.find((step) => step.id === "suite");
    const commands = suite.run
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));
    const pairs = ["admin", "committee"].flatMap((actor) => [
      [`DS_STAGE_AGENT_${actor.toUpperCase()}_PASSWORD`, `stage_suite_${actor}_password`],
      [`DS_STAGE_AGENT_${actor.toUpperCase()}_TOTP_SECRET`, `stage_suite_${actor}_totp`],
    ]);
    for (const [key] of pairs) {
      assert.equal(suite.env[key], "$" + "{{ secrets." + key + " }}");
    }
    assert.deepEqual(commands.slice(0, 5), [
      ...pairs.map(([key, local]) => `declare +x ${local}="$${key}"`),
      `unset ${pairs.map(([key]) => key).join(" ")}`,
    ]);
    const launch = commands.findIndex((line) => line.startsWith("/usr/bin/time "));
    assert.ok(launch > 5, "the credentials must leave the ambient environment before launch");
    assert.deepEqual(
      commands.slice(launch - pairs.length, launch),
      pairs.map(([key, local]) => `${key}="$${local}" \\`),
    );
    const status = commands.indexOf("rc=$?");
    assert.ok(status > launch);
    assert.equal(commands[status + 1], `unset ${pairs.map(([, local]) => local).join(" ")}`);
    const copies = commands.filter((line) => /DS_STAGE_AGENT_(ADMIN|COMMITTEE)_|stage_suite_(admin|committee)_/.test(line));
    assert.equal(copies.length, 10, "no other command references a staff credential");
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

  // #4259 B2: a converge the box refused (an operator `e2e:stage main` hold) names its
  // reason in the Actions log and the step summary, from the driver's failure note —
  // the poll step runs for real against a stand-in `ssh` that answers `status`.
  const poll = () =>
    stage.jobs.converge.steps.find((s) => s.name === "Poll the driver until it is terminal");
  const runPoll = (statusJson) => {
    const dir = mkdtempSync(path.join(tmpdir(), "stage-poll-"));
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "ssh"), `#!/usr/bin/env bash\ncat <<'JSON'\n${statusJson}\nJSON\n`, { mode: 0o755 });
    const summary = path.join(dir, "summary.md");
    writeFileSync(summary, "");
    const r = spawnSync("bash", ["-e", "-c", poll().run], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        OUTCOME: "started",
        SHA: "0123456789abcdef0123456789abcdef01234567",
        STAGE_SSH_USER: "deploy",
        STAGE_SSH_HOST: "stage",
        RUNNER_TEMP: dir,
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    return { status: r.status, out: r.stdout + r.stderr, summary: readFileSync(summary, "utf8") };
  };

  it("4259: a converge refused by a slot hold names the holder in the log and the step summary", () => {
    const reason = "slot main is held by operator agent@ws-2 e2e:stage main (pid 7) since 2026-11-25T13:48:00.835Z";
    const { status, out, summary } = runPoll(JSON.stringify({
      release: { state: "failed", step: "-" },
      driver: { active: "failed", rc: 3, failure: { phase: "slot-hold", reason } },
    }));
    assert.equal(status, 1);
    assert.ok(out.includes(`::error::converge failed (driver=failed rc=3 state=failed) — slot-hold: ${reason}`), out);
    assert.ok(summary.includes(`slot-hold: ${reason}`), summary);
  });

  it("4259: a converge failure with no note keeps the bare line", () => {
    const { status, out } = runPoll(JSON.stringify({
      release: { state: "failed" },
      driver: { active: "failed", rc: 1, failure: null },
    }));
    assert.equal(status, 1);
    assert.ok(out.includes("::error::converge failed (driver=failed rc=1 state=failed)\n"), out);
  });
});

it("3752: the run title ends with the SHA under test — retention keeps a queued or running run's images", () => {
  assert.equal(
    stage["run-name"],
    "${{ github.event_name == 'workflow_dispatch' && format('Stage {0} {1}', inputs.slot, inputs.sha) || format('Stage main {0}', github.event.workflow_run.head_sha) }}",
  );
});

describe("stage.yml — the PR-slot dispatch (#4202)", () => {
  const gate = stage.jobs["slot-gate"];
  const slotSuite = stage.jobs["slot-suite"];
  const slotVerdict = stage.jobs["slot-verdict"];
  const slotJobs = [gate, slotSuite, slotVerdict];
  const step = (job, pred) => job.steps.find(pred);
  const checkoutOf = (job) =>
    step(job, (s) => String(s.uses ?? "").startsWith("actions/checkout"));
  const secretsOf = (job) =>
    [...JSON.stringify(job).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);

  it("takes slot + sha and the e2e-stage filters as inputs", () => {
    const inputs = stage.on.workflow_dispatch.inputs;
    assert.deepEqual(Object.keys(inputs), ["slot", "sha", "project", "grep", "no-axe", "no-live"]);
    assert.equal(inputs.slot.required, true);
    assert.equal(inputs.sha.required, true);
    assert.equal(inputs["no-axe"].type, "boolean");
    assert.equal(inputs["no-live"].type, "boolean");
  });

  it("leaves the main path to workflow_run: its jobs never run on a dispatch, and a dispatch queues per slot", () => {
    assert.match(stage.jobs.converge.if, /workflow_run\.event == 'push'/);
    assert.equal(gate.if, "github.event_name == 'workflow_dispatch'");
    assert.equal(slotSuite.needs, "slot-gate");
    // No status function: the default success() holds, so slot-suite runs only when
    // the gate succeeded — and never under main's ref.
    assert.equal(slotSuite.if, "github.ref != 'refs/heads/main'");
    assert.deepEqual(slotVerdict.needs, ["slot-gate", "slot-suite"]);
    assert.equal(slotVerdict.if, "always() && github.event_name == 'workflow_dispatch'");
    assert.ok(
      stage.concurrency.group.startsWith(
        "${{ github.event_name == 'workflow_dispatch' && format('stage-slot-{0}', inputs.slot) ||",
      ),
    );
  });

  it("checks slot, ref and PR head with no environment and no secret, refusing main's ref and a ref that is not the PR branch", () => {
    assert.equal(checkoutOf(gate).with.ref, undefined, "the gate checks out the workflow's own ref");
    assert.equal(environmentOf(gate), undefined);
    assert.deepEqual(secretsOf(gate), []);
    assert.deepEqual(gate.permissions, { contents: "read", "pull-requests": "read" });
    const run = step(gate, (s) => s.id === "gate").run;
    assert.match(run, /gh api "repos\/\$GITHUB_REPOSITORY\/pulls\/\$\{SLOT#pr-\}"/);
    assert.match(run, /prSlotGate\(\{[^}]*ref: e\.GITHUB_REF[^}]*\}\)/);
    assert.match(run, /process\.exit\(1\)/);
  });

  it("never runs a PR-slot job with the box's ssh key", () => {
    for (const job of slotJobs) assert.doesNotMatch(JSON.stringify(job), /STAGE_SSH_KEY|STAGE_SSH_KNOWN_HOSTS/);
  });

  it("writes no Actions cache from the PR's code", () => {
    for (const s of slotSuite.steps) {
      const uses = String(s.uses ?? "");
      assert.equal(s.with?.cache, undefined, `${uses || s.name}: no setup-* cache (it saves post-job)`);
      assert.ok(!/^actions\/cache(@|\/save@)/.test(uses), `${uses}: restore-only, never a cache save`);
      assert.ok(!uses.startsWith("docker/"), `${uses}: no buildx in this job`);
    }
    assert.doesNotMatch(JSON.stringify(slotSuite), /type=gha|ACTIONS_CACHE|ACTIONS_RUNTIME_TOKEN/);
  });

  it("asserts the slot serves the gated head and leaves the box-observing tests out by name", () => {
    const run = step(slotSuite, (s) => s.id === "suite").run;
    assert.match(run, /--slot-sha "\$SHA"/);
    assert.match(run, /--no-box-observe/);
    assert.equal(slotSuite.env.SHA, "${{ inputs.sha }}");
  });

  it("runs the PR's code with the suite's secrets only: no ssh key, no statuses, no box upload", () => {
    assert.equal(checkoutOf(slotSuite).with.ref, "${{ inputs.sha }}");
    assert.deepEqual(
      [...new Set(secretsOf(slotSuite))].sort(),
      [
        "DS_GOLDEN_PASSWORD_ADMIN",
        "DS_GOLDEN_PASSWORD_DOCTOR_MFA",
        "DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED",
        "DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED",
        "DS_STAGE_AGENT_ADMIN_PASSWORD",
        "DS_STAGE_AGENT_ADMIN_TOTP_SECRET",
        "DS_STAGE_AGENT_COMMITTEE_PASSWORD",
        "DS_STAGE_AGENT_COMMITTEE_TOTP_SECRET",
        "E2E_CAPTCHA_TEST_TOKEN",
        "STAGE_BASIC_AUTH_PASS",
      ],
    );
    const text = JSON.stringify(slotSuite);
    assert.doesNotMatch(text, /STAGE_SSH|ssh -i|upload-report|E2E_STAGE_OBSERVE/);
    for (const job of slotJobs) {
      assert.equal(job.permissions.statuses, undefined);
      for (const s of job.steps) assert.doesNotMatch(String(s.run ?? ""), /statuses/);
    }
    const suite = step(slotSuite, (s) => s.id === "suite");
    assert.match(
      suite.run,
      /node tools\/staging\/e2e-stage\.mjs "\$SLOT" --local --report-dir "\$REPORT_DIR" \\\n\s+--verdict-file "\$RUNNER_TEMP\/verdict\.txt" --slot-sha "\$SHA" --no-box-observe "\$\{filters\[@\]\}"/,
    );
    assert.doesNotMatch(suite.run, /--expect-sha/);
    assert.equal(slotSuite.env.E2E_PUBLIC_LOG, "1");
  });

  it("interpolates no input into a shell: every input reaches `run` through env", () => {
    for (const job of slotJobs) {
      for (const s of job.steps) {
        assert.doesNotMatch(String(s.run ?? ""), /\$\{\{/, `${s.name ?? s.uses}`);
      }
    }
  });

  it("renders and posts the verdict with GITHUB_TOKEN only, PASS only from the job result", () => {
    assert.equal(checkoutOf(slotVerdict).with.ref, undefined);
    assert.equal(environmentOf(slotVerdict), undefined);
    assert.deepEqual(secretsOf(slotVerdict), []);
    assert.deepEqual(slotVerdict.permissions, { contents: "read", "pull-requests": "write" });
    const post = step(slotVerdict, (s) => s.name === "Comment the verdict on the PR");
    assert.equal(post.env.SUITE_RESULT, "${{ needs.slot-suite.result }}");
    assert.match(post.run, /passed: !e\.GATE_REASON && e\.SUITE_RESULT === "success"/);
    assert.match(post.run, /issues\/\$\{SLOT#pr-\}\/comments/);
    // The stop reason names the branch policy or a stale branch from the dispatched ref.
    assert.equal(post.env.BRANCH, "${{ github.ref_name }}");
    assert.match(post.run, /suiteStoppedReason\(\{ suiteResult: e\.SUITE_RESULT, branch: e\.BRANCH \}\)/);
    assert.equal(slotSuite.outputs.tally, "${{ steps.summary.outputs.tally }}");
  });
});
