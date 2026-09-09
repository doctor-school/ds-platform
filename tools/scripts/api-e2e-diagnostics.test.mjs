import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import { summarizeProviderLogs } from "./api-e2e-diagnostics.mjs";

test("#2085 provider evidence emits only fixed counters, never raw log data", () => {
  const result = summarizeProviderLogs(
    'level=error msg="smtp connection refused token=secret"\nnotification failed OTP=12345678 email=private@example.test\nprojection deadline exceeded',
  );
  assert.deepEqual(result, {
    lines: 3,
    error: 1,
    smtp: 1,
    notification: 1,
    projection: 1,
    connectionRefused: 1,
    deadlineExceeded: 1,
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret|12345678|private|example/,
  );
});

test("#2085 API failure diagnostics and sanitized artifact follow the test tier", () => {
  const steps = parse(
    readFileSync(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  ).jobs["api-e2e"].steps;
  const tier = steps.findIndex((s) => s.name === "Run the api test tier");
  const collect = steps.findIndex(
    (s) => s.run === "node tools/scripts/api-e2e-diagnostics.mjs",
  );
  const upload = steps.findIndex((s) => s.with?.name === "api-e2e-diagnostics");
  assert.ok(collect > tier && upload > collect);
  assert.equal(steps[collect].if, "failure()");
  assert.equal(steps[upload].if, "failure()");
  assert.equal(steps[upload].with.path, "api-e2e-diagnostics.json");
  assert.equal(steps[upload].with["retention-days"], 7);
});
