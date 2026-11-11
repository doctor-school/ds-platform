import { describe, expect, it } from "vitest";
import { readBackfillOutput } from "./recording-backfill.js";
const json =
  '{"event":"owned","kind":"edited","outcome":"refused","code":"EVENT_NOT_FINISHED"}\n{"dryRun":false,"summary":{"refused":1}}';
describe("014 backfill CLI output", () => {
  it("preserves only the observed HTTP-less startup diagnostics beside strict JSON report lines", () => {
    const startup =
      '[Nest] 15596  - 11/11/2026, 10:56:21 AM    WARN [SessionAuthHook] no Fastify instance — session auth hook not registered\n[delivery-reconcile] {"event":"delivery_mail_readiness","channels":[],"operational_reserve":[]}\n[Nest] 15596  - 11/11/2026, 10:56:21 AM    WARN [AdminSessionAuthHook] no Fastify instance — admin auth hook not registered';
    const result = readBackfillOutput(startup + "\n" + json);
    expect(result.entries).toHaveLength(1);
  });
  it("rejects unexpected diagnostics, errors and missing final JSON summary", () => {
    for (const output of [
      "unexpected\n" + json,
      "[Nest] 1 ERROR startup failed\n" + json,
      '[delivery-reconcile] {"event":"failed"}\n' + json,
      '{"event":"owned"}',
    ])
      expect(() => readBackfillOutput(output)).toThrow();
  });
});
