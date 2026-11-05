// Issue #3662: the runner side of the automated key custody — recovery-custody.yml and
// its status filter (spec §5 «Prod read verbs.»; infra/deploy/RECOVERY.md §2
// «Automated custody (CI)»). The repository is public: the job log is public.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { DATA_READ_VERBS } from "./lib/data-prod.mjs";
import {
  custodianGate,
  MIN_RECIPIENTS,
  RECIPIENT_RE,
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
    "observe",
    "rehearse",
    "rehearse-restore",
    "rehearsal-status",
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
        // The committed custodians.txt holds no recipient yet: the schedule skips.
        "verb=recovery-bundle\nrun=false\nverb=recovery-check\nrun=false\nverb=recovery-check\nrun=true\n",
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

// Until the custodian ceremony a scheduled run would go red every day: while
// custodians.txt holds no recipient line at all it ends green without contacting the
// boxes; any recipient line, valid or not, runs, so a broken file after the ceremony
// fails red on the box; a dispatch always runs. The count is the box gate's own rule
// (ds-recovery check_custodians).
describe("3662: the custodian gate before the ceremony", () => {
  const DS_RECOVERY = join(REPO, "infra/deploy/bin/ds-recovery");
  const DS_RECOVERY_TEXT = readFileSync(DS_RECOVERY, "utf8");
  const R1 = `age1${"q".repeat(58)}`;
  const R2 = `age1${"p".repeat(58)}`;
  const PLUGIN = `age1yubikey1${"q".repeat(50)}`;
  const FIXTURES = {
    empty: "",
    comments: "# role: first custodian\n\n   \n# nothing yet\n",
    one: `# role: first custodian\n${R1}\n`,
    two: `# role: first custodian\n${R1}\n# role: second custodian\r\n${R2}\r\n`,
    duplicate: `# role: first custodian\n${R1}\n# role: second custodian\n${R1}\n`,
    oneAndPlugin: `# role: first custodian\n${R1}\n# role: second custodian\n${PLUGIN}\n`,
    twoAndPlugin: `${R1}\n${R2}\n${PLUGIN}\n`,
    pluginOnly: `# role: first custodian\n${PLUGIN}\n`,
    typo: `# role: first custodian\nage1-not-a-recipient\n`,
    indented: `  ${R1}\n${R2}\n`,
    noNewline: `${R1}\n${R2}`,
  };
  const READY = new Set(["two", "noNewline"]);

  let dir;
  const write = (name, text) => {
    const p = join(dir, `${name}.txt`);
    writeFileSync(p, text);
    return p;
  };
  const run = (event, schedule, input, text) => {
    const output = join(dir, "out");
    const summary = join(dir, "summary");
    writeFileSync(output, "");
    writeFileSync(summary, "");
    const logs = [];
    const log = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    let rc;
    try {
      rc = main(["verb", event, schedule, input], {
        output,
        summary,
        custodians: write("custodians", text),
      });
    } finally {
      console.log = log;
    }
    return {
      rc,
      output: readFileSync(output, "utf8"),
      summary: readFileSync(summary, "utf8"),
      logs,
    };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "recovery-gate-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("pins the recipient rule and the minimum equal to ds-recovery's", () => {
    assert.equal(
      shellVar(DS_RECOVERY_TEXT, "RECIPIENT_RE"),
      RECIPIENT_RE.source,
    );
    assert.equal(
      Number(shellVar(DS_RECOVERY_TEXT, "MIN_RECIPIENTS")),
      MIN_RECIPIENTS,
    );
  });

  it("counts distinct native recipients only; a plugin recipient or a duplicate does not count", () => {
    assert.deepEqual(custodianGate(FIXTURES.empty), {
      count: 0,
      invalid: 0,
      ready: false,
    });
    assert.equal(custodianGate(FIXTURES.comments).count, 0);
    assert.equal(custodianGate(FIXTURES.one).count, 1);
    assert.deepEqual(custodianGate(FIXTURES.two), {
      count: 2,
      invalid: 0,
      ready: true,
    });
    assert.equal(custodianGate(FIXTURES.duplicate).count, 1);
    assert.deepEqual(custodianGate(FIXTURES.oneAndPlugin), {
      count: 1,
      invalid: 1,
      ready: false,
    });
    assert.deepEqual(custodianGate(FIXTURES.twoAndPlugin), {
      count: 2,
      invalid: 1,
      ready: false,
    });
    for (const [name, text] of Object.entries(FIXTURES))
      assert.equal(custodianGate(text).ready, READY.has(name), name);
  });

  const bash =
    spawnSync("bash", ["-c", "true"], { stdio: "ignore" }).status === 0;
  it(
    "agrees with the box gate (`ds-recovery custodians`) on every fixture",
    { skip: !bash && "needs bash" },
    () => {
      for (const [name, text] of Object.entries(FIXTURES)) {
        const r = spawnSync(
          "bash",
          [DS_RECOVERY, "custodians", write(name, text)],
          { encoding: "utf8" },
        );
        assert.equal(r.status === 0, custodianGate(text).ready, name);
        if (r.status !== 0) assert.equal(r.status, 3, name);
      }
    },
  );

  for (const [name, text] of [
    ["an empty file", FIXTURES.empty],
    ["comments and blank lines only", FIXTURES.comments],
  ]) {
    it(`a scheduled run with ${name} (before the ceremony) ends green without contacting the boxes`, () => {
      for (const cron of [CRONS.bundle, CRONS.check]) {
        const r = run("schedule", cron, "", text);
        assert.equal(r.rc, 0);
        assert.match(r.output, /^verb=recovery-(bundle|check)\nrun=false\n$/);
        assert.ok(
          r.logs.some(
            (l) =>
              l.startsWith("::notice::") &&
              l.includes("custodian ceremony pending (#3662)"),
          ),
        );
        assert.match(r.summary, /custodian ceremony pending \(#3662\)/);
        // Status words and counts only.
        assert.ok(!`${r.logs.join("\n")}${r.summary}`.includes("age1"));
      }
    });
  }

  // After the ceremony a broken file must not turn the schedule green: any recipient
  // line means the ceremony happened, so the box gate decides, and refuses red.
  for (const [name, text] of [
    ["one recipient", FIXTURES.one],
    ["one recipient and a plugin one", FIXTURES.oneAndPlugin],
    ["a duplicate", FIXTURES.duplicate],
    ["a plugin recipient only", FIXTURES.pluginOnly],
    ["a malformed line only", FIXTURES.typo],
  ]) {
    it(`a scheduled run with ${name} runs, so the box gate fails it red`, () => {
      for (const cron of [CRONS.bundle, CRONS.check]) {
        const r = run("schedule", cron, "", text);
        assert.equal(r.rc, 0);
        assert.match(r.output, /^verb=recovery-(bundle|check)\nrun=true\n$/);
        assert.equal(r.summary, "");
      }
    });
  }

  it("a scheduled run with two valid recipients runs as before", () => {
    const r = run("schedule", CRONS.check, "", FIXTURES.two);
    assert.equal(r.rc, 0);
    assert.equal(r.output, "verb=recovery-check\nrun=true\n");
    assert.equal(r.summary, "");
  });

  it("a scheduled run with two recipients beside an invalid line runs, so the box refuses it loudly", () => {
    const r = run("schedule", CRONS.check, "", FIXTURES.twoAndPlugin);
    assert.equal(r.output, "verb=recovery-check\nrun=true\n");
  });

  it("a dispatch still runs, and so fails closed on the box with no recipient", () => {
    for (const verb of RECOVERY_VERBS) {
      const r = run("workflow_dispatch", "", verb, FIXTURES.empty);
      assert.equal(r.rc, 0);
      assert.equal(r.output, `verb=${verb}\nrun=true\n`);
    }
  });

  it("the workflow gates every step that touches the boxes on the gate's output", () => {
    const steps = WORKFLOW.jobs.custody.steps;
    const at = steps.findIndex((s) => s.id === "verb");
    assert.ok(at > 0, "the verb step");
    const touching = steps
      .slice(at + 1)
      .filter(
        (s) =>
          /\bssh -i/.test(s.run ?? "") || "PROD_READ_SSH_KEY" in (s.env ?? {}),
      );
    assert.equal(touching.length, 3);
    for (const step of touching)
      assert.equal(step.if, "steps.verb.outputs.run == 'true'", step.name);
  });
});
