import { rerunFixture } from "./recording-invariants.fixture.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ciStartup from "./recording-backfill-ci-startup.fixture.json";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readBackfillOutput,
  captureBackfillCommand,
  assertBackfillReceipt,
  backfillTitles,
  assertRerunReceipt,
  type BackfillReceipt,
} from "./recording-backfill.js";

it("requires a real successful first CLI run, exact manifest path/content and mutation-free skipped rerun", () => {
  expect(() => assertRerunReceipt(rerunFixture())).not.toThrow();
  for (const mutate of [
    (r: BackfillReceipt) => {
      delete r.firstRun;
    },
    (r: BackfillReceipt) => {
      r.firstRun!.command.exitCode = 1;
    },
    (r: BackfillReceipt) => {
      r.firstRun!.before.recordings = r.firstRun!.after.recordings;
    },
    (r: BackfillReceipt) => {
      r.command.args[1] = "other.json";
    },
    (r: BackfillReceipt) => {
      r.after.audit.push({ id: "extra" });
    },
    (r: BackfillReceipt) => {
      r.after.recordings.push({ id: "duplicate" });
    },
    (r: BackfillReceipt) => {
      r.command.stdout = r.firstRun!.command.stdout;
    },
  ]) {
    const r = structuredClone(rerunFixture());
    mutate(r);
    expect(() => assertRerunReceipt(r)).toThrow();
  }
});
const json =
  '{"event":"owned","kind":"edited","outcome":"refused","code":"EVENT_NOT_FINISHED"}\n{"dryRun":false,"summary":{"refused":1}}';
it("accepts the explicitly owned 3951 receipt and rejects foreign and production databases", () => {
  const snapshot = {
    events: [{ id: "owned", origin: "legacy", state: "hidden" }],
    recordings: [],
    audit: [],
  };
  const receipt: BackfillReceipt = {
    title: backfillTitles[1],
    actor: "operator",
    database: "ds_dev_3951",
    manifest: [
      { event: "owned", edited: { provider: "rutube", embed_ref: "ref" } },
    ],
    command: {
      entrypoint: "apps/api/scripts/recordings-backfill.ts",
      args: ["--manifest", "manifest.json", "--actor", "operator"],
      exitCode: 0,
      stderr: "",
      stdout:
        '{"event":"owned","kind":"edited","outcome":"refused","code":"INVALID_TRANSITION"}\n{"dryRun":false,"summary":{"attached+published":0,"published":0,"skipped":0,"would-attach":0,"refused":1}}',
    },
    dryRun: false,
    statusMap: { INVALID_TRANSITION: 409 },
    before: snapshot,
    after: structuredClone(snapshot),
  };
  expect(() => assertBackfillReceipt(receipt, receipt.title)).not.toThrow();
  for (const database of ["ds_dev_3941", "ds_dev_1", "ds_prod", "postgres"])
    expect(() =>
      assertBackfillReceipt({ ...receipt, database }, receipt.title),
    ).toThrow();
});
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

describe("014 CI colour boundary", () => {
  it("accepts the actual Linux CI startup bytes and preserves raw diagnostics", () => {
    const result = readBackfillOutput(ciStartup.stdout + "\n" + json);
    expect(result.diagnostics).toEqual(ciStartup.stdout.split("\n"));
    expect(result.entries).toEqual(readBackfillOutput(json).entries);
    expect(result.final).toEqual(readBackfillOutput(json).final);
  });
  it("rejects unknown coloured diagnostics, error levels and coloured JSON", () => {
    const nest = ciStartup.stdout.split("\n")[0]!;
    for (const line of [
      nest.replace("WARN", "ERROR"),
      nest.replace("SessionAuthHook", "UnknownHook"),
      nest.replace("no Fastify instance", "unexpected failure"),
      "\u001b[33munknown diagnostic\u001b[39m",
      '\u001b[33m[delivery-reconcile] {"event":"failed"}\u001b[39m',
      "\u001b[32m" + json + "\u001b[39m",
    ])
      expect(() => readBackfillOutput(line + "\n" + json)).toThrow();
  });
  it("keeps report JSON semantics and rejects invalid literal control bytes", () => {
    const report = readBackfillOutput(json);
    const detail = "\u001b[31mreport payload\u001b[39m";
    const entry = { ...report.entries[0], detail };
    expect(
      readBackfillOutput(
        JSON.stringify(entry) + "\n" + JSON.stringify(report.final),
      ).entries[0],
    ).toEqual(entry);
    expect(() =>
      readBackfillOutput(json.replace("owned", "owned\u001b[31m")),
    ).toThrow();
  });
  it("captures actual CI diagnostic bytes unchanged before parsing a real child output", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "ds-recording-backfill-ci-"),
    );
    try {
      const stdout = ciStartup.stdout + "\n" + json;
      const result = await captureBackfillCommand(directory, () =>
        promisify(execFile)(process.execPath, [
          "-e",
          "process.stdout.write(process.argv[1])",
          stdout,
        ]),
      );
      expect(await readFile(join(directory, "stdout.jsonl"), "utf8")).toBe(
        stdout,
      );
      expect(result.stdout).toBe(stdout);
      expect(readBackfillOutput(result.stdout).diagnostics).toEqual(
        ciStartup.stdout.split("\n"),
      );
    } finally {
      expect(dirname(directory)).toBe(tmpdir());
      await rm(directory, { recursive: true, force: true });
    }
  });
});
