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
  it("is a workflow_dispatch with the required inputs sha and owner_quote, and nothing else", () => {
    assert.deepEqual(Object.keys(wf.on), ["workflow_dispatch"]);
    const inputs = wf.on.workflow_dispatch.inputs;
    assert.deepEqual(Object.keys(inputs).sort(), ["owner_quote", "sha"]);
    for (const name of ["sha", "owner_quote"]) {
      assert.equal(inputs[name].required, true, name);
      assert.equal(inputs[name].type, "string", name);
    }
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
      /"release prod \$SHA" \\\n\s+< "manifest\/images-\$SHA\.json"/,
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
    assert.equal(record.if, "always() && steps.poll.outputs.terminal != ''");
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
    assert.equal(job.if, "needs.deploy.result == 'success'");
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
