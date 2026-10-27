import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

/**
 * `.github/workflows/deploy-prod.yml` (#3158) — the release workflow's static
 * promises (spec 2026-10-16-release-pipeline-off-workstation §3 item 3, §4): the
 * owner quote is refused first and reaches steps only through `env:`, one release
 * at a time with none cancelled, the spec's permissions, no GitHub-made
 * Deployment, no escape hatch, and the digest called with its secret passed.
 */
const WORKFLOWS = fileURLToPath(
  new URL("../../.github/workflows/", import.meta.url),
);
const read = (name) => readFileSync(path.join(WORKFLOWS, name), "utf8");
const raw = read("deploy-prod.yml");
const wf = parse(raw);
const digest = parse(read("release-digest.yml"));

const environmentOf = (job) =>
  typeof job.environment === "string" ? job.environment : job.environment?.name;
const stepRuns = (job) => (job.steps ?? []).map((s) => s.run ?? "").join("\n");

describe("deploy-prod.yml", () => {
  it("is a workflow_dispatch with sha, mode (release | rollback | redeploy), owner_quote and reason, and nothing else", () => {
    assert.deepEqual(Object.keys(wf.on), ["workflow_dispatch"]);
    const inputs = wf.on.workflow_dispatch.inputs;
    assert.deepEqual(Object.keys(inputs).sort(), [
      "mode",
      "owner_quote",
      "reason",
      "sha",
    ]);
    assert.equal(inputs.sha.required, true);
    assert.equal(inputs.sha.type, "string");
    assert.equal(inputs.mode.type, "choice");
    assert.deepEqual(inputs.mode.options, ["release", "rollback", "redeploy"]);
    assert.equal(inputs.mode.default, "release");
    // Each mode's own text input is enforced by the first step, per mode.
    for (const name of ["owner_quote", "reason"]) {
      assert.equal(inputs[name].type, "string", name);
    }
  });

  it("2987: the first step refuses a blank owner_quote in release mode and a blank reason in rollback mode", () => {
    const step = wf.jobs.preflight.steps[0];
    assert.deepEqual(step.env, {
      MODE: "${{ inputs.mode }}",
      OWNER_QUOTE: "${{ inputs.owner_quote }}",
      REASON: "${{ inputs.reason }}",
    });
    const release = step.run.indexOf("release | redeploy)");
    const rollback = step.run.indexOf("rollback)");
    assert.ok(release > 0 && rollback > release);
    assert.match(
      step.run.slice(release, rollback),
      /\$\{OWNER_QUOTE\/\/\[\[:space:\]\]\/\}[\s\S]*exit 1/,
    );
    assert.match(
      step.run.slice(rollback),
      /\$\{REASON\/\/\[\[:space:\]\]\/\}[\s\S]*exit 1/,
    );
    // An unknown mode is refused, never read as a release.
    assert.match(step.run, /\*\)[\s\S]*exit 1/);
  });

  it("2987: the reason reaches steps only through env:", () => {
    const reasonUses = raw.match(/inputs\.reason/g) ?? [];
    const envUses = [...Object.values(wf.jobs)].flatMap((job) =>
      (job.steps ?? []).filter(
        (s) => s.env?.REASON === "${{ inputs.reason }}",
      ),
    );
    assert.ok(envUses.length >= 3);
    assert.equal(reasonUses.length, envUses.length);
  });

  it("2987: rollback mode runs its own pre-flight, rollback prod / rollback-status prod, its record and notice — never the release path", () => {
    const pre = wf.jobs.preflight.steps;
    const byId = (steps, id) => steps.find((s) => s.id === id);
    assert.equal(byId(pre, "preflight").if, "inputs.mode == 'release'");
    const rbPre = byId(pre, "rollback-preflight");
    assert.equal(rbPre.if, "inputs.mode == 'rollback'");
    assert.match(
      rbPre.run,
      /release-runner\.mjs rollback-preflight --sha "\$SHA"/,
    );
    assert.equal(
      wf.jobs.preflight.outputs["images-run-id"],
      "${{ steps.preflight.outputs.images-run-id || steps.rollback-preflight.outputs.images-run-id || steps.redeploy-preflight.outputs.images-run-id }}",
    );
    const steps = wf.jobs.deploy.steps;
    for (const id of ["release", "poll"]) {
      assert.equal(byId(steps, id).if, "inputs.mode != 'rollback'", id);
    }
    const start = byId(steps, "rollback");
    assert.equal(start.if, "inputs.mode == 'rollback'");
    assert.match(
      start.run,
      /"rollback prod \$SHA" \\\n\s+< "manifest\/images-\$SHA\.json"/,
    );
    const poll = byId(steps, "rollback-poll");
    assert.equal(poll.if, "inputs.mode == 'rollback'");
    assert.match(poll.run, /"rollback-status prod \$SHA"/);
    assert.match(poll.run, /release-runner\.mjs rollback-verdict --sha "\$SHA"/);
    // Lost contact and the time-out set `unknown` before leaving the loop.
    for (const marker of [
      /failed \$ssh_failures times in a row/,
      /did not finish within 30 min/,
    ]) {
      const at = poll.run.search(marker);
      assert.ok(at > 0, String(marker));
      const exit = poll.run.indexOf("exit 1", at);
      const unknown = poll.run.indexOf("terminal unknown", at);
      assert.ok(unknown > at && unknown < exit, String(marker));
    }
    const record = byId(steps, "rollback-record");
    assert.equal(
      record.if,
      "always() && inputs.mode == 'rollback' && steps.rollback-poll.outputs.terminal != ''",
    );
    assert.match(record.run, /rollback-record --sha "\$SHA"/);
    assert.equal(record.env.OWNER_QUOTE, undefined);
    const notice = steps.find((s) => /rollback-notice/.test(s.run ?? ""));
    assert.equal(notice.if, record.if);
    assert.equal(
      notice.env.MATTERMOST_WEBHOOK_URL,
      "${{ secrets.MATTERMOST_WEBHOOK_URL }}",
    );
    // No release cut and no digest in rollback mode.
    assert.match(wf.jobs.digest.if, /^inputs\.mode == 'release' && /);
  });

  it("3354: redeploy mode re-runs the live SHA through the release driver — own pre-flight and record, no release cut, no digest", () => {
    const byId = (steps, id) => steps.find((s) => s.id === id);
    const first = wf.jobs.preflight.steps[0];
    // The owner's word is required exactly as for a release.
    assert.match(
      first.run,
      /release \| redeploy\)[\s\S]*\$\{OWNER_QUOTE\/\/\[\[:space:\]\]\/\}[\s\S]*exit 1[\s\S]*rollback\)/,
    );
    assert.match(first.run, /mode must be release, rollback or redeploy/);
    const pre = byId(wf.jobs.preflight.steps, "redeploy-preflight");
    assert.equal(pre.if, "inputs.mode == 'redeploy'");
    assert.equal(pre.env.OWNER_QUOTE, "${{ inputs.owner_quote }}");
    assert.match(
      pre.run,
      /release-runner\.mjs redeploy-preflight --sha "\$SHA"/,
    );
    const steps = wf.jobs.deploy.steps;
    // The same start, poll and status-only log as a release: only the verb differs.
    const start = byId(steps, "release");
    assert.equal(start.if, "inputs.mode != 'rollback'");
    assert.equal(start.env.MODE, "${{ inputs.mode }}");
    assert.equal(byId(steps, "poll").if, "inputs.mode != 'rollback'");
    const record = byId(steps, "redeploy-record");
    assert.equal(
      record.if,
      "always() && inputs.mode == 'redeploy' && steps.poll.outputs.terminal != ''",
    );
    assert.equal(record.env.OWNER_QUOTE, "${{ inputs.owner_quote }}");
    assert.equal(record.env.TERMINAL, "${{ steps.poll.outputs.terminal }}");
    assert.match(
      record.run,
      /release-runner\.mjs redeploy-record --sha "\$SHA" --state "\$TERMINAL"/,
    );
    // Only the release's own record step cuts a Release and feeds the digest.
    const cuts = steps.filter((s) =>
      /release-runner\.mjs record /.test(s.run ?? ""),
    );
    assert.deepEqual(
      cuts.map((s) => s.id),
      ["record"],
    );
    assert.match(wf.jobs.digest.if, /^inputs\.mode == 'release' && /);
  });

  it("refuses an empty or whitespace-only owner_quote before any other step", () => {
    const first = Object.keys(wf.jobs)[0];
    assert.equal(first, "preflight");
    const step = wf.jobs.preflight.steps[0];
    assert.equal(step.env.OWNER_QUOTE, "${{ inputs.owner_quote }}");
    assert.match(step.run, /\$\{OWNER_QUOTE\/\/\[\[:space:\]\]\/\}/);
    assert.match(step.run, /exit 1/);
    // Every other job runs only after the pre-flight (the quote check included).
    assert.equal(wf.jobs.deploy.needs, "preflight");
    assert.equal(wf.jobs.digest.needs, "deploy");
  });

  it("the quote reaches steps only through env:, never ${{ }} inside run:", () => {
    for (const [name, job] of Object.entries(wf.jobs)) {
      for (const step of job.steps ?? []) {
        assert.equal(
          /\$\{\{/.test(step.run ?? ""),
          false,
          `${name}: ${step.name}`,
        );
      }
    }
    const quoteUses = raw.match(/inputs\.owner_quote/g) ?? [];
    const envUses = [...Object.values(wf.jobs)].flatMap((job) =>
      (job.steps ?? []).filter(
        (s) => s.env?.OWNER_QUOTE === "${{ inputs.owner_quote }}",
      ),
    );
    assert.equal(quoteUses.length, envUses.length);
  });

  it("one release at a time in its own group deploy-prod, none cancelled", () => {
    assert.deepEqual(wf.concurrency, {
      group: "deploy-prod",
      "cancel-in-progress": false,
    });
    // The changesets workflow keeps `release`; the two groups never meet (#3125).
    assert.equal(parse(read("release.yml")).concurrency.group, "release");
  });

  it("the deploy job runs in Environment production with deployment: false", () => {
    assert.deepEqual(wf.jobs.deploy.environment, {
      name: "production",
      deployment: false,
    });
    const withProduction = Object.entries(wf.jobs)
      .filter(([, job]) => environmentOf(job) === "production")
      .map(([name]) => name);
    assert.deepEqual(withProduction, ["deploy"]);
  });

  it("the prod ssh key is read only by the deploy job", () => {
    for (const [name, job] of Object.entries(wf.jobs)) {
      if (name === "deploy") continue;
      assert.equal(JSON.stringify(job).includes("PROD_SSH_KEY"), false, name);
    }
    for (const file of readdirSync(WORKFLOWS).filter((f) =>
      /\.ya?ml$/.test(f),
    )) {
      if (file === "deploy-prod.yml") continue;
      assert.equal(read(file).includes("secrets.PROD_SSH_KEY"), false, file);
    }
  });

  it("carries the spec's permissions: write only where the release needs it", () => {
    assert.deepEqual(wf.permissions, { contents: "read" });
    assert.deepEqual(wf.jobs.deploy.permissions, {
      actions: "read",
      checks: "read",
      contents: "write",
      deployments: "write",
      issues: "read",
      "pull-requests": "read",
      statuses: "read",
    });
    const pre = wf.jobs.preflight.permissions;
    assert.equal(
      Object.values(pre).every((v) => v === "read"),
      true,
      "the pre-flight writes nothing",
    );
    for (const scope of [
      "actions",
      "checks",
      "contents",
      "issues",
      "pull-requests",
      "statuses",
    ]) {
      assert.equal(pre[scope], "read", scope);
    }
  });

  it("runs the runner pre-flight, then release prod / status prod over ssh", () => {
    assert.match(
      stepRuns(wf.jobs.preflight),
      /node tools\/deploy\/release-runner\.mjs preflight --sha "\$SHA"/,
    );
    const deploy = stepRuns(wf.jobs.deploy);
    assert.match(
      deploy,
      /"\$verb prod \$SHA" \\\n\s+< "manifest\/images-\$SHA\.json"/,
    );
    assert.match(
      deploy,
      /verb=release\nif \[ "\$MODE" = redeploy \]; then verb=redeploy; fi/,
    );
    assert.match(deploy, /"status prod \$SHA"/);
    assert.match(deploy, /StrictHostKeyChecking=yes/);
    const download = wf.jobs.deploy.steps.find((s) =>
      String(s.uses ?? "").startsWith("actions/download-artifact"),
    );
    assert.equal(
      download.with["run-id"],
      "${{ needs.preflight.outputs.images-run-id }}",
    );
  });

  it("prints status lines only: no journal, compose logs or raw status json", () => {
    const deploy = stepRuns(wf.jobs.deploy);
    for (const banned of [
      "journalctl",
      "docker compose logs",
      'echo "$json"',
      "cat manifest",
    ]) {
      assert.equal(deploy.includes(banned), false, banned);
    }
    assert.equal(raw.includes("upload-artifact"), false);
  });

  it("writes the record for success and failure after a terminal status only", () => {
    const record = wf.jobs.deploy.steps.find((s) =>
      /release-runner\.mjs record/.test(s.run ?? ""),
    );
    assert.equal(
      record.if,
      "always() && inputs.mode == 'release' && steps.poll.outputs.terminal != ''",
    );
    assert.equal(record.env.OWNER_QUOTE, "${{ inputs.owner_quote }}");
    assert.match(
      record.run,
      /--state "\$TERMINAL" --previous-sha "\$PREVIOUS_SHA"/,
    );
    const poll = stepRuns(wf.jobs.deploy);
    assert.match(poll, /terminal succeeded/);
    assert.match(poll, /terminal failed/);
    assert.match(poll, /\.driver\.previousSha/);
  });

  it("lost contact and the 60-min time-out record `unknown` before failing the job", () => {
    const poll = wf.jobs.deploy.steps.find((s) => s.id === "poll").run;
    // Each `exit 1` that leaves the loop without a driver verdict sets one first,
    // so the record step (`terminal != ''`) still writes the Deployment record.
    for (const [why, marker] of [
      ["ssh lost", /failed \$ssh_failures times in a row/],
      ["time-out", /did not finish within 60 min/],
    ]) {
      const at = poll.search(marker);
      assert.ok(at > 0, why);
      const exit = poll.indexOf("exit 1", at);
      const unknown = poll.indexOf("terminal unknown", at);
      assert.ok(unknown > at && unknown < exit, why);
    }
  });

  it("the digest runs only for a newly written success record", () => {
    const record = wf.jobs.deploy.steps.find((s) =>
      /release-runner\.mjs record/.test(s.run ?? ""),
    );
    assert.equal(record.id, "record");
    assert.equal(
      wf.jobs.deploy.outputs.recorded,
      "${{ steps.record.outputs.recorded }}",
    );
  });

  it("exposes no escape hatch", () => {
    for (const hatch of [
      "skip-ci-check",
      "release-gate-exempt",
      "allow-live-broadcast",
      "--ref",
      "retry-failed",
      "hotfix",
    ]) {
      assert.equal(raw.replace(/^\s*#.*$/gm, "").includes(hatch), false, hatch);
    }
  });

  it("calls release-digest.yml on success with the webhook secret passed", () => {
    const job = wf.jobs.digest;
    assert.equal(job.uses, "./.github/workflows/release-digest.yml");
    assert.equal(
      job.if,
      "inputs.mode == 'release' && needs.deploy.result == 'success' && needs.deploy.outputs.recorded == 'new'",
    );
    assert.deepEqual(job.with, { sha: "${{ inputs.sha }}" });
    assert.deepEqual(job.secrets, {
      MATTERMOST_WEBHOOK_URL: "${{ secrets.MATTERMOST_WEBHOOK_URL }}",
    });
    // A called workflow's token cannot exceed its caller job's grant.
    for (const [scope, level] of Object.entries(digest.permissions)) {
      assert.equal(job.permissions[scope], level, scope);
    }
  });
});

describe("release-digest.yml", () => {
  it("is callable with sha + the webhook secret and keeps deployment_status", () => {
    assert.ok("deployment_status" in digest.on);
    assert.ok("workflow_dispatch" in digest.on);
    const call = digest.on.workflow_call;
    assert.equal(call.inputs.sha.required, true);
    assert.equal(call.inputs.sha.type, "string");
    assert.ok("MATTERMOST_WEBHOOK_URL" in call.secrets);
    assert.match(digest.jobs.digest.if, /inputs\.sha != ''/);
    const resolve = digest.jobs.digest.steps.find((s) =>
      s.name?.startsWith("Resolve target SHA"),
    );
    assert.equal(resolve.if, "github.event_name != 'deployment_status'");
  });
});
