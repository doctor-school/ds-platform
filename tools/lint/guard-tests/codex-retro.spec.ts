import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  PORTABLE_SCHEMA,
  codexRolloutToPortable,
  validatePortableSession,
  writeCodexCorpus,
} from "../../retro/codex.mjs";

const CODEX = fileURLToPath(new URL("../../retro/codex.mjs", import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function fixture(subagent = false): string {
  const rows = [
    {
      timestamp: "2026-08-13T10:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "codex-session-1243",
        cwd: "C:/repo",
        thread_source: subagent ? "subagent" : "cli",
        source: subagent ? { subagent: { thread_spawn: {} } } : {},
        git: { branch: "tooling/1243-codex" },
      },
    },
    {
      timestamp: "2026-08-13T10:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "почему ты опять пропустил проверку?" },
        ],
      },
    },
    {
      timestamp: "2026-08-13T10:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        phase: "final",
        content: [
          { type: "output_text", text: "Я ошибся и пропустил проверку." },
        ],
      },
    },
    {
      timestamp: "2026-08-13T10:00:03.000Z",
      type: "response_item",
      payload: { type: "function_call", name: "spawn_agent", arguments: "{}" },
    },
  ];
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

describe("Codex retro portable adapter", () => {
  it("normalizes a root rollout without pretending it is Claude", () => {
    const portable = codexRolloutToPortable(fixture(), "rollout.jsonl");
    expect(portable.schema).toBe(PORTABLE_SCHEMA);
    expect(portable.harness).toBe("codex");
    expect(portable.kind).toBe("interactive");
    expect(portable.events.map((event) => event.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
  });

  it("classifies a forked Codex subagent as sdk even when history contains a user turn", () => {
    expect(codexRolloutToPortable(fixture(true)).kind).toBe("sdk");
  });

  it("writes the corpus, correction, transcript, and self-catch artifacts", () => {
    const out = mkdtempSync(join(tmpdir(), "codex-retro-"));
    dirs.push(out);
    const summary = writeCodexCorpus(codexRolloutToPortable(fixture()), out);
    expect(summary.harness).toBe("codex");
    expect(summary.totalCorrectionFlagged).toBe(1);
    expect(
      JSON.parse(readFileSync(join(out, "summary.json"), "utf8")).harness,
    ).toBe("codex");
    expect(
      readFileSync(join(out, "transcripts/codex-session-1243.md"), "utf8"),
    ).toContain("harness: codex");
    expect(
      JSON.parse(readFileSync(join(out, "self-catches.json"), "utf8")),
    ).toHaveLength(1);
    expect(
      JSON.parse(
        readFileSync(join(out, "portable/codex-session-1243.json"), "utf8"),
      ).schema,
    ).toBe(PORTABLE_SCHEMA);
  });

  it("accepts an explicit portable input through the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-retro-cli-"));
    dirs.push(dir);
    const input = join(dir, "portable.json");
    const out = join(dir, "out");
    writeFileSync(
      input,
      JSON.stringify(codexRolloutToPortable(fixture())),
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      [CODEX, "--portable-input", input, "--out-dir", out],
      {
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).harness).toBe("codex");
  });

  it("rejects an unlabeled or malformed portable record", () => {
    expect(() =>
      validatePortableSession({ schema: PORTABLE_SCHEMA, harness: "claude" }),
    ).toThrow(/harness codex/);
  });
});
