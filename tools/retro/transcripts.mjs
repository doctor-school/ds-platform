#!/usr/bin/env node
/**
 * tools/retro/transcripts.mjs — build compact per-session transcripts for the
 * agent-workflow retro (epic #247, child #248). Graduated from the Phase-A
 * audit scratch (`.audit-tmp/transcripts.mjs`).
 *
 * Reads the index.json that extract.mjs wrote, then for every interactive
 * session emits a compact transcript: user text + assistant TEXT turns + a
 * tool-call trace (tool name + a one-field summary), dropping the bulky
 * tool_result payloads. Also flags assistant self-corrections ("self-catches")
 * with a heuristic — the moments the agent noticed its own deviation.
 *
 * What it produces in <out-dir>:
 *   - transcripts/<id>.md    compact transcript ([U] user / [A] assistant / [T] tool)
 *   - self-catches.json      assistant self-correction moments, with quotes
 *
 * Run extract.mjs FIRST (it writes index.json). Same --log-dir / --out-dir /
 * --session conventions; the log dir defaults to the auto-memory project dir.
 *
 * Usage:
 *   node tools/retro/transcripts.mjs [--log-dir <dir>] [--out-dir <dir>] [--session <id>]
 *   node tools/retro/transcripts.mjs --help
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

function defaultLogDir() {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
  const slug = REPO_ROOT.replace(/[\\/:]/g, '-');
  return path.resolve(home, '.claude', 'projects', slug);
}

const HELP = `tools/retro/transcripts.mjs — build compact per-session transcripts + self-catch list

Usage:
  node tools/retro/transcripts.mjs [--log-dir <dir>] [--out-dir <dir>] [--session <id>]

Run extract.mjs first (it writes index.json into <out-dir>). Same options:
  --log-dir <dir>   *.jsonl logs. Default: ~/.claude/projects/<repo-slug>/.
  --out-dir <dir>   Must contain index.json from extract.mjs. Default: <repo>/.audit-tmp.
  --session <id>    Single-session mode (the /wrap case). Omit for batch.
  --help, -h        Show this help.

Outputs (in <out-dir>): transcripts/<id>.md, self-catches.json.`;

// Assistant self-correction ("I was wrong / let me fix that / I should have…").
// Exported (with the entry-point guard at the bottom) so the lexicon is unit
// testable without firing main() — the same idiom #360 introduced for
// extract.mjs's CORRECTION_RE.
export const SELF_CATCH = new RegExp(
  [
    'actually,', 'wait,', 'on second thought', 'let me reconsider', 'i was wrong',
    'i made a mistake', 'my mistake', "i shouldn't have", 'i should have',
    'i incorrectly', 'that was wrong', 'correction:', 'i forgot', 'i skipped',
    'i violated', 'against the (rule|instruction|convention)', 'i jumped ahead',
    'i should not have', 'i overstepped', 'let me fix that', 'i misread',
    'oops', 'to correct myself', 'i assumed', 'i deviated', 'i broke the rule',
    'на самом деле', 'я ошибся', 'моя ошибка', 'поправл', 'был неправ', 'забыл',
    // #362 — recall lexicon: clean RU self-correction markers the corpus showed
    // missed («я зря впихнул/запустил…», «я перепутал…»). Verified high-precision:
    // unlike «исправл»/«пропустил»/«нарушил» (which flood on neutral status lines
    // and quoted-rule narration) these read only as the agent owning a slip.
    'я зря', 'перепутал', 'неправильно понял', 'не так понял',
  ].join('|'),
  'i',
);

const trunc = (s, n) => {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
};

function toolSummary(input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['command', 'file_path', 'pattern', 'query', 'description', 'prompt', 'url', 'skill']) {
    if (input[k]) return `${k}=${trunc(input[k], 140)}`;
  }
  return trunc(JSON.stringify(input), 140);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP + '\n');
    return;
  }

  const LOG_DIR = args.logDir ?? defaultLogDir();
  const OUT = args.outDir ?? path.join(REPO_ROOT, '.audit-tmp');
  const TDIR = path.join(OUT, 'transcripts');

  if (!LOG_DIR || !fs.existsSync(LOG_DIR)) {
    process.stderr.write(`[retro] log dir not found: ${LOG_DIR}\n  pass --log-dir <dir>.\n`);
    process.exit(1);
  }
  const indexPath = path.join(OUT, 'index.json');
  if (!fs.existsSync(indexPath)) {
    process.stderr.write(`[retro] ${indexPath} missing — run extract.mjs first.\n`);
    process.exit(1);
  }

  fs.mkdirSync(TDIR, { recursive: true });
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  let interactiveIds = new Set(index.filter((s) => s.kind === 'interactive').map((s) => s.id));
  if (args.session) {
    const want = args.session.replace(/\.jsonl$/, '');
    interactiveIds = new Set([...interactiveIds].filter((id) => id === want));
  }

  const selfCatches = [];
  const written = [];
  let totalBytes = 0;

  for (const id of interactiveIds) {
    const file = path.join(LOG_DIR, `${id}.jsonl`);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const out = [];
    let firstTs = null;
    let lastTs = null;
    const branches = new Set();

    for (const line of lines) {
      if (!line.trim()) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.timestamp) {
        if (!firstTs) firstTs = e.timestamp;
        lastTs = e.timestamp;
      }
      if (e.gitBranch) branches.add(e.gitBranch);
      if (e.type !== 'user' && e.type !== 'assistant') continue;
      if (e.isMeta || e.isCompactSummary) continue;
      const msg = e.message;
      if (!msg) continue;
      const c = msg.content;

      if (e.type === 'user' && msg.role === 'user') {
        if (e.promptSource === 'sdk') continue;
        const t =
          typeof c === 'string'
            ? c
            : Array.isArray(c)
              ? c.filter((x) => x && x.type === 'text').map((x) => x.text).join(' ')
              : '';
        if (!t) continue;
        const s = t.trimStart();
        if (
          s.startsWith('<command-') ||
          s.startsWith('<local-command') ||
          s.startsWith('Caveat:') ||
          s.startsWith('<system-reminder') ||
          s.startsWith('<task-notification') ||
          s.startsWith('You are continuing') ||
          s.startsWith('# Agent bootstrap')
        )
          continue;
        out.push(`[U] ${trunc(t, 1600)}`);
        continue;
      }

      if (e.type === 'assistant' && msg.role === 'assistant' && Array.isArray(c)) {
        for (const block of c) {
          if (block.type === 'text' && block.text && block.text.trim()) {
            const txt = block.text.trim();
            out.push(`[A] ${trunc(txt, 1400)}`);
            if (SELF_CATCH.test(txt)) {
              selfCatches.push({ id, ts: e.timestamp, text: trunc(txt, 600) });
            }
          } else if (block.type === 'tool_use') {
            out.push(`  [T] ${block.name}: ${toolSummary(block.input)}`);
          }
        }
      }
    }

    if (out.length === 0) continue;
    const header = `# session ${id}\nrange: ${firstTs} → ${lastTs}\nbranches: ${[...branches].join(', ')}\n\n`;
    const body = header + out.join('\n') + '\n';
    const bytes = Buffer.byteLength(body);
    fs.writeFileSync(path.join(TDIR, `${id}.md`), body);
    written.push({ id, bytes });
    totalBytes += bytes;
  }

  fs.writeFileSync(path.join(OUT, 'self-catches.json'), JSON.stringify(selfCatches, null, 2));

  // Report only the transcripts THIS run produced — never `readdirSync(TDIR)`,
  // which also counts `.md` files left by earlier (batch) runs and so reported a
  // stale, inflated total in single-session mode (the /wrap case: it processes one
  // session but the dir still held the whole batch, e.g. `transcripts: 75`).
  process.stdout.write(
    JSON.stringify(
      {
        mode: args.session ? 'single' : 'batch',
        transcripts: written.length,
        totalTranscriptBytes: totalBytes,
        totalTranscriptMB: +(totalBytes / 1048576).toFixed(2),
        selfCatches: selfCatches.length,
        biggest: written
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 5)
          .map((f) => `${f.id} ${(f.bytes / 1024) | 0}KB`),
      },
      null,
      2,
    ) + '\n',
  );
}

// Run only as the entry point (`node tools/retro/transcripts.mjs`). Guarding the
// call keeps the SELF_CATCH lexicon importable from a unit test without firing
// the side-effecting main() — the same idiom extract.mjs uses (#360, #362).
const INVOKED_PATH = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (INVOKED_PATH === fileURLToPath(import.meta.url)) {
  main();
}
