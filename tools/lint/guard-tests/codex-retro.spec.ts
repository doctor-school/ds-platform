import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  PORTABLE_SCHEMA,
  codexRolloutToPortable,
  isCodexInjectedInstructionEnvelope,
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

function injectedEnvelopeFixture(): string {
  const envelope = `# AGENTS.md instructions for C:\\repo

<INSTRUCTIONS>
Never claim a check passed when it did not.
</INSTRUCTIONS>
<environment_context>
  <cwd>C:\\repo</cwd>
  <shell>powershell</shell>
</environment_context>`;
  const rows = fixture()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  rows.splice(1, 0, {
    timestamp: "2026-08-13T10:00:00.500Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: envelope }],
    },
  });
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

  it("excludes Codex-injected instruction envelopes while preserving owner turns", () => {
    const portable = codexRolloutToPortable(injectedEnvelopeFixture());
    const users = portable.events.filter((event) => event.role === "user");

    expect(
      isCodexInjectedInstructionEnvelope(
        "# AGENTS.md instructions for C:\\repo\n\n<INSTRUCTIONS>x</INSTRUCTIONS>",
      ),
    ).toBe(true);
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toMatch(/почему/u);

    const out = mkdtempSync(join(tmpdir(), "codex-retro-envelope-"));
    dirs.push(out);
    const summary = writeCodexCorpus(portable, out);
    expect(summary.totalHumanMsgs).toBe(1);
    expect(summary.totalCorrectionFlagged).toBe(1);
    expect(
      readFileSync(join(out, "transcripts/codex-session-1243.md"), "utf8"),
    ).not.toContain("AGENTS.md instructions");
  });

  it("does not classify an injected-envelope-only rollout as interactive", () => {
    const rows = injectedEnvelopeFixture()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter(
        (row) =>
          row.payload?.role !== "user" ||
          row.payload.content[0].text.includes("AGENTS.md instructions"),
      );

    expect(
      codexRolloutToPortable(
        `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      ).kind,
    ).toBe("other");
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

  it("rejects traversal from portable CLI input without creating output", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-retro-cli-traversal-"));
    dirs.push(root);
    const input = join(root, "portable.json");
    const out = join(root, "out");
    writeFileSync(
      input,
      JSON.stringify({
        ...codexRolloutToPortable(fixture()),
        session: "../../escaped",
      }),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [CODEX, "--portable-input", input, "--out-dir", out],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("session id");
    expect(existsSync(out)).toBe(false);
    expect(existsSync(join(root, "escaped.json"))).toBe(false);
    expect(existsSync(join(root, "escaped.md"))).toBe(false);
  });

  it("rejects an unlabeled or malformed portable record", () => {
    expect(() =>
      validatePortableSession({ schema: PORTABLE_SCHEMA, harness: "claude" }),
    ).toThrow(/harness codex/);
  });

  it.each([
    "../../escaped",
    "..\\..\\escaped",
    "folder/session",
    "folder\\session",
    "C:\\escaped",
    "/absolute",
  ])("rejects unsafe portable session id %j before writing", (session) => {
    const root = mkdtempSync(join(tmpdir(), "codex-retro-traversal-"));
    dirs.push(root);
    const out = join(root, "out");
    const portable = { ...codexRolloutToPortable(fixture()), session };

    expect(() => writeCodexCorpus(portable, out)).toThrow(/session id/);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(join(root, "escaped.json"))).toBe(false);
    expect(existsSync(join(root, "escaped.md"))).toBe(false);
  });

  it("accepts real Codex UUID session ids", () => {
    const portable = {
      ...codexRolloutToPortable(fixture()),
      session: "019ffb38-10d3-75f1-b1b1-05eacd62059c",
    };
    expect(validatePortableSession(portable).session).toBe(portable.session);
  });
});
