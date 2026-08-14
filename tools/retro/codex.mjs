#!/usr/bin/env node
/**
 * Codex rollout adapter for the repository retro pipeline.
 *
 * Unlike the Claude extractor, this entry reads Codex's rollout envelope and
 * normalizes it to an explicitly labelled, versioned portable record. It then
 * emits the same compact corpus artifacts consumed by run-session-retro. The
 * raw rollout is never rewritten or presented as a Claude transcript.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORRECTION_RE, isHandoff } from "./extract.mjs";
import { SELF_CATCH } from "./transcripts.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const PORTABLE_SCHEMA = "ds-platform-retro/v1";
const SAFE_SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// Codex journals project instructions as a role=user response_item even though
// the owner did not type it. Keep this deliberately narrower than a generic
// markup/noise filter: the harness envelope has both the exact heading and one
// of its machine-owned context containers.
export function isCodexInjectedInstructionEnvelope(text) {
  if (typeof text !== "string") return false;
  const value = text.trimStart();
  return (
    /^# AGENTS\.md instructions for [^\r\n]+(?:\r?\n|$)/.test(value) &&
    (value.includes("<INSTRUCTIONS>") ||
      value.includes("<environment_context>"))
  );
}

function textBlocks(content, allowed) {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block) =>
        block && allowed.has(block.type) && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function toolSummary(input) {
  const raw = typeof input === "string" ? input : JSON.stringify(input ?? {});
  const compact = raw.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}…` : compact;
}

export function codexRolloutToPortable(jsonl, sourcePath = null) {
  const records = [];
  for (const line of String(jsonl).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A partial final line must not erase the rest of an otherwise valid run.
    }
  }
  const meta =
    records.find((entry) => entry?.type === "session_meta")?.payload ?? {};
  const isSubagent =
    meta.thread_source === "subagent" || Boolean(meta.source?.subagent);
  const events = [];

  for (const entry of records) {
    const payload = entry?.payload;
    if (entry?.type !== "response_item" || !payload) continue;
    if (payload.type === "message" && payload.role === "user") {
      const text = textBlocks(payload.content, new Set(["input_text", "text"]));
      const imageOnly =
        !text &&
        Array.isArray(payload.content) &&
        payload.content.some(
          (block) => block && /image/i.test(String(block.type)),
        );
      if ((text || imageOnly) && !isCodexInjectedInstructionEnvelope(text)) {
        events.push({
          role: "user",
          ts: entry.timestamp ?? null,
          text,
          imageOnly,
        });
      }
    } else if (payload.type === "message" && payload.role === "assistant") {
      const text = textBlocks(
        payload.content,
        new Set(["output_text", "text"]),
      );
      if (text) {
        events.push({
          role: "assistant",
          ts: entry.timestamp ?? null,
          text,
          phase: payload.phase ?? null,
        });
      }
    } else if (
      payload.type === "function_call" ||
      payload.type === "custom_tool_call"
    ) {
      events.push({
        role: "tool",
        ts: entry.timestamp ?? null,
        name: payload.name ?? payload.type,
        input: payload.arguments ?? payload.input ?? null,
      });
    }
  }

  const timestamps = records.map((entry) => entry?.timestamp).filter(Boolean);
  return {
    schema: PORTABLE_SCHEMA,
    harness: "codex",
    session: meta.id ?? meta.session_id ?? null,
    sourcePath,
    kind: isSubagent
      ? "sdk"
      : events.some((event) => event.role === "user")
        ? "interactive"
        : "other",
    cwd: meta.cwd ?? null,
    branch: meta.git?.branch ?? null,
    firstTs: timestamps[0] ?? meta.timestamp ?? null,
    lastTs: timestamps[timestamps.length - 1] ?? meta.timestamp ?? null,
    events,
  };
}

export function validatePortableSession(value) {
  if (!value || value.schema !== PORTABLE_SCHEMA || value.harness !== "codex") {
    throw new Error(
      `portable input must use schema ${PORTABLE_SCHEMA} and harness codex`,
    );
  }
  if (
    typeof value.session !== "string" ||
    !value.session ||
    !Array.isArray(value.events)
  ) {
    throw new Error("portable input requires a session id and events array");
  }
  if (!SAFE_SESSION_ID_RE.test(value.session)) {
    throw new Error(
      "portable input session id must be a safe filename component",
    );
  }
  return value;
}

function walkJsonl(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const itemPath = path.join(dir, item.name);
    if (item.isDirectory()) walkJsonl(itemPath, out);
    else if (item.isFile() && item.name.endsWith(".jsonl")) out.push(itemPath);
  }
  return out;
}

export function findCodexRollout(sessionsRoot, sessionId) {
  const suffix = `${sessionId}.jsonl`.toLowerCase();
  const matches = walkJsonl(sessionsRoot).filter((file) =>
    file.toLowerCase().endsWith(suffix),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    return matches.sort(
      (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs,
    )[0];
  }
  return null;
}

export function writeCodexCorpus(portableInput, outDir) {
  const validated = validatePortableSession(portableInput);
  const events = validated.events.filter(
    (event) =>
      event.role !== "user" || !isCodexInjectedInstructionEnvelope(event.text),
  );
  const portable = {
    ...validated,
    kind:
      validated.kind === "interactive" &&
      !events.some((event) => event.role === "user")
        ? "other"
        : validated.kind,
    events,
  };
  const id = portable.session;
  const interactive = portable.kind === "interactive";
  const humanMsgs = interactive
    ? portable.events
        .filter((event) => event.role === "user")
        .map((event) => {
          const text =
            event.text ||
            "[image-only turn — likely an annotated-screenshot correction]";
          const handoff = isHandoff(text);
          return {
            ts: event.ts ?? null,
            text,
            handoff,
            imageOnly: Boolean(event.imageOnly),
            source: "typed",
            correction:
              !handoff &&
              (Boolean(event.imageOnly) || CORRECTION_RE.test(text)),
          };
        })
    : [];
  const corrections = humanMsgs.filter((message) => message.correction);
  const branches = portable.branch ? [portable.branch] : [];
  const bytes = Buffer.byteLength(JSON.stringify(portable));

  fs.mkdirSync(path.join(outDir, "portable"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "transcripts"), { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "portable", `${id}.json`),
    JSON.stringify(portable, null, 2),
  );

  if (interactive) {
    fs.writeFileSync(
      path.join(outDir, "sessions", `${id}.json`),
      JSON.stringify(
        {
          id,
          harness: "codex",
          kind: portable.kind,
          firstTs: portable.firstTs,
          lastTs: portable.lastTs,
          branches,
          bytes,
          msgCount: humanMsgs.length,
          corrections: corrections.length,
          messages: humanMsgs,
        },
        null,
        2,
      ),
    );
  }

  const transcriptLines = [
    `# session ${id}`,
    "harness: codex",
    `range: ${portable.firstTs} → ${portable.lastTs}`,
    `branches: ${branches.join(", ")}`,
    "",
  ];
  const selfCatches = [];
  if (interactive) {
    for (const event of portable.events) {
      if (event.role === "user") {
        transcriptLines.push(`[U] ${event.text || "[image-only turn]"}`);
      } else if (event.role === "assistant") {
        transcriptLines.push(`[A] ${event.text}`);
        if (SELF_CATCH.test(event.text)) {
          selfCatches.push({
            id,
            ts: event.ts ?? null,
            text: event.text.slice(0, 600),
          });
        }
      } else if (event.role === "tool") {
        transcriptLines.push(
          `  [T] ${event.name}: ${toolSummary(event.input)}`,
        );
      }
    }
    fs.writeFileSync(
      path.join(outDir, "transcripts", `${id}.md`),
      `${transcriptLines.join("\n")}\n`,
    );
  }

  const index = [
    {
      id,
      harness: "codex",
      kind: portable.kind,
      firstTs: portable.firstTs,
      lastTs: portable.lastTs,
      bytes,
      branches,
      version: null,
      msgCount: humanMsgs.length,
      corrections: corrections.length,
    },
  ];
  const summary = {
    harness: "codex",
    source: portable.sourcePath ?? "portable-input",
    mode: "single",
    totalFiles: 1,
    interactiveSessions: interactive ? 1 : 0,
    sdkSessions: portable.kind === "sdk" ? 1 : 0,
    otherSessions: portable.kind === "other" ? 1 : 0,
    totalHumanMsgs: humanMsgs.length,
    totalCorrectionFlagged: corrections.length,
    dateRange: [portable.firstTs, portable.lastTs],
  };
  const correctionCorpus = corrections.length
    ? [
        {
          id,
          firstTs: portable.firstTs,
          branches,
          messages: corrections.map(({ ts, text }) => ({ ts, text })),
        },
      ]
    : [];
  fs.writeFileSync(
    path.join(outDir, "index.json"),
    JSON.stringify(index, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, "corrections.json"),
    JSON.stringify(correctionCorpus, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, "self-catches.json"),
    JSON.stringify(selfCatches, null, 2),
  );
  return summary;
}

function parseArgs(argv) {
  const result = {
    session: null,
    rollout: null,
    portableInput: null,
    outDir: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--help" || value === "-h") result.help = true;
    else if (value === "--session") result.session = argv[++i];
    else if (value === "--rollout") result.rollout = argv[++i];
    else if (value === "--portable-input") result.portableInput = argv[++i];
    else if (value === "--out-dir") result.outDir = argv[++i];
  }
  return result;
}

const HELP = `tools/retro/codex.mjs — build a single-session retro corpus from Codex

Usage:
  node tools/retro/codex.mjs --session <codex-session-id> [--out-dir <dir>]
  node tools/retro/codex.mjs --rollout <rollout.jsonl> [--out-dir <dir>]
  node tools/retro/codex.mjs --portable-input <portable.json> [--out-dir <dir>]

The raw Codex rollout is normalized to ${PORTABLE_SCHEMA}; it is never treated as a Claude transcript.`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const outDir = path.resolve(
    args.outDir ?? path.join(REPO_ROOT, ".audit-tmp"),
  );
  let portable;
  if (args.portableInput) {
    portable = validatePortableSession(
      JSON.parse(fs.readFileSync(path.resolve(args.portableInput), "utf8")),
    );
  } else {
    const home = process.env.USERPROFILE ?? process.env.HOME;
    const rollout = args.rollout
      ? path.resolve(args.rollout)
      : args.session && home
        ? findCodexRollout(
            path.resolve(home, ".codex", "sessions"),
            args.session,
          )
        : null;
    if (!rollout)
      throw new Error(
        "pass --session, --rollout, or --portable-input (session was not found)",
      );
    portable = codexRolloutToPortable(
      fs.readFileSync(rollout, "utf8"),
      rollout,
    );
  }
  const summary = writeCodexCorpus(portable, outDir);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `[retro:codex] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
