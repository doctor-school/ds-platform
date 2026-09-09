import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import { runDiagnostic, sanitizeCase } from "./otp-delivery-diagnostic.mjs";

test("#2100 executes twenty fresh cases sequentially and retains successes", async () => {
  const calls = [];
  const result = await runDiagnostic(async (index) => {
    calls.push(index);
    await Promise.resolve();
    assert.equal(calls.length, index);
    return {
      exitCode: 0,
      passed: true,
      cleanup: true,
      provider: [],
      attempts: [],
    };
  });
  assert.deepEqual(
    calls,
    Array.from({ length: 20 }, (_, i) => i + 1),
  );
  assert.equal(result.success, true);
  assert.equal(result.cases.length, 20);
});

test("#2100 stops at the first failed or skipped case and retains its evidence", async () => {
  for (const failure of [
    { exitCode: 1 },
    { passed: false },
    { cleanup: false },
  ]) {
    let calls = 0;
    const result = await runDiagnostic(async () => ({
      exitCode: 0,
      passed: true,
      cleanup: true,
      ...(++calls === 3 ? failure : {}),
    }));
    assert.equal(calls, 3);
    assert.equal(result.success, false);
    assert.equal(result.cases.length, 3);
  }
});

test("#2100 evidence excludes unknown fields and invalid counter values", () => {
  const result = sanitizeCase({
    passed: true,
    cleanup: true,
    email: "private@example.test",
    provider: [
      { route: "sessions", status: 400, code: 9, token: "secret" },
      { route: "private", status: "secret", userMatches: -1 },
    ],
    attempts: [
      {
        provider: [{ route: "email-factor", status: 200 }],
        mailbox: [
          {
            messages: 1,
            fresh: 0,
            subjectMatches: 1,
            eligible: 0,
            codeExtracted: false,
            subject: "12345678 secret",
          },
        ],
        code: "12345678",
      },
    ],
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret|private|12345678|token|email"/,
  );
  assert.equal(result.attempts[0].mailbox[0].subjectMatches, 1);
  assert.equal(result.provider[0].code, 9);
  assert.deepEqual(result.provider[1], {});
});

test("#2100 a runner exception is retained as a safe failed case", async () => {
  const saved = [];
  const result = await runDiagnostic(
    async () => {
      throw new Error("private@example.test token=secret");
    },
    (value) => saved.push(JSON.stringify(value)),
  );
  assert.equal(result.success, false);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].exitCode, 1);
  assert.doesNotMatch(saved.join("\n"), /private|secret/);
});

test("#2100 diagnostic is explicit opt-in and artifacts survive failure", () => {
  const workflow = parse(
    readFileSync(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    workflow.on.workflow_dispatch.inputs.otp_diagnostic.default,
    false,
  );
  const steps = workflow.jobs["api-e2e"].steps;
  const diagnostic = steps.find(
    (s) => s.name === "Run opt-in OTP delivery diagnostic",
  );
  assert.equal(
    diagnostic.if,
    "github.event_name == 'workflow_dispatch' && inputs.otp_diagnostic",
  );
  assert.equal(
    diagnostic.run,
    "node tools/scripts/otp-delivery-diagnostic.mjs",
  );
  const upload = steps.find((s) => s.with?.name === "otp-delivery-diagnostic");
  assert.equal(
    upload.if,
    "always() && github.event_name == 'workflow_dispatch' && inputs.otp_diagnostic",
  );
  assert.equal(upload.with.path, "otp-delivery-diagnostic.json");
  assert.equal(upload.with["retention-days"], 7);
});
