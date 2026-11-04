// Issue #3662: the runner side of the automated key custody — recovery-custody.yml and
// its status filter (spec §5 «Prod read verbs.»; infra/deploy/RECOVERY.md §2
// «Automated custody (CI)»). The repository is public: the job log is public.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { DATA_READ_VERBS } from "./lib/data-prod.mjs";
import {
  RECOVERY_LINE_RE,
  RECOVERY_VERBS,
  recoveryReport,
} from "./lib/recovery-custody.mjs";
import {
  BOX_ENTRYPOINTS,
  DS_RECOVERY_BIN,
  recoveryToolsConvergeScript,
} from "./lib/remote.mjs";
import { CRONS, main } from "./recovery-custody.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../..");
const WORKFLOW = parse(
  readFileSync(join(REPO, ".github/workflows/recovery-custody.yml"), "utf8"),
);
const READ_ENTRYPOINT = readFileSync(
  join(REPO, "infra/deploy/bin/ds-read-entrypoint"),
  "utf8",
);
const DATA_ENTRYPOINT = readFileSync(
  join(REPO, "infra/deploy/bin/ds-deploy-entrypoint"),
  "utf8",
);
const shellVar = (text, name) => {
  const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
  assert.ok(line, `defines ${name}`);
  return line.slice(name.length + 1).replace(/^'|'$/g, "");
};

test("3662: the verb whitelist — ds-read-entrypoint serves the two recovery verbs, the data box the four behind them", () => {
  assert.deepEqual(shellVar(READ_ENTRYPOINT, "READ_VERBS").split(" "), [
    "capabilities",
    "schema",
    ...RECOVERY_VERBS,
  ]);
  assert.match(
    READ_ENTRYPOINT,
    /^ {2}capabilities \| schema \| recovery-bundle \| recovery-check\) \[\[ \$\{#words\[@\]\} -eq 1 \]\]/m,
  );
  for (const verb of [
    "recovery-bundle",
    "recovery-check",
    "recovery-put",
    "recovery-latest",
  ]) {
    assert.ok(DATA_READ_VERBS.includes(verb), verb);
  }
  // The runner's status grammar is the entrypoint's.
  assert.equal(
    shellVar(READ_ENTRYPOINT, "RECOVERY_LINE_RE"),
    RECOVERY_LINE_RE.source,
  );
});

test("3662: ds-recovery is installed on both prod boxes, and the release installs age on ds-api-prod", () => {
  assert.ok(
    BOX_ENTRYPOINTS.some(
      ({ dest, path }) =>
        dest === DS_RECOVERY_BIN && path === "infra/deploy/bin/ds-recovery",
    ),
  );
  assert.match(
    DATA_ENTRYPOINT,
    /^ {2}\/usr\/local\/lib\/ds-platform\/ds-recovery=infra\/deploy\/bin\/ds-recovery$/m,
  );
  assert.equal(
    recoveryToolsConvergeScript(),
    "sudo /usr/local/lib/ds-platform/ds-recovery install-age",
  );
  const prod = readFileSync(join(here, "prod.mjs"), "utf8");
  const read = prod.indexOf('{ label: "converge the read key" }');
  const age = prod.indexOf(
    'if (local) await sshScript(API_PROD, recoveryToolsConvergeScript(), { label: "install age" });',
  );
  assert.ok(read > 0 && age > read, "after the read-key converge");
  assert.match(
    DATA_ENTRYPOINT,
    /install_entrypoints "\$\{words\[1\]\}"\n.*\n {6}sudo "\$DS_RECOVERY" install-age <\/dev\/null \|\| true\n/,
  );
});

test("3662: the committed custodians file holds no recipient until the ceremony (fail closed, no placeholder)", () => {
  const text = readFileSync(
    join(REPO, "infra/deploy/recovery/custodians.txt"),
    "utf8",
  );
  const live = text
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"));
  assert.deepEqual(live, []);
});

describe("3662: recovery-custody.yml", () => {
  it("runs weekly (bundle) and daily (check) plus a dispatch of either verb", () => {
    assert.deepEqual(
      WORKFLOW.on.schedule.map((s) => s.cron),
      [CRONS.bundle, CRONS.check],
    );
    assert.deepEqual(WORKFLOW.on.workflow_dispatch.inputs.verb.options, [
      "recovery-check",
      "recovery-bundle",
    ]);
  });
  it("reuses the read key, its Environment and prod-observe's concurrency group; uploads no artifact", () => {
    const job = WORKFLOW.jobs.custody;
    assert.deepEqual(job.environment, {
      name: "production-read",
      deployment: false,
    });
    assert.deepEqual(WORKFLOW.concurrency, {
      group: "prod-observe",
      "cancel-in-progress": false,
    });
    assert.deepEqual(WORKFLOW.permissions, { contents: "read" });
    const text = JSON.stringify(job.steps);
    assert.match(text, /secrets\.PROD_READ_SSH_KEY/);
    assert.ok(
      !job.steps.some((s) =>
        String(s.uses ?? "").startsWith("actions/upload-artifact"),
      ),
      "no artifact",
    );
    assert.match(text, /check-capabilities/);
  });
  it("never prints the box's raw output: every ssh call redirects stdout and stderr to files", () => {
    for (const step of WORKFLOW.jobs.custody.steps.filter((s) =>
      /\bssh -i/.test(s.run ?? ""),
    )) {
      assert.match(
        step.run,
        />"\$RUNNER_TEMP\/[a-z.]+" 2>"\$RUNNER_TEMP\/[a-z.]+"/,
        step.name,
      );
    }
  });
  it("a schedule picks its verb; an unknown one fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-custody-"));
    try {
      const out = join(dir, "out");
      assert.equal(
        main(["verb", "schedule", CRONS.bundle, ""], { output: out }),
        0,
      );
      assert.equal(
        main(["verb", "schedule", CRONS.check, ""], { output: out }),
        0,
      );
      assert.equal(
        main(["verb", "workflow_dispatch", "", "recovery-check"], {
          output: out,
        }),
        0,
      );
      assert.equal(
        readFileSync(out, "utf8"),
        "verb=recovery-bundle\nverb=recovery-check\nverb=recovery-check\n",
      );
      assert.equal(
        main(["verb", "schedule", "0 0 * * *", ""], { output: out }),
        1,
      );
      assert.equal(
        main(["verb", "workflow_dispatch", "", "schema"], { output: out }),
        1,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("3662: the status filter — status lines only, a pass needs both boxes", () => {
  const STAMP = "20261104T031700Z";
  it("a bundle passes with STORED from both boxes", () => {
    const r = recoveryReport({
      verb: "recovery-bundle",
      rc: 0,
      stdout: `api-prod STORED ${STAMP} members 4\ndata-prod STORED ${STAMP} members 2\n`,
      stderr: "",
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.lines.slice(1), [
      `api-prod STORED ${STAMP} members 4`,
      `data-prod STORED ${STAMP} members 2`,
    ]);
  });
  it("a check passes with MATCH from both boxes only", () => {
    const pass = recoveryReport({
      verb: "recovery-check",
      rc: 0,
      stdout: "api-prod MATCH\ndata-prod MATCH\n",
      stderr: "",
    });
    assert.equal(pass.ok, true);
    for (const stdout of [
      "api-prod MATCH\n",
      "api-prod MATCH\ndata-prod STALE 9d\n",
      "api-prod MISMATCH api.env:SIGN_IN_RECORD_KEY\ndata-prod MATCH\n",
      "api-prod MISSING\ndata-prod MATCH\n",
    ]) {
      assert.equal(
        recoveryReport({ verb: "recovery-check", rc: 1, stdout, stderr: "" })
          .ok,
        false,
        stdout,
      );
      assert.equal(
        recoveryReport({ verb: "recovery-check", rc: 0, stdout, stderr: "" })
          .ok,
        false,
        stdout,
      );
    }
  });
  it("drops any box line outside the grammar — a value, a fingerprint, ciphertext — and fails", () => {
    const leaks = [
      "SIGN_IN_RECORD_KEY=0123456789abcdef",
      `api-prod MATCH ${"a".repeat(64)}`,
      "age-encryption.org/v1",
      "-> X25519 abc",
      "api-prod MISMATCH api.env:KEY=value",
    ];
    const r = recoveryReport({
      verb: "recovery-check",
      rc: 0,
      stdout: `api-prod MATCH\ndata-prod MATCH\n${leaks.join("\n")}\n`,
      stderr: leaks.join("\n"),
    });
    assert.equal(r.ok, false);
    const text = r.lines.join("\n");
    for (const leak of leaks) assert.ok(!text.includes(leak), leak);
    assert.match(text, /5 line\(s\) outside the status grammar dropped/);
  });
  it("carries the entrypoint's fixed refusal lines, and only those", () => {
    const r = recoveryReport({
      verb: "recovery-bundle",
      rc: 3,
      stdout: "",
      stderr:
        "ds-read-entrypoint: api-prod: ds-recovery: custodians.txt holds 0 valid age recipients, 2 are required: #3662 custodian ceremony pending\nssh: some secret=detail\n",
    });
    assert.equal(r.ok, false);
    assert.ok(
      r.lines.some((l) => l.includes("#3662 custodian ceremony pending")),
    );
    assert.ok(!r.lines.some((l) => l.includes("secret=detail")));
  });
  it("refuses an unknown verb", () => {
    assert.equal(
      recoveryReport({ verb: "schema", rc: 0, stdout: "", stderr: "" }).ok,
      false,
    );
  });
});
