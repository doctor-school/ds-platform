#!/usr/bin/env node
/**
 * tools/retro/extract.mjs — session-log extractor for the agent-workflow retro
 * (epic #247, child #248). Graduated from the Phase-A audit scratch
 * (`.audit-tmp/extract.mjs`).
 *
 * Reads Claude Code session logs (`*.jsonl`), isolates REAL human (typed)
 * messages, classifies each session interactive vs sdk/automated, flags
 * correction / pushback messages with a heuristic, and emits compact digests
 * that the `run-session-retro` skill (and `/wrap`, #B1) consume.
 *
 * What it produces in <out-dir>:
 *   - sessions/<id>.json   per interactive session: human-message digest
 *   - index.json           one row per session (kind, ts range, counts)
 *   - summary.json         corpus totals + date range
 *   - corrections.json     corrections-only corpus (the gold signal), by session
 *
 * Default log dir: derived the same way as tools/lint/instruction-budget-lint.ts
 * derives MEMORY.md — repo-root path slugged (separators → '-') under
 * ~/.claude/projects/<slug>/. Override with --log-dir; override the output
 * location with --out-dir (default <repo>/.audit-tmp, which is gitignored).
 *
 * Usage:
 *   node tools/retro/extract.mjs [--log-dir <dir>] [--out-dir <dir>]
 *   node tools/retro/extract.mjs --session <id>        # single-session mode (/wrap)
 *   node tools/retro/extract.mjs --help
 *
 * --session restricts the run to one log id (the just-finished session), the
 * `/wrap` case. Without it, every *.jsonl in the log dir is processed (the
 * historical-audit / batch case).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── arg parsing ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { logDir: null, outDir: null, session: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--log-dir') out.logDir = argv[++i];
    else if (a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--session') out.session = argv[++i];
    else if (a.startsWith('--log-dir=')) out.logDir = a.slice('--log-dir='.length);
    else if (a.startsWith('--out-dir=')) out.outDir = a.slice('--out-dir='.length);
    else if (a.startsWith('--session=')) out.session = a.slice('--session='.length);
  }
  return out;
}

// Default auto-memory project log dir: ~/.claude/projects/<repo-slug>/
// (same slug convention as instruction-budget-lint.ts).
function defaultLogDir() {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
  const slug = REPO_ROOT.replace(/[\\/:]/g, '-');
  return path.resolve(home, '.claude', 'projects', slug);
}

const HELP = `tools/retro/extract.mjs — extract human messages + correction corpus from Claude Code session logs

Usage:
  node tools/retro/extract.mjs [--log-dir <dir>] [--out-dir <dir>] [--session <id>]

Options:
  --log-dir <dir>   Directory of *.jsonl session logs.
                    Default: ~/.claude/projects/<repo-slug>/ (auto-memory dir).
  --out-dir <dir>   Where to write digests. Default: <repo>/.audit-tmp (gitignored).
  --session <id>    Single-session mode: process only this log id (the /wrap case).
                    Omit for batch mode (the historical audit over the whole corpus).
  --help, -h        Show this help.

Outputs (in <out-dir>): sessions/<id>.json, index.json, summary.json, corrections.json.
Then run transcripts.mjs over the same <out-dir> to build per-session transcripts.`;

// ── heuristics ──────────────────────────────────────────────────────────────
// Does a human message look like a correction / "why did you…" / pushback?
const CORRECTION_RE = new RegExp(
  [
    'почему', 'зачем', 'разве', 'не так', 'не нужно', 'не надо', 'надо было', 'должен был',
    'должно быть', 'стоп', 'отмен', 'верн[иё]', 'нельзя', 'это непра', 'неправильно', 'ошиб',
    'я же', 'я просил', 'я говорил', 'опять', 'снова', 'почему ты', 'а как правильно',
    'why ', 'instead', 'should have', 'you were supposed', 'wrong', 'no,', 'stop',
    'revert', 'undo', "don't", 'do not', 'not what', 'i asked', 'i told you', 'again',
  ].join('|'),
  'i',
);

// Handoff-prompt continuations are real pasted messages but NOT corrections.
function isHandoff(t) {
  const s = t.trimStart();
  return (
    s.startsWith('You are continuing') ||
    s.startsWith('# Agent bootstrap') ||
    /^#{1,3}\s*Current task/m.test(s.slice(0, 400))
  );
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n');
  }
  return '';
}

// Wrappers that are NOT real typed human text.
function isNoise(t) {
  const s = t.trimStart();
  return (
    s.startsWith('<command-') ||
    s.startsWith('<local-command') ||
    s.startsWith('Caveat:') ||
    s.startsWith('<system-reminder') ||
    s.startsWith('<task-notification') ||
    s.startsWith('[Request interrupted') ||
    s.startsWith('<bash-') ||
    s.startsWith('API Error') ||
    s.startsWith('This session is being continued') ||
    s === ''
  );
}

// ── main ──────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP + '\n');
    return;
  }

  const LOG_DIR = args.logDir ?? defaultLogDir();
  const OUT_DIR = args.outDir ?? path.join(REPO_ROOT, '.audit-tmp');

  if (!LOG_DIR) {
    process.stderr.write('[retro] could not derive a log dir (no HOME/USERPROFILE); pass --log-dir.\n');
    process.exit(1);
  }
  if (!fs.existsSync(LOG_DIR)) {
    process.stderr.write(`[retro] log dir not found: ${LOG_DIR}\n  pass --log-dir <dir>.\n`);
    process.exit(1);
  }

  fs.mkdirSync(path.join(OUT_DIR, 'sessions'), { recursive: true });

  let files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.jsonl'));
  if (args.session) {
    const want = args.session.endsWith('.jsonl') ? args.session : `${args.session}.jsonl`;
    files = files.filter((f) => f === want);
    if (files.length === 0) {
      process.stderr.write(`[retro] session log not found in ${LOG_DIR}: ${want}\n`);
      process.exit(1);
    }
  }

  const sessions = [];

  for (const file of files) {
    const id = file.replace('.jsonl', '');
    let lines;
    try {
      lines = fs.readFileSync(path.join(LOG_DIR, file), 'utf8').split('\n');
    } catch {
      continue;
    }
    const meta = {
      id,
      file,
      bytes: fs.statSync(path.join(LOG_DIR, file)).size,
      firstTs: null,
      lastTs: null,
      entrypoints: new Set(),
      promptSources: new Set(),
      branches: new Set(),
      version: null,
      humanMsgs: [], // { ts, text, handoff, correction }
      sdkPrompts: 0,
      totalLines: 0,
      hasCompact: false,
    };

    for (const line of lines) {
      if (!line.trim()) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      meta.totalLines++;
      if (e.timestamp) {
        if (!meta.firstTs) meta.firstTs = e.timestamp;
        meta.lastTs = e.timestamp;
      }
      if (e.entrypoint) meta.entrypoints.add(e.entrypoint);
      if (e.promptSource) meta.promptSources.add(e.promptSource);
      if (e.gitBranch) meta.branches.add(e.gitBranch);
      if (e.version) meta.version = e.version;
      if (e.isCompactSummary) meta.hasCompact = true;

      if (e.type !== 'user' || !e.message || e.message.role !== 'user') continue;
      if (e.isMeta) continue;
      if (e.isCompactSummary) continue;
      // skip tool_result-only user entries
      const content = e.message.content;
      if (Array.isArray(content) && content.every((c) => c && c.type === 'tool_result')) continue;
      if (e.promptSource === 'sdk') {
        meta.sdkPrompts++;
        continue;
      }
      const t = textOf(content);
      if (!t || isNoise(t)) continue;
      const handoff = isHandoff(t);
      meta.humanMsgs.push({
        ts: e.timestamp || null,
        text: t,
        handoff,
        correction: !handoff && CORRECTION_RE.test(t),
      });
    }

    meta.entrypoints = [...meta.entrypoints];
    meta.promptSources = [...meta.promptSources];
    meta.branches = [...meta.branches];
    // session kind
    const interactive = meta.humanMsgs.length > 0;
    const sdkOnly = !interactive && meta.sdkPrompts > 0;
    meta.kind = interactive ? 'interactive' : sdkOnly ? 'sdk' : 'other';
    sessions.push(meta);

    // write per-session human-message digest (interactive only)
    if (interactive) {
      const digest = {
        id,
        kind: meta.kind,
        firstTs: meta.firstTs,
        lastTs: meta.lastTs,
        branches: meta.branches,
        version: meta.version,
        bytes: meta.bytes,
        msgCount: meta.humanMsgs.length,
        corrections: meta.humanMsgs.filter((m) => m.correction).length,
        messages: meta.humanMsgs,
      };
      fs.writeFileSync(
        path.join(OUT_DIR, 'sessions', `${id}.json`),
        JSON.stringify(digest, null, 2),
      );
    }
  }

  // sort by time
  sessions.sort((a, b) => String(a.firstTs).localeCompare(String(b.firstTs)));

  // index
  const index = sessions.map((s) => ({
    id: s.id,
    kind: s.kind,
    firstTs: s.firstTs,
    lastTs: s.lastTs,
    bytes: s.bytes,
    branches: s.branches,
    version: s.version,
    msgCount: s.humanMsgs.length,
    corrections: s.humanMsgs.filter((m) => m.correction).length,
  }));
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

  // summary
  const interactive = sessions.filter((s) => s.kind === 'interactive');
  const totalMsgs = interactive.reduce((n, s) => n + s.humanMsgs.length, 0);
  const totalCorr = interactive.reduce(
    (n, s) => n + s.humanMsgs.filter((m) => m.correction).length,
    0,
  );
  const summary = {
    logDir: LOG_DIR,
    mode: args.session ? 'single' : 'batch',
    totalFiles: files.length,
    interactiveSessions: interactive.length,
    sdkSessions: sessions.filter((s) => s.kind === 'sdk').length,
    otherSessions: sessions.filter((s) => s.kind === 'other').length,
    totalHumanMsgs: totalMsgs,
    totalCorrectionFlagged: totalCorr,
    dateRange: [sessions[0]?.firstTs, sessions[sessions.length - 1]?.lastTs],
  };
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  // corrections-only corpus (the gold signal), grouped by session, chronological
  const corr = interactive
    .map((s) => ({
      id: s.id,
      firstTs: s.firstTs,
      branches: s.branches,
      messages: s.humanMsgs.filter((m) => m.correction).map((m) => ({ ts: m.ts, text: m.text })),
    }))
    .filter((s) => s.messages.length > 0);
  fs.writeFileSync(path.join(OUT_DIR, 'corrections.json'), JSON.stringify(corr, null, 2));

  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main();
