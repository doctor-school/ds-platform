#!/usr/bin/env node
/**
 * tools/gh/handoff-verify.mjs — deterministic handoff-premise gate (#743).
 *
 * Why: handoff-premise staleness is a 4-recurrence retro theme (#487, #586,
 * #727, #730) and every prior fix was prose that failed to fire. This script
 * makes the premise check deterministic: for every extractable ref a handoff
 * names, it fetches the ACTUAL state from `gh` / git ancestry and compares it
 * against the handoff's own claim on the same line.
 *
 * Canon: `.claude/rules/repo-conventions.md` → Issue conventions (handoff
 * premises are hypotheses); wired into `/wrap` handoff emission
 * (`apps/docs/content/skills/run-wrap/SKILL.md` §5) and resume guidance.
 *
 * Usage:
 *   pnpm handoff:verify <handoff-file>
 *   <emit handoff> | pnpm handoff:verify          # stdin
 *
 * What counts as an extractable ref (NL prose understanding is OUT of scope):
 *   - Issue/PR numbers:  `#N`, `PR #N`, `PR N`, `issue N` → `gh issue view` /
 *     `gh pr view` state (open/closed/merged).
 *   - Commit SHAs: 7–40 hex chars containing at least one digit AND one a-f
 *     letter (heuristic vs plain numbers/words) → `git merge-base
 *     --is-ancestor <sha> origin/main` (merged/unmerged).
 *   - Branch names: `<feat|fix|chore|refactor|docs|tooling>/<...>` →
 *     resolve `origin/<branch>` (or local) then same ancestry check.
 *
 * Claim heuristic: the ref's LINE is scanned for status keywords —
 * open/closed/merged/unmerged/done (EN) and открыт/закрыт/влит/смёржен/
 * не влит (RU). Keyword present and mismatching actual → STALE; matching →
 * PASS; no keyword → INFO (actual state printed for the reader).
 *
 * Approval-provenance domain (#806): a line pairing an issue-ref with an
 * owner-approval claim («owner-approved», owner token + согласован/одобр/…)
 * is verified against the issue's ACTUAL provenance (`gh issue view --json
 * body,comments`): a quotable owner turn (Stage-A/B: GO marker, or an owner
 * token with a quoted span «…»/"…") → PASS; discovery-only provenance with
 * no quotable owner turn → STALE (the claim launders an agent idea as an
 * owner decision — the exact #779 failure).
 *
 * Task-kind-vs-surface domain (#778, non-blocking Phase-0 WARN): when the
 * handoff declares an IMPLEMENTATION / feature-iteration task-kind and names a
 * `feature:*`-labelled, user-facing-surface Issue whose owning feature-spec
 * has no `NNN-product.md` PRD (ADR-0014), it emits a WARN row + stderr hint
 * (route via do-product-discovery first) WITHOUT bumping `stale` — the exit
 * code stays 0 (promotable to BLOCK per ADR-0007 §2.6). Both the gh access and
 * the spec-dir lookup are injectable.
 *
 * Qualitative-text domains (#989, non-blocking Phase-0 WARNs, pure text scans
 * — no gh/git): (A) COMPLETENESS CLAIMS — a phrase asserting a set is
 * complete/empty/drained («fully drained», «backlog empty», «всё вычищено»,
 * …) is not ref-checkable, so each distinct phrase yields a WARN row + a
 * stderr hint to re-derive the set (`pnpm backlog:triage` / REST issue-list)
 * before acting on it. (B) UNQUOTED OWNER-DIRECTIVE FRAMING — free text
 * claiming owner direction («Owner-directed», «по указанию владельца», …)
 * while the handoff carries NO verbatim owner quote (heuristic: a «…»
 * guillemet span anywhere, or an attribution line — `Owner quote` / `цитата`
 * — carrying a quoted "…"/“…” span) yields a WARN row naming the unquoted
 * claim; issue-ref-tied approval claims are the #806 domain above and are
 * skipped here (no double-fire). Neither detector ever bumps `stale`.
 *
 * Output: one machine-parseable row per (ref, claim):
 *   PASS|STALE|INFO <ref> claimed=<claim|-> actual=<state>
 * then a summary line. Unknown/deleted ref (gh 404, unresolvable sha/branch)
 * → STALE (a premise about a ref that no longer resolves is stale by
 * definition — note: branches here are deleted on squash-merge).
 *
 * Exit codes: 0 = no STALE; 1 = ≥1 STALE row; 2 = usage / input error.
 *
 * Pure node, no bash-isms — runs on Windows/PowerShell and POSIX alike. The
 * extraction/claim/verdict logic is exported for unit tests
 * (tools/lint/guard-tests/handoff-verify.spec.ts); all `gh`/`git` calls go
 * through an injectable runner so tests never shell out.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_BUFFER = 16 * 1024 * 1024;
const BRANCH_PREFIXES = ["feat", "fix", "chore", "refactor", "docs", "tooling"];

// Issue/PR-number pattern, shared by ref extraction and approval-claim
// extraction (fresh instance per use — /g regexes are stateful).
const numRe = () =>
  /(?:\b(PRs?|pull requests?|issues?)\s*[#№]?\s*|[#№])(\d{1,6})\b/gi;

/** Owner token on a line (EN/RU), ignoring the CODEOWNERS false-positive. */
function hasOwnerToken(line) {
  return /владел|owner/i.test(String(line).replace(/CODEOWNERS/gi, ""));
}

/**
 * TIGHT approval-claim predicate shared by the #806 (issue-ref-tied) and #989
 * (free-text) domains: `owner-approved`/`owner approved`, or an owner token
 * (владел/owner, not CODEOWNERS) plus an approval stem on the same line.
 * Deliberately does NOT fire on `Mode-a APPROVE` / plain `approved` lines
 * without an owner token — review verdicts are not owner decisions.
 */
function isApprovalClaimLine(line) {
  return (
    /owner[-\s]approved/i.test(line) ||
    (hasOwnerToken(line) &&
      /согласован|одобр|утвержд|подтвердил|выбрал|approved?/i.test(line))
  );
}

/**
 * Extract every verifiable ref from the handoff text.
 * @param {string} text
 * @returns {{kind: "issue"|"pr"|"number"|"sha"|"branch", value: string|number, line: string, lineNo: number}[]}
 */
export function extractRefs(text) {
  const refs = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    const lineNo = i + 1;

    // Issue/PR numbers: a `#`/`№`-prefixed number anywhere, or a bare number
    // directly after a "PR" / "pull request" / "issue" word. A bare number
    // with neither is NOT a ref (too many false positives).
    for (const m of line.matchAll(numRe())) {
      const hint = (m[1] ?? "").toLowerCase();
      const kind = hint.startsWith("pr") || hint.startsWith("pull")
        ? "pr"
        : hint.startsWith("issue")
          ? "issue"
          : "number";
      refs.push({ kind, value: Number(m[2]), line, lineNo });
    }

    // Branch names: <prefix>/<N|tracker-id>-<slug> (repo convention).
    const branchRe = new RegExp(
      `\\b(?:${BRANCH_PREFIXES.join("|")})/[a-z0-9][a-z0-9._-]*`,
      "g",
    );
    const branchRanges = [];
    for (const m of line.matchAll(branchRe)) {
      branchRanges.push([m.index, m.index + m[0].length]);
      refs.push({ kind: "branch", value: m[0], line, lineNo });
    }

    // Commit SHAs: 7–40 hex, must contain a digit AND an a-f letter
    // (heuristic — rejects plain numbers like 1234567 and words like
    // "decade"), and must not sit inside an already-captured branch token.
    const shaRe = /\b[0-9a-f]{7,40}\b/g;
    for (const m of line.matchAll(shaRe)) {
      const tok = m[0];
      if (!/[a-f]/.test(tok) || !/\d/.test(tok)) continue;
      const inBranch = branchRanges.some(
        ([s, e]) => m.index >= s && m.index + tok.length <= e,
      );
      if (inBranch) continue;
      refs.push({ kind: "sha", value: tok, line, lineNo });
    }
  });
  return refs;
}

/**
 * Parse the status CLAIM a line makes about the refs on it.
 * Order matters: negated-merge forms («не влит», "not merged") must win over
 * their positive substrings.
 * @param {string} line
 * @returns {"open"|"closed"|"merged"|"unmerged"|null}
 */
export function parseClaim(line) {
  // NB: JS \b / \w are ASCII-only — Cyrillic stems are matched bare.
  const l = String(line).toLowerCase().replace(/ё/g, "е");
  if (/\bunmerged\b|\bnot\s+merged\b|не\s+(?:влит|смерж|замерж|смердж)/.test(l))
    return "unmerged";
  if (/\bmerged\b|смерж|замерж|смердж|влит/.test(l)) return "merged";
  if (/\bclosed\b|\bdone\b|закрыт/.test(l)) return "closed";
  if (/\bopen(?:ed)?\b|открыт/.test(l)) return "open";
  return null;
}

/**
 * Verdict for one (claim, actual) pair. `actual` is one of
 * open|closed|merged|unmerged|not-found.
 * A "closed" claim accepts a merged PR (merged ⇒ closed); a "merged" claim
 * does NOT accept a closed-unmerged PR; "open"/"unmerged" cross-accept for
 * the branch/sha domain.
 * @param {"open"|"closed"|"merged"|"unmerged"|null} claim
 * @param {string} actual
 * @returns {"PASS"|"STALE"|"INFO"}
 */
export function verdictFor(claim, actual) {
  if (actual === "not-found") return "STALE";
  if (claim == null) return "INFO";
  const accepts = {
    open: (a) => a === "open" || a === "unmerged",
    closed: (a) => a === "closed" || a === "merged",
    merged: (a) => a === "merged",
    unmerged: (a) => a === "unmerged" || a === "open",
  };
  return accepts[claim](actual) ? "PASS" : "STALE";
}

/**
 * Dedupe raw refs into one entry per distinct ref, each carrying the set of
 * distinct claims made about it. Claim-less occurrences are dropped when the
 * same ref also has a claimed occurrence (the claim rows subsume the INFO
 * row); a ref with only claim-less occurrences keeps one `null` claim.
 * @param {ReturnType<typeof extractRefs>} refs
 * @returns {{kind: string, value: string|number, claims: (string|null)[], lineNo: number}[]}
 */
export function dedupeRefs(refs) {
  const byId = new Map();
  for (const r of refs) {
    const id =
      r.kind === "sha" || r.kind === "branch"
        ? `${r.kind}:${r.value}`
        : `num:${r.value}`;
    let entry = byId.get(id);
    if (!entry) {
      entry = { kind: r.kind, value: r.value, claims: new Set(), lineNo: r.lineNo };
      byId.set(id, entry);
    }
    // A concrete issue/pr hint beats an unhinted `#N` for lookup ordering.
    if (entry.kind === "number" && r.kind !== "number") entry.kind = r.kind;
    const claim = parseClaim(r.line);
    if (claim) entry.claims.add(claim);
  }
  return [...byId.values()].map((e) => ({
    kind: e.kind,
    value: e.value,
    claims: e.claims.size > 0 ? [...e.claims] : [null],
    lineNo: e.lineNo,
  }));
}

/**
 * Extract owner-approval CLAIMS about issue refs (#806). A line carries an
 * approval claim when it has ≥1 issue-ref AND matches the TIGHT approval
 * pattern: `owner-approved`/`owner approved`, or an owner token (владел/owner,
 * not CODEOWNERS) plus an approval stem on the same line. Deliberately does
 * NOT fire on `Mode-a APPROVE` / plain `approved` lines without an owner
 * token — review verdicts are not owner decisions.
 * @param {string} text
 * @returns {{issue: number, line: string, lineNo: number}[]} deduped per issue
 */
export function extractApprovalClaims(text) {
  const claims = [];
  const seen = new Set();
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!isApprovalClaimLine(line)) return;
    for (const m of line.matchAll(numRe())) {
      const issue = Number(m[2]);
      if (seen.has(issue)) continue;
      seen.add(issue);
      claims.push({ issue, line, lineNo: i + 1 });
    }
  });
  return claims;
}

/**
 * Resolve an issue's approval PROVENANCE via `gh issue view --json
 * body,comments` (its own payload — separate from the state cache).
 * `owner-quoted` when any line of the body/comments carries a Stage-A/B GO
 * marker or an owner token with a quoted span («…» / "…" / “…”);
 * `no-owner-provenance` otherwise; `not-found` on gh failure/404.
 * @param {{gh: Function}} runner
 * @param {number} n
 * @returns {"owner-quoted"|"no-owner-provenance"|"not-found"}
 */
export function resolveProvenance(runner, n) {
  const res = runner.gh(["issue", "view", String(n), "--json", "body,comments"]);
  if (res.status !== 0) return "not-found";
  let payload;
  try {
    payload = JSON.parse(res.stdout);
  } catch {
    return "not-found";
  }
  const texts = [
    String(payload.body ?? ""),
    ...(Array.isArray(payload.comments)
      ? payload.comments.map((c) => String(c?.body ?? ""))
      : []),
  ];
  for (const line of texts.join("\n").split(/\r?\n/)) {
    if (/Stage-[AB]\s*[:：]\s*GO/i.test(line)) return "owner-quoted";
    if (hasOwnerToken(line) && /«[^«»]+»|"[^"]+"|“[^“”]+”/.test(line))
      return "owner-quoted";
  }
  return "no-owner-provenance";
}

/**
 * Verify approval claims against actual issue provenance. Rows share the
 * machine-parseable shape of verifyRefs(); STALE rows count into the exit-1
 * total, and each no-owner-provenance claim yields one stderr hint line.
 * @param {ReturnType<typeof extractApprovalClaims>} claims
 * @param {{gh: Function}} runner
 * @returns {{rows: {verdict: string, ref: string, claim: string, actual: string}[], stale: number, hints: string[]}}
 */
export function verifyApprovalClaims(claims, runner) {
  const rows = [];
  const hints = [];
  for (const c of claims) {
    const actual = resolveProvenance(runner, c.issue);
    rows.push({
      verdict: actual === "owner-quoted" ? "PASS" : "STALE",
      ref: `#${c.issue}`,
      claim: "owner-approved",
      actual,
    });
    if (actual === "no-owner-provenance")
      hints.push(
        `[handoff-verify] #${c.issue} is claimed owner-approved but its provenance has no quotable owner turn (discovery-only?) — reconcile to an owner turn before building.`,
      );
  }
  return { rows, stale: rows.filter((r) => r.verdict === "STALE").length, hints };
}

// ---------------------------------------------------------------------------
// Task-kind-vs-surface domain (#778): a non-blocking Phase-0 WARN that fires
// when a handoff declares an IMPLEMENTATION / feature-iteration task-kind AND
// routes a `feature:*`-labelled, user-facing-surface Issue straight to code
// while its owning feature-spec carries no `NNN-product.md` PRD (ADR-0014 /
// SDD hard rule). Root cause it guards: #768/#776 was dispatched straight to
// code for user-facing product IA, bypassing do-product-discovery. WARN is
// non-blocking — it emits a row + a stderr hint but never bumps `stale`, so
// the exit code stays 0 (promotable to BLOCK per ADR-0007 §2.6).

/** Feature-kind label predicate (spec-link-lint `isFeatureLabel` shape). */
function isFeatureLabel(name) {
  return /^feature/i.test(String(name));
}

/** Default spec-dir reader — real `fs.readdirSync` of the feature-spec dir. */
const SPECS_FEATURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "apps",
  "docs",
  "content",
  "specs",
  "features",
);
function defaultReadSpecDir(slug) {
  try {
    return readdirSync(path.join(SPECS_FEATURES_ROOT, slug));
  } catch {
    return [];
  }
}

/**
 * Extract the task-kind-vs-surface inputs from a handoff. Trigger gate: the
 * handoff must declare an implementation-class kind (IMPLEMENTATION /
 * feature-iteration) — a declared task-kind, e.g. the #768/#776 handoff said
 * "IMPLEMENTATION / orchestrate". Absent → null (skip the whole check). Present
 * → the distinct issue-ref numbers named in the handoff (same numRe the ref
 * pipeline uses).
 * @param {string} text
 * @returns {{issues: number[]} | null}
 */
export function extractTaskKindSurface(text) {
  const s = String(text);
  if (!/\b(?:IMPLEMENTATION|feature-iteration)\b/i.test(s)) return null;
  const issues = new Set();
  for (const m of s.matchAll(numRe())) issues.add(Number(m[2]));
  return { issues: [...issues] };
}

/**
 * Verify each named Issue: a `feature:*`-labelled, user-facing Issue whose
 * owning feature-spec has no `NNN-product.md` PRD → WARN (non-blocking) row +
 * stderr hint. PRD present → PASS. Non-feature-labelled / backend-only / no
 * owning spec / gh-404 → skipped silently. Both the gh access (`runner.gh`)
 * and the spec-dir lookup (`readSpecDir`) are injectable so tests never shell
 * out or touch the real FS.
 * @param {{issues: number[]} | null} input
 * @param {{runner: {gh: Function}, readSpecDir?: (slug: string) => string[]}} deps
 * @returns {{rows: {verdict: string, ref: string, claim: string, actual: string}[], hints: string[], warn: number}}
 */
export function verifyTaskKindSurface(input, { runner, readSpecDir } = {}) {
  const rows = [];
  const hints = [];
  if (!input) return { rows, hints, warn: 0 };
  const read = readSpecDir ?? defaultReadSpecDir;
  for (const n of input.issues) {
    const res = runner.gh(["issue", "view", String(n), "--json", "labels,body"]);
    if (res.status !== 0) continue; // not an issue / 404 → skip
    let payload;
    try {
      payload = JSON.parse(res.stdout);
    } catch {
      continue;
    }
    const labels = Array.isArray(payload.labels)
      ? payload.labels.map((l) => String(l?.name ?? ""))
      : [];
    if (!labels.some(isFeatureLabel)) continue; // non-feature-labelled → skip

    const body = String(payload.body ?? "");
    // User-facing signal: a page/component path token under an app's app|src.
    if (!/apps\/[^/\s]+\/(?:app|src)\//.test(body)) continue; // backend-only → silent

    // Owning spec: first specs/features/<slug>/ path token in the body.
    const specM = body.match(/specs\/features\/(\d{3}-[a-z0-9-]+)\//);
    if (!specM) continue; // no owning spec named → nothing to assert
    const slug = specM[1];
    const nnn = slug.slice(0, 3);
    const hasPrd = read(slug).includes(`${nnn}-product.md`);
    if (hasPrd) {
      rows.push({
        verdict: "PASS",
        ref: `#${n}`,
        claim: "user-facing",
        actual: `prd-present:${slug}`,
      });
    } else {
      rows.push({
        verdict: "WARN",
        ref: `#${n}`,
        claim: "user-facing",
        actual: `no-prd:${slug}`,
      });
      hints.push(
        `[handoff-verify] user-facing surface (#${n}) routed straight-to-code but feature-spec ${slug} has no ${nnn}-product.md PRD — route via do-product-discovery / re-derive AGENTS.md §3.1 before dispatch (SDD hard rule, ADR-0014).`,
      );
    }
  }
  return { rows, hints, warn: rows.filter((r) => r.verdict === "WARN").length };
}

// ---------------------------------------------------------------------------
// Qualitative-completeness domain (#989, Detector A — non-blocking WARN, pure
// text scan). A handoff phrase asserting a SET is complete/empty/drained
// («fully drained», «backlog empty», «всё вычищено», …) cannot be verified
// against any extractable ref — the consumer must re-derive the set (`pnpm
// backlog:triage` / a REST issue-list) instead of trusting the prose. The
// phrase list is deliberately CONSERVATIVE (false positives are the named
// risk); one claim per line (first matching pattern), deduped by phrase text
// across the handoff.

/** Matched against the lowercased, ё→е-normalized line. Order: specific first. */
const COMPLETENESS_PATTERNS = [
  /\bcluster\s+(?:fully\s+)?drained\b/,
  /\bfully\s+drained\b/,
  /\bbacklog\s+(?:is\s+)?empty\b/,
  /\ball\s+(?:cleared|done|drained|merged)\b/,
  /\bnothing\s+(?:left|open|remaining)\b/,
  /\bcluster\s+complete\b/,
  // NB: JS \b / \w are ASCII-only — Cyrillic stems are matched bare; bare
  // stems also cover the safe inflections (вычищено/вычищены, закрыт(а/о/ы)).
  /все\s+вычищен/,
  /хвост\s+пуст/,
  /полностью\s+закрыт/,
];

/**
 * Extract qualitative completeness claims (Detector A, #989).
 * @param {string} text
 * @returns {{phrase: string, line: string, lineNo: number}[]}
 */
export function extractCompletenessClaims(text) {
  const claims = [];
  const seen = new Set();
  String(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      const l = line.toLowerCase().replace(/ё/g, "е");
      for (const re of COMPLETENESS_PATTERNS) {
        const m = l.match(re);
        if (!m) continue;
        const phrase = m[0].replace(/\s+/g, " ");
        if (!seen.has(phrase)) {
          seen.add(phrase);
          claims.push({ phrase, line, lineNo: i + 1 });
        }
        break; // one claim per line — first matching pattern wins
      }
    });
  return claims;
}

/**
 * WARN rows for completeness claims — pure, no runner, never bumps `stale`.
 * @param {ReturnType<typeof extractCompletenessClaims>} claims
 * @returns {{rows: {verdict: string, ref: string, claim: string, actual: string}[], hints: string[], warn: number}}
 */
export function verifyCompletenessClaims(claims) {
  const rows = [];
  const hints = [];
  for (const c of claims) {
    rows.push({
      verdict: "WARN",
      ref: `L${c.lineNo}`,
      claim: "set-complete",
      actual: "not-ref-checkable",
    });
    hints.push(
      `[handoff-verify] completeness claim '${c.phrase}' is not ref-checkable — run \`pnpm backlog:triage\` or a REST issue-list before acting on it.`,
    );
  }
  return { rows, hints, warn: rows.length };
}

// ---------------------------------------------------------------------------
// Unquoted owner-directive domain (#989, Detector B — non-blocking WARN, pure
// text scan). Free text claiming owner direction («Owner-directed»,
// «Owner-approved», «по указанию владельца», «одобрено владельцем») is
// UNCONFIRMED agent framing unless the handoff carries a verbatim owner
// quote. Issue-ref-tied approval claims are #806's domain (verified against
// issue provenance) and are skipped here — no double-fire. Precedent: session
// 1c4b7478 opened «Owner-directed (2026-07-16): … Prune first, implement
// second» — every ref PASSed while the framing itself was agent-authored.

/** Matched against the ё→е-normalized line (case-insensitive). */
const OWNER_DIRECTIVE_PATTERNS = [
  /owner[-\s]directed/i,
  /owner[-\s]approved/i,
  /по\s+указанию\s+владельца/i,
  /одобрен[оаы]?\s+владельцем/i,
];

/**
 * Extract free-text owner-directive claims (Detector B, #989). One claim per
 * line (first matching pattern); lines #806 already verifies (approval claim
 * + issue ref on the same line) are excluded.
 * @param {string} text
 * @returns {{phrase: string, line: string, lineNo: number}[]}
 */
export function extractOwnerDirectiveClaims(text) {
  const claims = [];
  String(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      // #806 verifies issue-ref-tied approval claims against provenance —
      // skip those lines entirely so the same claim never fires twice.
      if (isApprovalClaimLine(line) && [...line.matchAll(numRe())].length > 0)
        return;
      const norm = line.replace(/ё/g, "е").replace(/Ё/g, "Е");
      for (const re of OWNER_DIRECTIVE_PATTERNS) {
        const m = norm.match(re);
        if (m) {
          claims.push({ phrase: m[0], line, lineNo: i + 1 });
          return; // one claim per line
        }
      }
    });
  return claims;
}

/**
 * Verbatim-owner-quote evidence heuristic (#989, documented + deliberately
 * simple): TRUE when the handoff carries a «…» guillemet span ANYWHERE (the
 * house style for owner quotes), or an attribution line (`Owner quote` /
 * `цитата`) carrying a "…" / “…” quoted span.
 * @param {string} text
 * @returns {boolean}
 */
export function hasOwnerQuoteEvidence(text) {
  const s = String(text);
  if (/«[^«»]+»/.test(s)) return true;
  for (const line of s.split(/\r?\n/)) {
    if (/owner\s+quote|цитат/i.test(line) && /"[^"]+"|“[^“”]+”/.test(line))
      return true;
  }
  return false;
}

/**
 * Verify owner-directive claims against quote evidence — pure, never bumps
 * `stale`. Quote present → PASS row (visible, silent to stderr); absent →
 * WARN row + stderr hint naming the unquoted claim.
 * @param {ReturnType<typeof extractOwnerDirectiveClaims>} claims
 * @param {boolean} quoteEvidence result of hasOwnerQuoteEvidence(text)
 * @returns {{rows: {verdict: string, ref: string, claim: string, actual: string}[], hints: string[], warn: number}}
 */
export function verifyOwnerDirectiveClaims(claims, quoteEvidence) {
  const rows = [];
  const hints = [];
  for (const c of claims) {
    if (quoteEvidence) {
      rows.push({
        verdict: "PASS",
        ref: `L${c.lineNo}`,
        claim: "owner-directive",
        actual: "owner-quote-present",
      });
    } else {
      rows.push({
        verdict: "WARN",
        ref: `L${c.lineNo}`,
        claim: "owner-directive",
        actual: "no-owner-quote",
      });
      hints.push(
        `[handoff-verify] '${c.phrase}' (line ${c.lineNo}) claims owner direction but the handoff carries no verbatim owner quote («…» / attributed "…") — treat it as UNCONFIRMED agent framing and reconcile with the owner before executing (#989).`,
      );
    }
  }
  return { rows, hints, warn: rows.filter((r) => r.verdict === "WARN").length };
}

/** Default runner — real `gh` / `git` via spawnSync (Windows-safe: both are exes on PATH). */
export function defaultRunner() {
  const run = (cmd, args) => {
    const res = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: MAX_BUFFER });
    if (res.error)
      throw new Error(`failed to spawn ${cmd}: ${res.error.message}`);
    return {
      status: res.status ?? 1,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  };
  return { gh: (args) => run("gh", args), git: (args) => run("git", args) };
}

/** `gh issue|pr view <n> --json state` → canonical state string or null. */
function ghState(runner, kind, n) {
  const args =
    kind === "pr"
      ? ["pr", "view", String(n), "--json", "state"]
      : ["issue", "view", String(n), "--json", "state"];
  const res = runner.gh(args);
  if (res.status !== 0) return null;
  try {
    const s = String(JSON.parse(res.stdout).state ?? "").toLowerCase();
    return s === "open" || s === "closed" || s === "merged" ? s : null;
  } catch {
    return null;
  }
}

/** Resolve a #N to its actual state, trying the hinted kind first. */
function resolveNumber(runner, kind, n) {
  const order =
    kind === "pr" ? ["pr", "issue"] : kind === "issue" ? ["issue", "pr"] : ["issue", "pr"];
  for (const k of order) {
    const s = ghState(runner, k, n);
    if (s) return s;
  }
  return "not-found";
}

/** Resolve a sha/branch to merged|unmerged|not-found vs origin/main. */
function resolveGitRef(runner, kind, value) {
  let sha = value;
  if (kind === "branch") {
    sha = null;
    for (const ref of [`refs/remotes/origin/${value}`, `refs/heads/${value}`]) {
      const res = runner.git(["rev-parse", "--verify", "--quiet", ref]);
      if (res.status === 0 && res.stdout.trim()) {
        sha = res.stdout.trim();
        break;
      }
    }
    if (!sha) return "not-found";
  } else {
    const exists = runner.git(["cat-file", "-e", `${sha}^{commit}`]);
    if (exists.status !== 0) return "not-found";
  }
  const anc = runner.git(["merge-base", "--is-ancestor", sha, "origin/main"]);
  if (anc.status === 0) return "merged";
  if (anc.status === 1) return "unmerged";
  return "not-found";
}

/**
 * Verify every extracted ref against actual gh/git state.
 * @param {ReturnType<typeof extractRefs>} refs
 * @param {{gh: Function, git: Function}} runner
 * @returns {{rows: {verdict: string, ref: string, claim: string|null, actual: string}[], stale: number}}
 */
export function verifyRefs(refs, runner) {
  const rows = [];
  const cache = new Map();
  for (const entry of dedupeRefs(refs)) {
    const cacheKey =
      entry.kind === "sha" || entry.kind === "branch"
        ? `${entry.kind}:${entry.value}`
        : `num:${entry.value}`;
    let actual = cache.get(cacheKey);
    if (actual === undefined) {
      actual =
        entry.kind === "sha" || entry.kind === "branch"
          ? resolveGitRef(runner, entry.kind, entry.value)
          : resolveNumber(runner, entry.kind, entry.value);
      cache.set(cacheKey, actual);
    }
    const refLabel =
      entry.kind === "sha" || entry.kind === "branch"
        ? String(entry.value)
        : `#${entry.value}`;
    for (const claim of entry.claims) {
      rows.push({
        verdict: verdictFor(claim, actual),
        ref: refLabel,
        claim,
        actual,
      });
    }
  }
  return { rows, stale: rows.filter((r) => r.verdict === "STALE").length };
}

function usage() {
  process.stderr.write(
    "Usage: pnpm handoff:verify <handoff-file>   (or pipe the handoff via stdin)\n",
  );
  process.exit(2);
}

function main() {
  const fileArg = process.argv[2];
  let text;
  try {
    if (fileArg) {
      text = readFileSync(fileArg, "utf8");
    } else if (!process.stdin.isTTY) {
      text = readFileSync(0, "utf8"); // fd 0 read works on Windows too
    } else {
      usage();
    }
  } catch (e) {
    process.stderr.write(`[handoff-verify] cannot read input: ${e.message}\n`);
    process.exit(2);
  }

  const refs = extractRefs(text);
  // #989 detectors are pure text scans — they run even on a ref-less handoff
  // (a «backlog empty» handoff with zero refs is exactly the dangerous case).
  const completenessResult = verifyCompletenessClaims(
    extractCompletenessClaims(text),
  );
  const directiveResult = verifyOwnerDirectiveClaims(
    extractOwnerDirectiveClaims(text),
    hasOwnerQuoteEvidence(text),
  );
  const textOnlyRows = [...completenessResult.rows, ...directiveResult.rows];

  if (refs.length === 0 && textOnlyRows.length === 0) {
    process.stdout.write(
      "[handoff-verify] no extractable refs (#N / PR N / sha / branch) found — nothing to verify.\n",
    );
    process.exit(0);
  }

  let stateResult = { rows: [], stale: 0 };
  let approvalResult = { rows: [], stale: 0, hints: [] };
  let taskKindResult = { rows: [], hints: [], warn: 0 };
  if (refs.length > 0) {
    const runner = defaultRunner();
    // Ancestry checks need a fresh origin/main; tolerate offline (warn + local).
    const fetch = runner.git(["fetch", "origin", "main", "--quiet"]);
    if (fetch.status !== 0)
      process.stderr.write(
        "[handoff-verify] WARN: git fetch origin main failed — ancestry checked against the LOCAL origin/main.\n",
      );

    stateResult = verifyRefs(refs, runner);
    approvalResult = verifyApprovalClaims(extractApprovalClaims(text), runner);
    taskKindResult = verifyTaskKindSurface(extractTaskKindSurface(text), { runner });
  }
  const rows = [
    ...stateResult.rows,
    ...approvalResult.rows,
    ...taskKindResult.rows,
    ...textOnlyRows,
  ];
  // WARN rows (task-kind-vs-surface #778, completeness + owner-directive #989)
  // are non-blocking: they never feed `stale`, so the exit code stays 0 on a
  // WARN-only run (Phase-0 WARN, ADR-0007 §2.6).
  const stale = stateResult.stale + approvalResult.stale;
  const warn = taskKindResult.warn + completenessResult.warn + directiveResult.warn;
  for (const r of rows)
    process.stdout.write(
      `${r.verdict} ${r.ref} claimed=${r.claim ?? "-"} actual=${r.actual}\n`,
    );
  for (const hint of [
    ...approvalResult.hints,
    ...taskKindResult.hints,
    ...completenessResult.hints,
    ...directiveResult.hints,
  ])
    process.stderr.write(`${hint}\n`);
  const pass = rows.filter((r) => r.verdict === "PASS").length;
  const info = rows.filter((r) => r.verdict === "INFO").length;
  process.stdout.write(
    `[handoff-verify] ${rows.length} row(s): ${pass} PASS, ${stale} STALE, ${info} INFO, ${warn} WARN — ${
      stale > 0 ? "STALE premises found, fix the handoff before emitting/consuming it." : "OK"
    }\n`,
  );
  process.exit(stale > 0 ? 1 : 0);
}

// Run main only when invoked directly, so the pure functions can be imported
// in tests. `pathToFileURL` yields canonical `file:///C:/…` on Windows too.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
