import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readBackfillOutput,
  captureBackfillCommand,
} from "./recording-backfill.js";
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

it("preserves a rejected CLI process's stdout, stderr and exit status without accepting its failure", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "ds-recording-backfill-test-"),
  );
  try {
    await expect(
      captureBackfillCommand(directory, () =>
        promisify(execFile)(process.execPath, [
          "-e",
          "process.stdout.write('partial report');process.stderr.write('boot refused');process.exitCode=7",
        ]),
      ),
    ).rejects.toMatchObject({ code: 7 });
    expect(await readFile(join(directory, "stdout.jsonl"), "utf8")).toBe(
      "partial report",
    );
    expect(await readFile(join(directory, "stderr.log"), "utf8")).toBe(
      "boot refused",
    );
    expect(
      JSON.parse(await readFile(join(directory, "process.json"), "utf8")),
    ).toMatchObject({ exitCode: 7, status: "failed" });
  } finally {
    expect(dirname(directory)).toBe(tmpdir());
    await rm(directory, { recursive: true, force: true });
  }
});
