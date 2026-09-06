import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeJsonl,
  priceFor,
  parseArgs,
} from "../../retro/token-ledger.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const jsonl = (rows: unknown[]) =>
  rows.map((row) => JSON.stringify(row)).join("\n");
const usage = (input = 100, cached = 60, output = 20) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: 0,
  output_tokens: output,
  reasoning_output_tokens: 8,
  total_tokens: input + output,
});
const count = (
  total = usage(),
  last = usage(),
  timestamp = "2026-09-06T10:00:01Z",
) => ({
  type: "event_msg",
  timestamp,
  payload: {
    type: "token_count",
    info: {
      total_token_usage: total,
      last_token_usage: last,
      model_context_window: 200000,
    },
  },
});
const meta = (id = "lead", parent?: string) => ({
  type: "session_meta",
  timestamp: "2026-09-06T10:00:00Z",
  payload: {
    id,
    timestamp: "2026-09-06T10:00:00Z",
    source: parent
      ? { subagent: { thread_spawn: { parent_thread_id: parent } } }
      : "cli",
  },
});

describe("retrospective token ledger", () => {
  it("EARS-1: preserves Claude streamed-message deduplication and disjoint cache accounting", () => {
    const row = (output: number) => ({
      type: "assistant",
      timestamp: "2026-09-06T10:00:00Z",
      message: {
        id: "a",
        model: "claude-sonnet",
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
          output_tokens: output,
        },
      },
    });
    const result = analyzeJsonl(jsonl([row(1), row(5)]));
    expect(result.turns).toBe(1);
    expect(result.peak).toBe(60);
    expect(result.total).toEqual({
      input: 10,
      cacheWrite: 20,
      cacheRead: 30,
      output: 5,
    });
    expect(result.cost).toBeCloseTo(0.000189);
  });
  it("EARS-2: reads cumulative Codex usage once; cached input and reasoning are subsets", () => {
    const result = analyzeJsonl(
      jsonl([
        meta(),
        count(),
        count(),
        count(usage(300, 160, 50), usage(200, 100, 30)),
      ]),
      { harness: "codex" },
    );
    expect(result.total).toMatchObject({
      input: 300,
      cacheRead: 160,
      output: 50,
      reasoningOutput: 8,
      totalTokens: 350,
    });
    expect(result.peak).toBe(200);
    expect(result.contextWindow).toBe(200000);
    expect(result.turns).toBe(2);
    expect(result.cost).toBeNull();
  });
  it("EARS-3: missing counters/prices are UNKNOWN, including partial telemetry", () => {
    expect(priceFor("gpt-unpriced")).toBeNull();
    expect(priceFor(undefined)).toBeNull();
    for (const harness of ["claude", "codex"]) {
      const result = analyzeJsonl("", { harness });
      expect(result.total.input).toBeNull();
      expect(result.peak).toBeNull();
      expect(result.cost).toBeNull();
    }
    const result = analyzeJsonl(
      jsonl([
        meta(),
        count(
          { input_tokens: 0 } as ReturnType<typeof usage>,
          {} as ReturnType<typeof usage>,
        ),
      ]),
      { harness: "codex" },
    );
    expect(result.total.input).toBe(0);
    expect(result.total.output).toBeNull();
  });
  it("EARS-4: subtracts inherited cumulative history and excludes its context peaks", () => {
    const result = analyzeJsonl(
      jsonl([
        meta("child", "lead"),
        count(usage(1000), usage(1000), "2026-09-06T09:00:00Z"),
        count(usage(1100, 120, 40)),
      ]),
      { harness: "codex" },
    );
    expect(result.total.input).toBe(100);
    expect(result.total.output).toBe(20);
    expect(result.peak).toBe(100);
    expect(result.warnings.join(" ")).toMatch(/inherited/i);
  });
  it("EARS-5: discovers only descendants through metadata with CODEX_HOME and explicit rollout", () => {
    const dir = mkdtempSync(join(tmpdir(), "retro-token-"));
    dirs.push(dir);
    const logs = join(dir, "sessions", "2026", "09");
    mkdirSync(logs, { recursive: true });
    const rootFile = join(logs, "rollout-lead.jsonl");
    writeFileSync(rootFile, jsonl([meta(), count()]));
    writeFileSync(
      join(logs, "rollout-child.jsonl"),
      jsonl([meta("child", "lead"), count()]),
    );
    writeFileSync(
      join(logs, "rollout-unrelated.jsonl"),
      jsonl([meta("unrelated", "elsewhere"), count()]),
    );
    const cli = fileURLToPath(
      new URL("../../retro/token-ledger.mjs", import.meta.url),
    );
    for (const args of [
      ["--harness", "codex", "lead"],
      ["--rollout", rootFile],
    ]) {
      const run = spawnSync(process.execPath, [cli, ...args], {
        encoding: "utf8",
        env: { ...process.env, CODEX_HOME: dir },
      });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain("child");
      expect(run.stdout).not.toContain("unrelated");
      expect(run.stdout).toContain("UNKNOWN");
    }
  });
  it("EARS-6: rejects invalid or incomplete explicit selectors", () => {
    expect(() => parseArgs(["--harness", "other"])).toThrow();
    expect(() => parseArgs(["--rollout"])).toThrow();
    expect(() =>
      parseArgs(["--harness", "claude", "--rollout", "x"]),
    ).toThrow();
  });
  it("EARS-11: reports cumulative resets and absent child attribution explicitly", () => {
    const reset = analyzeJsonl(
      jsonl([meta(), count(usage(1000)), count(usage(100))]),
      { harness: "codex" },
    );
    expect(reset.total.input).toBeNull();
    expect(reset.warnings.join(" ")).toMatch(/reset/);
    const child = analyzeJsonl(jsonl([meta("child", "lead"), count()]), {
      harness: "codex",
    });
    expect(child.warnings.join(" ")).toMatch(/UNKNOWN child usage attribution/);
  });
  it("EARS-12: preserves unknown fields through partial Claude totals and price estimates", () => {
    const result = analyzeJsonl(
      jsonl([
        {
          type: "assistant",
          message: {
            id: "partial",
            model: "claude-sonnet",
            usage: { input_tokens: 0, output_tokens: 5 },
          },
        },
      ]),
    );
    expect(result.total.input).toBe(0);
    expect(result.total.output).toBe(5);
    expect(result.total.cacheRead).toBeNull();
    expect(result.peak).toBeNull();
    expect(result.cost).toBeNull();
  });
});
