#!/usr/bin/env node
/**
 * tools/retro/orchestration-mine.mjs — orchestration-metrics miner for the
 * agent-workflow retro (epic #247; widens the #700 first-pass sample to the
 * FULL corpus — #916).
 *
 * #700 sampled only 50 of ~361 sessions (mtime-recent), hand-recovered 3 inline
 * episodes, and verified `parallelOverlap` for only 4 sessions with a
 * same-message heuristic that undercounts. This miner makes those numbers
 * defensible: it runs over the whole `index.json` extract.mjs wrote, derives
 * per-session orchestration metrics, AUTO-classifies the lead's inline-decision
 * episodes into 5 documented causes, and detects parallel overlap from session
 * TIMESTAMPS rather than same-message co-occurrence.
 *
 * It REUSES the existing pipeline: run `extract.mjs` first (it writes
 * `index.json` + isolates interactive lead sessions), then this over the same
 * `--out-dir`. Subagent transcripts live in their own log files (this repo does
 * not sidechain them into the lead log), so within an interactive lead session
 * every Edit/Write is a lead-context inline mutation; a defensive `!isSidechain`
 * guard keeps that true even if a future log DOES sidechain.
 *
 * What it produces in <out-dir>:
 *   - orchestration-metrics.json   one row per interactive session (counts, ratio,
 *                                  context-at-wrap tokens, PRs touched, overlap)
 *   - orchestration-episodes.json  every auto-classified inline-decision episode
 *   - orchestration-summary.json   corpus totals + class histogram + overlap count
 *
 * Usage:
 *   node tools/retro/extract.mjs            # writes index.json first
 *   node tools/retro/orchestration-mine.mjs [--log-dir <dir>] [--out-dir <dir>]
 *   node tools/retro/orchestration-mine.mjs --help
 *
 * Same --log-dir / --out-dir defaults as extract.mjs (auto-memory project dir /
 * <repo>/.audit-tmp). This miner is FULL-CORPUS only — it has no --session mode;
 * a partial index (single-session extract) is refused with a non-zero exit so a
 * defensible corpus-wide number is never computed off a 1-session slice (#916).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function parseArgs(argv) {
  const out = { logDir: null, outDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--log-dir") out.logDir = argv[++i];
    else if (a === "--out-dir") out.outDir = argv[++i];
    else if (a.startsWith("--log-dir="))
      out.logDir = a.slice("--log-dir=".length);
    else if (a.startsWith("--out-dir="))
      out.outDir = a.slice("--out-dir=".length);
  }
  return out;
}

function defaultLogDir() {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
  const slug = REPO_ROOT.replace(/[\\/:]/g, "-");
  return path.resolve(home, ".claude", "projects", slug);
}

const HELP = `tools/retro/orchestration-mine.mjs — orchestration-metrics miner (#916)

Usage:
  node tools/retro/extract.mjs                 # writes index.json (run first)
  node tools/retro/orchestration-mine.mjs [--log-dir <dir>] [--out-dir <dir>]

Options:
  --log-dir <dir>   *.jsonl logs. Default: ~/.claude/projects/<repo-slug>/.
  --out-dir <dir>   Must contain index.json from extract.mjs. Default: <repo>/.audit-tmp.
  --help, -h        Show this help.

FULL-CORPUS only (no --session mode): refuses a single-session index so a
corpus-wide number is never computed off a partial run.

Outputs (in <out-dir>): orchestration-metrics.json, orchestration-episodes.json,
orchestration-summary.json.`;

// ── dispatch / mutation tool taxonomy ───────────────────────────────────────
// A dispatch is a subagent hand-off; the harness exposes it as the `Agent` (or
// legacy `Task`) tool. An inline mutation is a lead-context deliverable edit —
// the Edit/Write/NotebookEdit family. MultiEdit is the batched-Edit variant.
export const DISPATCH_TOOLS = new Set(["Agent", "Task"]);
export const MUTATION_TOOLS = new Set([
  "Edit",
  "Write",
  "NotebookEdit",
  "MultiEdit",
]);

// ── context-at-wrap ─────────────────────────────────────────────────────────
// The lead's context size at a message ≈ the tokens the model saw that turn:
// fresh input + cache-read + cache-creation. The LAST assistant message's usage
// is the closest proxy to "context at wrap". Returns null when no usage present.
export function contextFromUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const total =
    n(usage.input_tokens) +
    n(usage.cache_read_input_tokens) +
    n(usage.cache_creation_input_tokens);
  return total > 0 ? total : null;
}

// ── PR references ───────────────────────────────────────────────────────────
// "PRs touched" is mined from the two unambiguous PR signals in a session's
// tool trace + assistant text: a `gh pr <verb> <N>` CLI call whose verb takes a
// PR NUMBER as its immediate argument, and a `/pull/<N>` URL. The number must be
// adjacent to the verb (optional `#`), so a stray count/flag value deeper in the
// command is not mistaken for a PR. `create`/`list` are excluded — they emit no
// number. Bare `#N` is deliberately NOT scanned — it collides with Issue numbers
// (this repo numbers Issues and PRs in one sequence). De-duplicated,
// numeric-sorted. Documented heuristic (#916).
const GH_PR_RE =
  /gh\s+pr\s+(?:merge|view|checks|edit|comment|diff|close|ready|review)\s+#?(\d{1,5})\b/gi;
const PULL_URL_RE = /\/pull\/(\d{1,5})\b/g;

export function extractPrRefs(text) {
  if (typeof text !== "string" || !text) return [];
  const found = new Set();
  let m;
  GH_PR_RE.lastIndex = 0;
  while ((m = GH_PR_RE.exec(text))) found.add(Number(m[1]));
  PULL_URL_RE.lastIndex = 0;
  while ((m = PULL_URL_RE.exec(text))) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

// ── inline-decision episode classifier ──────────────────────────────────────
// Every inline mutation carries the lead's preceding reasoning text. The cause
// of choosing inline-over-dispatch buckets into EXACTLY these 5 classes. The
// lexicon is bilingual (RU+EN) and precedence-ordered — the FIRST class whose
// pattern hits wins, most-specific first — so a justification that cites a real
// carve-out is not mis-bucketed as a bare rationalization. The residual (no
// signal) is `rule-not-retrieved`: the lead mutated inline with no trace of
// having consulted the orchestration rule at all — the #584/#728 default failure.
//
// Precision over recall: each pattern was chosen to fire on a real
// inline-justification register with no benign-narration collision. The classes,
// in precedence order:
//   1 sanctioned-carve-out    — cites an ALLOWED inline path (read-only recon,
//                               docs-only, the #854 lead read-only carve-out, a
//                               lead-only tool the subagent lacks, a one-liner
//                               the rule permits). Highest precedence: a genuine
//                               carve-out must never read as a violation.
//   2 dispatch-abandoned      — a dispatch was attempted and FAILED (overload /
//                               429/529 / timeout / no return / fell back).
//   3 brief-cost-aversion     — inline because writing a brief/dispatching "isn't
//                               worth it" for the size of the change.
//   4 retrieved-but-rationalized — the rule/dispatch/subagent IS named, then the
//                               lead argues itself out of it ("faster inline",
//                               "just do it here", "проще самому", "быстрее").
//   5 rule-not-retrieved      — default: none of the above signals present.
export const EPISODE_LEXICON = {
  "sanctioned-carve-out": new RegExp(
    [
      "carve-?out",
      "read-?only\\s+(?:recon|lead|main)",
      "lead-?only\\s+tool",
      "designsync",
      "docs?-?only",
      "documentation-?only",
      "the\\s+rule\\s+(?:permits|allows)",
      "permitted\\s+inline",
      "allowed\\s+inline",
      "one-?liner",
      "zero\\s+main-?tree\\s+writes?",
      "outside\\s+the\\s+repo",
      "no\\s+pr\\s+(?:needed|required)",
      // RU
      "карве-?аут",
      "только\\s+чтени",
      "разрешено\\s+инлайн",
      "только\\s+докумен",
      "правил[оа]\\s+(?:разрешает|позволяет)",
      "однострочник",
      "вне\\s+репозитори",
      "вне\\s+репо(?![а-яё])",
      "pr\\s+не\\s+нужен",
    ].join("|"),
    "i",
  ),
  "dispatch-abandoned": new RegExp(
    [
      "dispatch(?:ing)?\\s+(?:failed|errored|is\\s+down)",
      "subagent\\s+(?:failed|did\\s*n.?t\\s+return|never\\s+returned|crashed|errored)",
      "overload(?:ed)?",
      "\\b429\\b",
      "\\b529\\b",
      "timed?\\s*out",
      "fell?\\s+back\\s+to\\s+(?:inline|doing\\s+it)",
      "falling\\s+back\\s+to\\s+inline",
      "retry\\s+(?:the\\s+)?dispatch",
      // RU
      "перегруз",
      "диспатч\\s+(?:упал|не\\s+удал|провал)",
      "субагент\\s+(?:не\\s+вернул|упал|не\\s+ответил)",
      "не\\s+вернул(?:ся)?\\s+результат",
      "откати(?:лся|ться)\\s+к\\s+инлайн",
    ].join("|"),
    "i",
  ),
  "brief-cost-aversion": new RegExp(
    [
      "not\\s+worth\\s+(?:a\\s+)?(?:brief|dispatch|the\\s+dispatch)",
      "overkill\\s+to\\s+dispatch",
      "brief\\s+(?:overhead|would\\s+cost)",
      "too\\s+(?:small|trivial)\\s+to\\s+dispatch",
      "not\\s+worth\\s+(?:spinning|orchestrat)",
      "cheaper\\s+to\\s+(?:just\\s+)?edit",
      // RU
      "не\\s+стоит\\s+диспатч",
      "ради\\s+(?:одной|пары)\\s+строк",
      "overkill\\s+ради",
      "дешевле\\s+(?:просто\\s+)?поправ",
      "слишком\\s+мелк\\w*\\s+для\\s+диспатч",
    ].join("|"),
    "i",
  ),
  "retrieved-but-rationalized": new RegExp(
    [
      // a dispatch/orchestration concept is NAMED, then argued away
      "faster\\s+(?:to\\s+)?(?:just\\s+)?(?:edit|do\\s+it)\\s+inline",
      "just\\s+(?:do|edit|fix)\\s+(?:it\\s+)?inline",
      "inline\\s+is\\s+(?:fine|fine\\s+here|faster|simpler|ok)",
      "i(?:'ll|\\s+will)?\\s+(?:just\\s+)?(?:do|edit|handle)\\s+(?:it\\s+)?(?:my|)self",
      "quicker\\s+inline",
      "skip\\s+the\\s+dispatch",
      "no\\s+need\\s+to\\s+dispatch",
      // RU
      "быстрее\\s+(?:самому|инлайн|поправ)",
      "проще\\s+самому",
      "сам\\w*\\s+поправлю",
      "без\\s+диспатч\\w*\\s+быстрее",
      "обойд[её]мся\\s+без\\s+диспатч",
    ].join("|"),
    "i",
  ),
};

// Precedence order — most specific first (see the block comment above).
export const EPISODE_CLASSES = [
  "sanctioned-carve-out",
  "dispatch-abandoned",
  "brief-cost-aversion",
  "retrieved-but-rationalized",
  "rule-not-retrieved",
];

// A non-deliverable edit target: a brief/plan/artifact written to the scratchpad
// or system temp, an auto-memory file (outside the repo, no PR), or /tmp. Editing
// one of these is NOT a dispatchable repo deliverable — it is the lead's own
// orchestration bookkeeping (writing the very brief it is about to dispatch,
// journalling a decision to memory). The file PATH is a far stronger, lower-noise
// carve-out signal than the reasoning text (#916): 79% of raw inline mutations in
// the corpus are exactly these. Repo source under `.claude/worktrees/<N>/…` is a
// real deliverable and is deliberately NOT matched here.
export const NON_DELIVERABLE_PATH_RE =
  /(?:scratchpad|[\\/]tmp[\\/]|appdata[\\/]local[\\/]temp|[\\/]memory[\\/]|\.claude[\\/]projects)/i;

export function isDeliverableEditPath(filePath) {
  if (typeof filePath !== "string" || !filePath) return false; // unknown → not counted as a deliverable
  return !NON_DELIVERABLE_PATH_RE.test(filePath);
}

// Classify one inline-decision episode. The edited FILE PATH is checked first: a
// non-deliverable target (scratch brief / memory / tmp) is definitionally a
// `sanctioned-carve-out` regardless of the reasoning text. Otherwise the
// precedence-ordered reasoning-text lexicon runs, falling through to
// `rule-not-retrieved` (the lead mutated a real deliverable inline with no trace
// of consulting the orchestration rule).
export function classifyInlineEpisode(text, filePath) {
  if (
    typeof filePath === "string" &&
    filePath &&
    NON_DELIVERABLE_PATH_RE.test(filePath)
  ) {
    return "sanctioned-carve-out";
  }
  const s = typeof text === "string" ? text : "";
  for (const cls of EPISODE_CLASSES) {
    if (cls === "rule-not-retrieved") continue; // the residual default
    if (EPISODE_LEXICON[cls].test(s)) return cls;
  }
  return "rule-not-retrieved";
}

// ── parallel overlap (timestamp-based) ──────────────────────────────────────
// Two sessions overlap when their [firstTs, lastTs] intervals intersect:
// `aStart < bEnd && bStart < aEnd`. Replaces the #700 same-message heuristic
// (which only saw sessions whose events landed in one lead message and so
// verified overlap for just 4 sessions). Returns a Map id → sorted overlap ids.
// Sessions with an unparseable/absent range are skipped (never spuriously
// overlap). O(n log n): sort by start, sweep an active set pruned by end.
export function computeOverlaps(sessions) {
  const items = sessions
    .map((s) => ({
      id: s.id,
      start: Date.parse(s.firstTs),
      end: Date.parse(s.lastTs),
    }))
    .filter(
      (x) =>
        Number.isFinite(x.start) && Number.isFinite(x.end) && x.end >= x.start,
    )
    .sort((a, b) => a.start - b.start);

  const overlaps = new Map(items.map((x) => [x.id, new Set()]));
  const active = []; // items whose end >= current start
  for (const cur of items) {
    // prune finished
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].end < cur.start) active.splice(i, 1);
    }
    for (const a of active) {
      // strict-ish intersection: a.start < cur.end && cur.start < a.end
      if (a.start < cur.end && cur.start < a.end) {
        overlaps.get(a.id).add(cur.id);
        overlaps.get(cur.id).add(a.id);
      }
    }
    active.push(cur);
  }
  const out = new Map();
  for (const [id, set] of overlaps) out.set(id, [...set].sort());
  return out;
}

// ── per-session metrics from a raw log ──────────────────────────────────────
// Reads one session's jsonl lines and returns the orchestration metrics. Pure
// over the line array so it is unit-testable with synthetic entries.
export function sessionMetricsFromLines(lines) {
  let dispatches = 0;
  let inline = 0;
  let deliverableInline = 0;
  let lastUsage = null;
  const prs = new Set();
  const episodes = []; // { ts, cls, quote, file, deliverable }

  // The most recent assistant reasoning text — the justification that precedes
  // a tool call. Reset on a user turn (a new instruction starts a new rationale).
  let pendingText = "";
  // Whether the immediately-previous tool_use was already an inline mutation:
  // a maximal RUN of consecutive inline edits is ONE decision episode, so only
  // the first edit of a run captures the preceding reasoning.
  let inRun = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.isSidechain) continue; // subagent work is not a lead inline mutation

    if (e.type === "user" && e.message && e.message.role === "user") {
      const c = e.message.content;
      // A tool_result-only user turn is the harness echoing an edit/bash result,
      // NOT a fresh human instruction — it must NOT wipe the lead's pending
      // rationale or break an inline RUN (otherwise every edit reads as its own
      // rationale-less episode, since a tool_result lands between consecutive
      // edits). Skip it without resetting. A REAL typed turn starts a new
      // rationale, so it resets.
      const isToolResultOnly =
        Array.isArray(c) &&
        c.length > 0 &&
        c.every((x) => x && x.type === "tool_result");
      if (isToolResultOnly) continue;
      pendingText = "";
      inRun = false;
      const t =
        typeof c === "string"
          ? c
          : Array.isArray(c)
            ? c
                .filter((x) => x && x.type === "text")
                .map((x) => x.text)
                .join("\n")
            : "";
      for (const n of extractPrRefs(t)) prs.add(n);
      continue;
    }

    if (
      e.type !== "assistant" ||
      !e.message ||
      !Array.isArray(e.message.content)
    )
      continue;
    if (e.message.usage) lastUsage = e.message.usage;

    for (const block of e.message.content) {
      if (
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim()
      ) {
        pendingText = block.text.trim();
        inRun = false; // a text turn between edits breaks the run
        for (const n of extractPrRefs(block.text)) prs.add(n);
        continue;
      }
      if (block.type !== "tool_use") continue;
      const name = block.name;
      const input = block.input || {};

      // Bash commands are where `gh pr` calls live
      if (name === "Bash" && typeof input.command === "string") {
        for (const n of extractPrRefs(input.command)) prs.add(n);
      }

      if (DISPATCH_TOOLS.has(name)) {
        dispatches++;
        inRun = false;
        continue;
      }
      if (MUTATION_TOOLS.has(name)) {
        inline++;
        const filePath =
          typeof input.file_path === "string" ? input.file_path : null;
        const deliverable = isDeliverableEditPath(filePath);
        if (deliverable) deliverableInline++;
        if (!inRun) {
          // first edit of a run → this is one inline-decision episode
          const cls = classifyInlineEpisode(pendingText, filePath);
          episodes.push({
            ts: e.timestamp || null,
            cls,
            quote: pendingText,
            file: filePath,
            deliverable,
          });
        }
        inRun = true;
        continue;
      }
      // any other tool between edits breaks the run (a new decision follows)
      inRun = false;
    }
  }

  return {
    dispatches,
    inline,
    deliverableInline,
    // The DEFENSIBLE inline:dispatch ratio uses deliverable inline edits only —
    // scratch briefs + memory writes are orchestration bookkeeping, not the
    // "edited a deliverable inline instead of dispatching" the metric is about.
    ratio: dispatches > 0 ? +(deliverableInline / dispatches).toFixed(2) : null,
    contextAtWrap: contextFromUsage(lastUsage),
    prs: [...prs].sort((a, b) => a - b),
    episodes,
  };
}

// ── corpus health: surface silently-skipped corrupt logs ────────────────────
// A NUL-corrupted / unparseable log file (an FS-corruption incident — memory
// reference_nul_corruption_incident_20260711) is non-empty on disk yet yields
// ZERO parseable JSONL records, so `sessionMetricsFromLines` returns all-zeros
// for it and it contributes nothing to the mined corpus. Left unreported, "N
// sessions mined" reads as "of a healthy corpus" when a chunk of it is
// destroyed — a silent cap. We count these explicitly and report the mined N
// against the true log-file denominator.
//
// A file is corrupt iff it is NON-EMPTY (has non-whitespace content) yet has NO
// parseable JSONL record. This deliberately does NOT flag a legitimately empty /
// whitespace-only log (0 records because there is nothing there) nor a short but
// valid session (≥1 parseable record) — only a file whose bytes are all garbage.
export function isCorruptLogContent(content) {
  if (typeof content !== "string" || !content.trim()) return false;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      JSON.parse(line);
      return false; // at least one parseable record → mined, not corrupt
    } catch {
      /* keep scanning for a parseable record */
    }
  }
  return true; // non-empty but zero parseable records → NUL-corrupt / unparseable
}

// Pure corpus-health rollup over a list of { content } log-file records plus the
// mined-session count. Kept pure (no fs) so the corrupt-file counter is
// unit-testable without shelling out to the real corpus (#916 follow-up).
export function computeCorpusHealth(logFiles, minedCount) {
  let skippedCorrupt = 0;
  for (const f of logFiles) {
    if (isCorruptLogContent(f && f.content)) skippedCorrupt++;
  }
  return {
    totalLogFiles: logFiles.length,
    mined: minedCount,
    skippedCorrupt,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP + "\n");
    return;
  }

  const LOG_DIR = args.logDir ?? defaultLogDir();
  const OUT = args.outDir ?? path.join(REPO_ROOT, ".audit-tmp");

  if (!LOG_DIR || !fs.existsSync(LOG_DIR)) {
    process.stderr.write(
      `[retro] log dir not found: ${LOG_DIR}\n  pass --log-dir <dir>.\n`,
    );
    process.exit(1);
  }
  const indexPath = path.join(OUT, "index.json");
  if (!fs.existsSync(indexPath)) {
    process.stderr.write(
      `[retro] ${indexPath} missing — run extract.mjs first.\n`,
    );
    process.exit(1);
  }
  const summaryPath = path.join(OUT, "summary.json");
  if (fs.existsSync(summaryPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      if (s.mode === "single") {
        process.stderr.write(
          "[retro] index.json is a SINGLE-session extract — refusing to compute corpus-wide\n" +
            "        orchestration metrics off a partial run (#916). Re-run `extract.mjs` in\n" +
            "        batch mode (no --session) first.\n",
        );
        process.exit(1);
      }
    } catch {
      /* summary unreadable — fall through, index presence is the hard gate */
    }
  }

  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const interactive = index.filter((s) => s.kind === "interactive");

  const metrics = [];
  for (const s of interactive) {
    const file = path.join(LOG_DIR, `${s.id}.jsonl`);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const m = sessionMetricsFromLines(lines);
    metrics.push({
      id: s.id,
      firstTs: s.firstTs,
      lastTs: s.lastTs,
      branches: s.branches,
      dispatches: m.dispatches,
      inline: m.inline,
      deliverableInline: m.deliverableInline,
      ratio: m.ratio,
      contextAtWrap: m.contextAtWrap,
      prs: m.prs,
      episodeCount: m.episodes.length,
      episodes: m.episodes, // detached into orchestration-episodes.json below
    });
  }

  // timestamp-based parallel overlap across the FULL set
  const overlaps = computeOverlaps(metrics);
  for (const row of metrics) row.parallelOverlap = overlaps.get(row.id) ?? [];

  // Corpus health — scan every *.jsonl in the log dir and count the NUL-corrupt /
  // unparseable files the miner would otherwise drop silently. mined = interactive
  // sessions actually turned into metric rows; the rest of the denominator is
  // legit non-interactive (sdk/other) logs plus these corrupt ones (#916 f-up).
  const logFiles = fs
    .readdirSync(LOG_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      try {
        return { content: fs.readFileSync(path.join(LOG_DIR, f), "utf8") };
      } catch {
        return { content: "" };
      }
    });
  const corpusHealth = computeCorpusHealth(logFiles, metrics.length);

  // detach episodes into their own artifact; keep metrics rows compact
  const episodes = [];
  for (const row of metrics) {
    for (const ep of row.episodes) {
      episodes.push({
        id: row.id,
        ts: ep.ts,
        cls: ep.cls,
        deliverable: ep.deliverable,
        file: ep.file,
        quote: ep.quote,
      });
    }
    delete row.episodes;
  }

  fs.writeFileSync(
    path.join(OUT, "orchestration-metrics.json"),
    JSON.stringify(metrics, null, 2),
  );
  fs.writeFileSync(
    path.join(OUT, "orchestration-episodes.json"),
    JSON.stringify(episodes, null, 2),
  );

  // ── summary ────────────────────────────────────────────────────────────
  const classHist = Object.fromEntries(EPISODE_CLASSES.map((c) => [c, 0]));
  for (const ep of episodes) classHist[ep.cls] = (classHist[ep.cls] ?? 0) + 1;

  const totalDispatches = metrics.reduce((n, m) => n + m.dispatches, 0);
  const totalInline = metrics.reduce((n, m) => n + m.inline, 0);
  const totalDeliverableInline = metrics.reduce(
    (n, m) => n + m.deliverableInline,
    0,
  );
  const withOverlap = metrics.filter(
    (m) => m.parallelOverlap.length > 0,
  ).length;
  const contextVals = metrics
    .map((m) => m.contextAtWrap)
    .filter((v) => typeof v === "number");
  const sessionsWithDispatch = metrics.filter((m) => m.dispatches > 0).length;
  const sessionsInlineHeavy = metrics.filter(
    (m) => m.deliverableInline > 0 && m.dispatches === 0,
  ).length;

  const summary = {
    generatedFrom: indexPath,
    corpusHealth,
    interactiveSessionsMined: metrics.length,
    totalDispatches,
    totalInlineMutations: totalInline,
    totalDeliverableInlineMutations: totalDeliverableInline,
    nonDeliverableInlineMutations: totalInline - totalDeliverableInline,
    corpusInlineDispatchRatio:
      totalDispatches > 0
        ? +(totalDeliverableInline / totalDispatches).toFixed(2)
        : null,
    corpusRawInlineDispatchRatio:
      totalDispatches > 0 ? +(totalInline / totalDispatches).toFixed(2) : null,
    sessionsWithAnyDispatch: sessionsWithDispatch,
    sessionsInlineWithZeroDispatch: sessionsInlineHeavy,
    inlineEpisodes: episodes.length,
    episodeClassHistogram: classHist,
    sessionsWithParallelOverlap: withOverlap,
    contextAtWrap: {
      sessionsWithUsage: contextVals.length,
      maxTokens: contextVals.length ? Math.max(...contextVals) : null,
      medianTokens: contextVals.length ? median(contextVals) : null,
    },
  };
  fs.writeFileSync(
    path.join(OUT, "orchestration-summary.json"),
    JSON.stringify(summary, null, 2),
  );

  process.stdout.write(
    `[retro] corpus health: skipped ${corpusHealth.skippedCorrupt} NUL-corrupt / ` +
      `unparseable of ${corpusHealth.totalLogFiles} total log files; ` +
      `mined ${corpusHealth.mined} interactive sessions.\n`,
  );
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

// Run only as the entry point — guarding keeps the pure helpers importable from a
// unit test without firing the side-effecting main() (the extract.mjs #360 idiom).
const INVOKED_PATH = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (INVOKED_PATH === fileURLToPath(import.meta.url)) {
  main();
}
