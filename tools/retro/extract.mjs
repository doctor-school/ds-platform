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
export const CORRECTION_RE = new RegExp(
  [
    'почему', 'зачем', 'разве', 'не так', 'не нужно', 'не нужен', 'не нужна', 'не надо',
    'надо было', 'должен был', 'должно быть', 'не должно', 'стоп', 'отмен', 'верн[иё]',
    'нельзя', 'это непра', 'неправильно', 'ошиб', 'я же', 'я просил', 'я говорил',
    'опять', 'снова', 'почему ты', 'а как правильно', 'применял', 'использовал',
    'запускал', 'ты применил',
    // #362 — recall lexicon: real corrections that used none of the tokens above
    // (canonical live-corpus miss «…не нужен MFA … исключим из скоупа»). Each was
    // verified against the corpus to add genuine pushback with no benign false
    // positives. The soft-directive «давай …» is deliberately NOT here — on its
    // own it is a benign next-step directive («давай дальше»); the corrective
    // companions («всё-таки», «ещё раз») carry the signal instead.
    // «исключ» is stem-anchored to the corrective verb forms so it never flags
    // the benign «исключение» (exception) / «исключительно» (exclusively) that
    // appear in routine technical talk (#362 review SUGGESTION).
    'исключ(?:им|ить|ил[аи]?|аем|ают)', 'вместо', 'на самом деле', 'всё-таки',
    'все-таки', 'ещё раз', 'еще раз',
    // 2026-07-02 DSO-100 wrap retro — three real corrections the regex scored 0:
    // «Не понял, в чём вопрос» (confusion pushback), «Как это не установлен…»
    // (questioning a false claim), «убери всё лишнее» (undo-what-you-added).
    // «лишн» is the corrective stem (лишнее/лишний = superfluous), «убери» the
    // remove-directive; «как это не» is anchored to the negated-claim form so it
    // does not flag the benign «как это работает/сделать».
    'не понял', 'не понимаю', 'как это не', 'убери', 'лишн',
    // 2026-07-04 a5676594 wrap retro — two owner corrections the regex scored 0,
    // and the reason MULTI-session mode drops them (#492): a false-premise
    // challenge («С чего ты взял, что есть?») and a delivery-failure report
    // refuting a claimed DoD («в it@bbm.academy пусто»). Added: the false-premise
    // idiom, the negated-delivery family (не дошл/не пришл/не получил — didn't
    // arrive / didn't receive), and the empty-inbox predicate. «пуст» is
    // Cyrillic-anchored both sides — `\b` is ASCII-only under JS regex without
    // the `u` flag, so a bare stem flooded on упустили/запустил/допустим (the four
    // real corpus noise cases); the lookbehind kills those, and the narrow suffix
    // group (о|ой|ая|ые|ых, dropping ым/ого) also drops «пустым массивом» /
    // «пустого объекта» data-structure talk. Residual: nominative «пустой массив»
    // still matches (lexically identical to «Malpit пустой») — accepted, 0
    // occurrences in the 668-msg human corpus and CORRECTION_RE is a recall net.
    'с чего ты взял', 'не дош(?:л|ёл)', 'не приш(?:л|ёл)', 'не получил',
    '(?<![а-яё])пуст(?:о|ой|ая|ые|ых)(?![а-яё])',
    // 2026-07-05 548dd102 wrap retro — the DEFINING owner correction scored 0:
    // «Не Cancelled, а done как фактически сделанные…», the direct «не X, а Y»
    // contrastive substitution (replace X with Y) that used none of the tokens
    // above. The left side is a SINGLE token ([^\s,]+ forbids space + comma) so
    // the benign additive «не только X, а также Y» (two tokens before «, а»)
    // stays unflagged; the trailing «\sа\s» keeps «а» a standalone contrastive
    // conjunction, not a mid-word match.
    'не [^\\s,]+,\\s+а\\s',
    // 2026-07-06 513989fd wrap retro — the owner correction «Важное замечание …
    // промпты … обязаны быть на английском» scored 0: a norm-statement framing
    // («обязан(ы)» = must/obliged-to) plus the explicit «замечание» (remark)
    // label, neither in the lexicon. «обязан» is a stem that covers
    // обязан/обязаны/обязана/обязано but NOT the benign «обязательно» (the stem
    // diverges at «обязат»); «замечани» covers замечание/замечания/замечаний —
    // in owner chat both frame a norm the agent violated, i.e. pushback.
    'обязан', 'замечани',
    // 2026-07-07 35991795 wrap retro — TWO owner corrections scored 0, both
    // interrogative reproaches (a common RU register the lexicon could not see):
    // «Сколько он должен идти по времени? Уже 20 минут» (duration reproach: how
    // long is this STILL running) and «…Я вроде просил…» (broken-agreement: "but
    // I thought I asked …"). Each is anchored on a reproach marker so a plain
    // information question never flags — bare «почему»/«чего?» are deliberately
    // NOT tokens (a bare interrogative floods on benign info questions; «почему»
    // already flags, «опять/снова/ещё раз» already carry the repetition reproach).
    // «сколько … уже …»: the impatience form. Both stems are Cyrillic-anchored —
    // «сколько» left-anchored so «несколько … уже» (quantifier) never fires, «уже»
    // both-side anchored so «хуже» never fires; the ≤40-char gap keeps the two
    // words in one clause. «вроде + прос/говор/договор/…»: the broken-agreement
    // reproach; «вроде» is anchored to a request/recall verb so the benign ack
    // «вроде всё работает» / «вроде так и есть» stays quiet. «didn't i »: the
    // English reproach interrogative («didn't I ask/tell»); "why is this still" is
    // already covered by the «why » token.
    '(?<![а-яё])сколько[\\s\\S]{0,40}(?<![а-яё])уже(?![а-яё])',
    'вроде\\s+(?:же\\s+)?(?:прос|говор|договор|сказал|указыв|обсужд)',
    "didn.t i ",
    // 2026-07-12 #829 (edf902e9 wrap retro) — the #818 DEFINING owner correction
    // scored 0: «Кажется hover стейты элементов не соответствуют нашей
    // дизайн-системе. Всё прошло гарды?» — a hedged observation-form correction
    // (softened «кажется» + the mismatch predicate), a register the lexicon
    // could not see. Added: «кажется» (in owner turns the hedge prefixes a
    // suspected defect report, not small talk — the regex runs on user turns
    // only), «не соответству» (stem covers соответствует/-уют/-овал: an explicit
    // spec/design mismatch report), and the bare «вроде же» (hedged
    // broken-expectation marker; the verb-anchored «вроде + прос/говор/…» form
    // above misses the verbless «вроде же было иначе»). The Issue's
    // «почему (не|это)» and «разве не» forms are already subsumed by the bare
    // «почему» / «разве» tokens at the top of the lexicon — no new token needed.
    'кажется', 'не соответству', 'вроде же',
    // 2026-07-13 85170286 wrap retro (#829 recurrence) — the duration reproach
    // «CI до сих пор идёт? Не долго ли?» scored 0: «до сих пор» + a
    // verb-of-progress is the impatience register of «сколько … уже» above.
    // «до сих пор» is anchored to the progress/negation stems (ид/работ/вис/не)
    // so the benign historical narration «до сих пор так и было» stays quiet;
    // «не долго ли» / «не слишком ли долго» are the explicit too-long
    // interrogatives (no benign reading in owner chat).
    'до сих пор (?:ид|работ|вис|не)', 'не долго ли', 'не слишком ли долго',
    'why ', 'instead', 'should have', 'you were supposed', 'wrong', 'no,', 'stop',
    'revert', 'undo', "don't", 'do not', 'not what', 'i asked', 'i told you', 'again', 'did you',
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

// ── AskUserQuestion answers ───────────────────────────────────────────────
// A decision/collision session often resolves through an `AskUserQuestion`, and
// the decisive correction lands as the user's free-text answer or as a note
// attached to a selection (#360). Those answers arrive as a `tool_result` user
// entry — the typed-message path skips them, so the #345 retro reported
// `corrections: 0` for a session whose defining moment was a clear correction.
//
// The user-authored strings live in `toolUseResult.answers` (values) and
// `toolUseResult.annotations[q].notes`; the keys are the *questions* (assistant
// text) and must never be scanned. Older logs may carry only the rendered
// `tool_result.content` envelope — parse the `="…"` answer values from it as a
// fallback (it does NOT carry the notes channel).
const AUQ_ENVELOPE_PREFIX = 'Your questions have been answered:';

function toolResultString(e) {
  const content = e && e.message && e.message.content;
  if (!Array.isArray(content)) return '';
  const tr = content.find((c) => c && c.type === 'tool_result');
  return tr && typeof tr.content === 'string' ? tr.content : '';
}

// Is this user entry an AskUserQuestion answer envelope?
export function isAuqAnswer(e) {
  const tur = e && e.toolUseResult;
  if (tur && tur.answers && typeof tur.answers === 'object') return true;
  return toolResultString(e).startsWith(AUQ_ENVELOPE_PREFIX);
}

// The user-authored strings inside an AskUserQuestion answer entry: every answer
// value plus every annotation note. Never the question text. De-duplicated,
// order-preserving.
export function auqUserStrings(e) {
  const tur = e && e.toolUseResult;
  const out = [];
  const push = (v) => {
    if (typeof v === 'string') {
      const s = v.trim();
      if (s && !out.includes(s)) out.push(s);
    }
  };

  if (tur && tur.answers && typeof tur.answers === 'object') {
    for (const v of Object.values(tur.answers)) push(v);
  }
  if (tur && tur.annotations && typeof tur.annotations === 'object') {
    for (const a of Object.values(tur.annotations)) {
      if (a && typeof a === 'object') push(a.notes);
    }
  }

  // Fallback: parse the rendered envelope when no structured payload is present.
  if (out.length === 0) {
    const s = toolResultString(e);
    if (s.startsWith(AUQ_ENVELOPE_PREFIX)) {
      // Capture each `="…"` answer value (the RHS), never the "…" question (LHS).
      const re = /="((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = re.exec(s))) push(m[1].replace(/\\"/g, '"'));
    }
  }
  return out;
}

// ── queued_command interjections ───────────────────────────────────────────
// A mid-stream owner interjection typed WHILE the agent is busy is journaled not
// as a `type: 'user'` turn but as a standalone `attachment` entry (no `message`)
// whose payload is a `queued_command`. The typed-message path below only ever
// sees `type: 'user'` entries, so these escaped the extractor entirely — a
// mid-stream correction queued this way was reported as 0 (this session: 2 real
// owner corrections seen as 0).
//
// Only the `commandMode: 'prompt'` variant is real human input. The other
// variant, `commandMode: 'task-notification'`, is a system/background wrapper
// (a `<task-notification>` / agent-finished envelope) the retro must NEVER read
// as owner text — so classification keys on `commandMode`, and `isNoise`/handoff
// filtering still applies to the extracted prompt as a second line of defence.
export function queuedCommandPrompt(e) {
  const att = e && e.attachment;
  if (!att || att.type !== 'queued_command') return null;
  if (att.commandMode !== 'prompt') return null;
  return typeof att.prompt === 'string' ? att.prompt : null;
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

      // A mid-stream owner interjection queued while the agent is busy arrives as
      // an `attachment`/`queued_command` entry (not a `type: 'user'` turn), so
      // the typed-message path below never reaches it. Capture the real `prompt`
      // variant as a human message and run correction detection over it.
      const queued = queuedCommandPrompt(e);
      if (queued != null) {
        const text = queued;
        if (!isNoise(text)) {
          const handoff = isHandoff(text);
          meta.humanMsgs.push({
            ts: e.timestamp || null,
            text,
            handoff,
            imageOnly: false,
            source: 'queued_command',
            correction: !handoff && CORRECTION_RE.test(text),
          });
        }
        continue;
      }

      if (e.type !== 'user' || !e.message || e.message.role !== 'user') continue;
      if (e.isMeta) continue;
      if (e.isCompactSummary) continue;
      const content = e.message.content;
      // AskUserQuestion answers are real user input wrapped in a tool_result
      // envelope — pull the user-authored strings (answer values + notes) and
      // flag corrections among them, attributed to the answer timestamp (#360).
      if (isAuqAnswer(e)) {
        for (const ans of auqUserStrings(e)) {
          meta.humanMsgs.push({
            ts: e.timestamp || null,
            text: ans,
            handoff: false,
            imageOnly: false,
            source: 'askuserquestion',
            correction: CORRECTION_RE.test(ans),
          });
        }
        continue;
      }
      // skip the remaining tool_result-only user entries
      if (Array.isArray(content) && content.every((c) => c && c.type === 'tool_result')) continue;
      if (e.promptSource === 'sdk') {
        meta.sdkPrompts++;
        continue;
      }
      const t = textOf(content);
      const img =
        Array.isArray(content) && content.some((c) => c && c.type === 'image');
      const realText = t && !isNoise(t) ? t : '';
      // Keep an image-only user turn: in a UI/design session the correction
      // channel IS the annotated screenshot (empty text), which the text-only
      // CORRECTION_RE can never see — dropping it undercounts corrections (the
      // #333 retro saw 1 of ~7). Flag it as a correction candidate.
      if (!realText && !img) continue;
      const imageOnly = !realText && img;
      const text = realText || '[image-only turn — likely an annotated-screenshot correction]';
      const handoff = isHandoff(text);
      meta.humanMsgs.push({
        ts: e.timestamp || null,
        text,
        handoff,
        imageOnly,
        source: 'typed',
        correction: !handoff && (CORRECTION_RE.test(text) || imageOnly),
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

// Run only as the entry point (`node tools/retro/extract.mjs`). Guarding this
// keeps the pure helpers (CORRECTION_RE, isAuqAnswer, auqUserStrings) importable
// from a unit test without firing the side-effecting `main()` (#360).
const INVOKED_PATH = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (INVOKED_PATH === fileURLToPath(import.meta.url)) {
  main();
}
