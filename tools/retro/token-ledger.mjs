#!/usr/bin/env node
/**
 * tools/retro/token-ledger.mjs — per-session TOKEN LEDGER (#1374).
 *
 * Answers the question the 2026-08-10..18 owner retro had to answer by hand:
 * where did a session's tokens (and dollars) actually go — the lead, or the
 * subagents it dispatched? For one session it prints the lead line, then one
 * row per subagent sorted by estimated cost, then a FLAG list of the rows that
 * breach the #1374 budget (subagent peak > 200K, lead peak > 300K).
 *
 * Accounting rules (both learned the hard way on the real corpus):
 *  - A STREAMED assistant message repeats its `usage` block on every content
 *    block line for the SAME `message.id`, and `output_tokens` GROWS across
 *    those lines. Summing lines therefore multiplies a turn's cost by its block
 *    count. We dedupe by `message.id` and keep the LAST usage seen for that id.
 *  - Context size of a turn = `input + cache_read + cache_creation` — the same
 *    definition the context-budget hooks use.
 *
 * Costs are ESTIMATES from a constant price table (see PRICE), not billing.
 *
 * Usage:
 *   node tools/retro/token-ledger.mjs <session-id> [<session-id> …]
 *   node tools/retro/token-ledger.mjs --since YYYY-MM-DD
 *   node tools/retro/token-ledger.mjs --log-dir <dir> --since YYYY-MM-DD
 *   pnpm retro:tokens <session-id>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slugifyRepoRoot } from "./extract.mjs";
import {
  analyzeCodexJsonl,
  codexSessionsRoot,
  parentThread,
  readRecords,
  rolloutMeta,
  walkJsonl,
  number,
} from "./codex-rollout.mjs";

/** Approximate USD per Mtok: [input, cache_write, cache_read, output].
 * Historical #1374 estimates, retained for Claude compatibility; not current
 * billing rates. Unrecognized model families have no price. */
export const PRICE = {
  opus: [15, 18.75, 1.5, 75],
  fable: [15, 18.75, 1.5, 75],
  sonnet: [3, 3.75, 0.3, 15],
  haiku: [1, 1.25, 0.1, 5],
};

/** Budget flags (mirror the #1374 hook thresholds; lead is advisory). */
export const SUBAGENT_PEAK_FLAG = 200_000;
export const LEAD_PEAK_FLAG = 300_000;

export function priceFor(model) {
  const m = String(model || "").toLowerCase();
  for (const key of Object.keys(PRICE)) if (m.includes(key)) return PRICE[key];
  return null;
}

/** Analyze one `*.jsonl` transcript (lead session or subagent). */
export function analyzeJsonl(jsonl, { harness = "claude" } = {}) {
  if (harness === "codex") return analyzeCodexJsonl(jsonl);
  if (harness !== "claude") throw new Error(`Unknown harness: ${harness}`);
  const usageById = new Map();
  const order = [];
  let firstTs = null;
  let lastTs = null;
  let userTurns = 0;
  let compacts = 0;
  for (const raw of String(jsonl).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = entry?.timestamp;
    if (ts) {
      firstTs = firstTs || ts;
      lastTs = ts;
    }
    if (entry?.isCompactSummary || entry?.type === "summary") compacts++;
    if (entry?.type === "user" && !entry?.isSidechain) {
      const c = entry?.message?.content;
      if (
        typeof c === "string" ||
        (Array.isArray(c) && c[0]?.type === "text")
      ) {
        userTurns++;
      }
    }
    if (entry?.type !== "assistant") continue;
    const message = entry.message || {};
    const usage = message.usage;
    if (!usage) continue;
    // Dedupe streamed repeats: one row per message id, LAST usage wins.
    const id = message.id || entry.uuid || Symbol();
    if (!usageById.has(id)) order.push(id);
    usageById.set(id, { usage, model: message.model, ts });
  }

  const total = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const models = new Map();
  let peak = 0;
  let peakTs = null;
  let cost = 0;
  for (const id of order) {
    const { usage, model } = usageById.get(id);
    const input = number(usage.input_tokens);
    const cacheWrite = number(usage.cache_creation_input_tokens);
    const cacheRead = number(usage.cache_read_input_tokens);
    const output = number(usage.output_tokens);
    for (const [key, value] of Object.entries({
      input,
      cacheWrite,
      cacheRead,
      output,
    })) {
      total[key] =
        value === null || total[key] === null ? null : total[key] + value;
    }
    const ctx = [input, cacheWrite, cacheRead].includes(null)
      ? null
      : input + cacheWrite + cacheRead;
    if (ctx === null) peak = null;
    else if (peak !== null && ctx > peak) {
      peak = ctx;
      peakTs = usageById.get(id).ts;
    }
    const price = priceFor(model);
    if (!price || [input, cacheWrite, cacheRead, output].includes(null))
      cost = null;
    else if (cost !== null) {
      const [pi, pw, pr, po] = price;
      cost +=
        (input * pi + cacheWrite * pw + cacheRead * pr + output * po) / 1e6;
    }
    models.set(model, (models.get(model) || 0) + 1);
  }

  let durationH = null;
  if (firstTs && lastTs) {
    const a = Date.parse(firstTs);
    const b = Date.parse(lastTs);
    if (Number.isFinite(a) && Number.isFinite(b)) durationH = (b - a) / 3.6e6;
  }
  if (!order.length) {
    for (const key of Object.keys(total)) total[key] = null;
    peak = null;
    cost = null;
  }
  return {
    turns: order.length,
    userTurns,
    compacts,
    total,
    peak,
    peakTs,
    cost,
    durationH,
    firstTs,
    lastTs,
    models: [...models.keys()].filter(Boolean),
  };
}

export const fmtK = (n) =>
  n === null ? "UNKNOWN" : `${Math.round(n / 1000)}K`;
const fmt$ = (n) => (n === null ? "UNKNOWN" : `$${n.toFixed(n < 10 ? 1 : 0)}`);
const pad = (s, n) => String(s).padStart(n);

/** Default log dir: ~/.claude/projects/<repo-slug>/ (same convention as
 * extract.mjs). A worktree checkout slugs to `<base>--claude-worktrees-<N>`,
 * so the worktree suffix is stripped — sessions live under the base slug. */
export function defaultLogDir(repoRoot = process.cwd(), env = process.env) {
  const home = env.HOME || env.USERPROFILE;
  if (!home) return null;
  const slug = slugifyRepoRoot(repoRoot).replace(
    /-+\.?claude-worktrees-.*$/,
    "",
  );
  return path.resolve(home, ".claude", "projects", slug);
}

export function parseArgs(argv) {
  const out = {
    sessions: [],
    since: null,
    logDir: null,
    help: false,
    harness: null,
    rollout: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (["--harness", "--rollout", "--since", "--log-dir"].includes(a)) {
      const value = argv[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${a}`);
      out[
        {
          "--harness": "harness",
          "--rollout": "rollout",
          "--since": "since",
          "--log-dir": "logDir",
        }[a]
      ] = value;
    } else if (a.startsWith("--since=")) out.since = a.slice("--since=".length);
    else if (a.startsWith("--log-dir="))
      out.logDir = a.slice("--log-dir=".length);
    else if (a.startsWith("--harness=")) out.harness = a.slice(10);
    else if (a.startsWith("--rollout=")) out.rollout = a.slice(10);
    else if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
    else out.sessions.push(a);
  }
  if (out.harness && !["claude", "codex"].includes(out.harness))
    throw new Error("--harness must be claude or codex");
  if (
    out.rollout &&
    (out.harness === "claude" || out.sessions.length || out.since)
  )
    throw new Error(
      "--rollout selects one Codex file; do not combine with Claude, sessions or --since",
    );
  out.harness ??= out.rollout ? "codex" : "claude";
  return out;
}

const USAGE = `tools/retro/token-ledger.mjs — per-session token/cost ledger (#1374)

  node tools/retro/token-ledger.mjs <session-id> [<session-id> …]
  node tools/retro/token-ledger.mjs --since YYYY-MM-DD
  node tools/retro/token-ledger.mjs --log-dir <dir> --since YYYY-MM-DD

  --since <date>   every session log modified on/after that date
  --log-dir <dir>  session-log dir (default: ~/.claude/projects/<repo-slug>/)
  --help, -h       this text
  --harness codex  Codex sessions (CODEX_HOME/sessions or ~/.codex/sessions)
  --rollout <file> explicit Codex rollout; --log-dir sets descendant search root
`;

function sessionsSince(logDir, since) {
  const cut = Date.parse(`${since}T00:00:00Z`);
  if (!Number.isFinite(cut)) return [];
  return fs
    .readdirSync(logDir)
    .filter((f) => f.endsWith(".jsonl"))
    .filter((f) => fs.statSync(path.join(logDir, f)).mtimeMs >= cut)
    .map((f) => f.slice(0, -".jsonl".length))
    .sort();
}

function reportSession(logDir, sessionId, out = process.stdout) {
  const file = path.join(logDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) {
    out.write(`\n=== SESSION ${sessionId}: log not found under ${logDir}\n`);
    return;
  }
  const lead = analyzeJsonl(fs.readFileSync(file, "utf8"));
  const t = lead.total;
  const flags = [];
  out.write(
    `\n=== SESSION ${sessionId}  ${lead.firstTs} → ${lead.lastTs}` +
      `  (${lead.durationH === null ? "?" : lead.durationH.toFixed(1)}h)\n`,
  );
  out.write(
    `  lead: turns=${lead.turns} user=${lead.userTurns} compacts=${lead.compacts}` +
      ` peak_ctx=${fmtK(lead.peak)} out=${fmtK(t.output)}` +
      ` cache_write=${fmtK(t.cacheWrite)} cache_read=${fmtK(t.cacheRead)}` +
      ` est=${fmt$(lead.cost)} models=${lead.models.join(",") || "?"}\n`,
  );
  if (lead.peak > LEAD_PEAK_FLAG) {
    flags.push(`lead peak ${fmtK(lead.peak)} > ${fmtK(LEAD_PEAK_FLAG)}`);
  }

  // Flags collected so far must still print when the session has no subagents
  // (a lead above LEAD_PEAK_FLAG is exactly the case worth surfacing).
  const writeFlags = () => {
    if (!flags.length) return;
    out.write(`  FLAG (#1374 budget):\n`);
    for (const f of flags) out.write(`    - ${f}\n`);
  };

  const subDir = path.join(logDir, sessionId, "subagents");
  if (!fs.existsSync(subDir)) {
    out.write("  SUBAGENTS: none\n");
    writeFlags();
    return;
  }
  const rows = [];
  for (const name of fs.readdirSync(subDir)) {
    if (!/^agent-.*\.jsonl$/.test(name)) continue;
    const p = path.join(subDir, name);
    const metaPath = p.replace(/\.jsonl$/, ".meta.json");
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
      meta = {};
    }
    rows.push({ a: analyzeJsonl(fs.readFileSync(p, "utf8")), meta, name });
  }
  rows.sort((x, y) => y.a.cost - x.a.cost);
  const sum = (f) =>
    rows.some((r) => f(r.a) === null)
      ? null
      : rows.reduce((n, r) => n + f(r.a), 0);
  out.write(
    `  SUBAGENTS: n=${rows.length} est=${fmt$(sum((a) => a.cost))}` +
      ` out=${fmtK(sum((a) => a.total.output))}` +
      ` cache_read=${fmtK(sum((a) => a.total.cacheRead))}\n`,
  );
  for (const { a, meta } of rows) {
    const dur =
      a.durationH === null ? "   ?" : `${Math.round(a.durationH * 60)}m`;
    out.write(
      `    ${pad(fmt$(a.cost), 6)} peak=${pad(fmtK(a.peak), 5)}` +
        ` turns=${pad(a.turns, 3)} out=${pad(fmtK(a.total.output), 5)}` +
        ` cr=${pad(fmtK(a.total.cacheRead), 6)} dur=${pad(dur, 5)}` +
        `  ${meta.agentType || "?"}/${meta.model || "?"}` +
        `  ${String(meta.description || "").slice(0, 60)}\n`,
    );
    if (a.peak > SUBAGENT_PEAK_FLAG) {
      flags.push(
        `${meta.agentType || "?"} «${String(meta.description || "").slice(0, 40)}»` +
          ` peak ${fmtK(a.peak)} > ${fmtK(SUBAGENT_PEAK_FLAG)}`,
      );
    }
  }
  writeFlags();
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || (!args.sessions.length && !args.since && !args.rollout)) {
    process.stdout.write(USAGE);
    process.exit(args.help ? 0 : 1);
  }
  if (args.harness === "codex") {
    reportCodex(args);
    return;
  }
  const logDir = args.logDir || defaultLogDir();
  if (!logDir || !fs.existsSync(logDir)) {
    process.stderr.write(`[retro] log dir not found: ${logDir}\n`);
    process.exit(1);
  }
  const sessions = args.sessions.length
    ? args.sessions
    : sessionsSince(logDir, args.since);
  if (!sessions.length) {
    process.stderr.write(`[retro] no sessions matched under ${logDir}\n`);
    process.exit(1);
  }
  for (const id of sessions) reportSession(logDir, id);
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && invoked === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[retro:tokens] ${error.message}\n`);
    process.exitCode = 1;
  }
}

function reportCodex(args, out = process.stdout) {
  const root = args.logDir || codexSessionsRoot();
  const files = walkJsonl(root);
  if (args.rollout && !files.includes(path.resolve(args.rollout)))
    files.push(path.resolve(args.rollout));
  // Discovery reads only the metadata prefix, not every private transcript.
  const entries = files.map((file) => {
    const handle = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(65536);
      const bytes = fs.readSync(handle, buffer, 0, buffer.length, 0);
      return {
        file,
        meta: rolloutMeta(
          readRecords(buffer.subarray(0, bytes).toString("utf8")),
        ),
      };
    } finally {
      fs.closeSync(handle);
    }
  });
  // Duplicate log copies are one thread, choosing the most recently written log.
  entries.sort(
    (a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs,
  );
  const byId = new Map();
  for (const entry of entries) {
    const id = entry.meta.id ?? entry.meta.session_id;
    if (id && !byId.has(id)) byId.set(id, entry);
  }
  let selected;
  if (args.rollout)
    selected = [
      entries.find(
        (row) => path.resolve(row.file) === path.resolve(args.rollout),
      ),
    ];
  else if (args.sessions.length)
    selected = args.sessions.map((id) => byId.get(id));
  else {
    const cut = Date.parse(`${args.since}T00:00:00Z`);
    if (!Number.isFinite(cut)) throw new Error("Invalid --since date");
    selected = [...byId.values()].filter(
      (row) => !parentThread(row.meta) && fs.statSync(row.file).mtimeMs >= cut,
    );
  }
  if (!selected.length || selected.some((row) => !row))
    throw new Error("Codex session log not found; use --rollout or --log-dir");
  for (const lead of selected) {
    const id = lead.meta.id ?? lead.meta.session_id;
    out.write(`\n=== CODEX SESSION ${id ?? "UNKNOWN"}\n`);
    const seen = new Set();
    const print = (entry, role) => {
      const thread = entry.meta.id ?? entry.meta.session_id;
      if (seen.has(thread)) return;
      seen.add(thread);
      const a = analyzeCodexJsonl(fs.readFileSync(entry.file, "utf8"));
      out.write(
        `  ${role} ${thread}: turns=${a.turns ?? "UNKNOWN"} peak_ctx=${fmtK(a.peak)} window=${fmtK(a.contextWindow)} input=${fmtK(a.total.input)} cache_read=${fmtK(a.total.cacheRead)} out=${fmtK(a.total.output)} reasoning=${fmtK(a.total.reasoningOutput)} est=${fmt$(a.cost)}\n`,
      );
      for (const warning of a.warnings) out.write(`    ${warning}\n`);
      const threshold = role === "lead" ? LEAD_PEAK_FLAG : SUBAGENT_PEAK_FLAG;
      if (a.peak !== null && a.peak > threshold)
        out.write(
          `    FLAG (#1374 budget): peak ${fmtK(a.peak)} > ${fmtK(threshold)}\n`,
        );
      for (const child of byId.values())
        if (thread && parentThread(child.meta) === thread)
          print(child, "subagent");
    };
    print(lead, "lead");
    out.write(
      `  SUBAGENTS: n=${seen.size - 1}; discovery scope=${root ?? "UNKNOWN"} (only available logs)\n`,
    );
  }
}
