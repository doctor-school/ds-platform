/**
 * tools/gh/lib/claim.mjs — the Issue claim-comment rules, shared by
 * `pnpm backlog:triage` / `pnpm bootstrap` (report the claim) and
 * `pnpm task:worktree` (refuse a foreign one, #3560).
 *
 * A claim is a one-line comment `claim: <session name> — <plan>` posted before
 * the first edit; a stop-state comment newer than it releases it. The session
 * name makes the claimant addressable (Claude Code: its ListAgents name). Older
 * comments in the `Start…`/`Taking…`/`In progress…` shape, or a `claim:` with no
 * session, still count as claims — they just name nobody.
 *
 * Pure only — no `gh`, no I/O. Canon: .claude/rules/repo-conventions.md →
 * Issue conventions («Claim»).
 */

/**
 * Openers that release a claim: the canonical `**Where I stopped:**`
 * (board-design §6 four-field shape) plus the release openers sessions actually
 * post — `Stop-state: …` / `stop state …` / `Claim released …` (#3408).
 */
const STOP_STATE_OPENER =
  /^\s*(?:\*\*)?\s*(?:where i stopped|stop[- ]state|claim released)\b/i;

const CLAIM_OPENER =
  /^\s*(?:\*\*)?\s*(?:claim(?:ed|ing)?\b|start(?:ed|ing)?\b|taking\b|in[- ]progress\b)/i;

/** `claim: <session> — <plan>`; the separator may be an em/en dash or ` - `. */
const NAMED_CLAIM =
  /^\s*(?:\*\*)?\s*claim:\s*(?:\*\*)?\s*([A-Za-z0-9][\w.:-]*)\s+(?:—|–|-)\s+\S/i;

function firstNonEmptyLine(body) {
  return String(body ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .find((l) => l.trim() !== "");
}

/**
 * Is this comment a claim? Matched against the first non-empty line only — a
 * mid-comment "starting with" never claims, and `Claim released …` (which opens
 * with `claim`) is a release, never a claim.
 */
export function isStartClaimComment(body) {
  const first = firstNonEmptyLine(body);
  if (!first) return false;
  if (STOP_STATE_OPENER.test(first)) return false;
  return CLAIM_OPENER.test(first);
}

/** Is this comment a stop-state / claim-release? First non-empty line only. */
export function isStopStateComment(body) {
  const first = firstNonEmptyLine(body);
  return !!first && STOP_STATE_OPENER.test(first);
}

/** The session a `claim: <session> — <plan>` comment names; null when unnamed. */
export function claimSession(body) {
  const first = firstNonEmptyLine(body);
  if (!first || !isStartClaimComment(body)) return null;
  const m = first.match(NAMED_CLAIM);
  return m ? m[1] : null;
}

/** The canonical claim line this tooling posts. */
export function formatClaimComment(session, plan) {
  return `claim: ${session} — ${plan}`;
}

/** Compact age: `<1m`, `34m`, `2h`, `3d`. */
export function formatClaimAge(ms) {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The live claim among an Issue's comments: the latest claim, when it is newer
 * than the latest stop-state. Null when there is none or a stop-state released it.
 * @param {Array<{body:string, createdAtMs:number}>|undefined} comments
 * @returns {{session:string|null, line:string, createdAtMs:number}|null}
 */
export function latestOpenClaim(comments) {
  let claim = null;
  let latestStop;
  for (const c of comments ?? []) {
    if (isStartClaimComment(c.body)) {
      if (claim == null || c.createdAtMs > claim.createdAtMs) claim = c;
    } else if (isStopStateComment(c.body)) {
      if (latestStop == null || c.createdAtMs > latestStop)
        latestStop = c.createdAtMs;
    }
  }
  if (claim == null || (latestStop != null && latestStop >= claim.createdAtMs))
    return null;
  return {
    session: claimSession(claim.body),
    line: firstNonEmptyLine(claim.body).trim(),
    createdAtMs: claim.createdAtMs,
  };
}

/** Every `Closes/Fixes/Resolves #N` Issue ref in a PR title/body. */
export function closesRefs(text) {
  const out = new Set();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;
  let m;
  while ((m = re.exec(String(text ?? ""))) !== null) out.add(Number(m[1]));
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * May this session start work on Issue `n`? (#3560)
 *
 * Refused when the live claim names another session (or names nobody, so it
 * cannot be told apart from a peer's), or an open PR from another branch closes
 * the Issue. A claim naming `session` is this session's own and passes.
 *
 * @param {{n:number, session?:string|null, branch:string, nowMs:number,
 *   comments?:Array<{body:string, createdAtMs:number}>,
 *   openPrs?:Array<{number:number, headRefName:string, body?:string, title?:string}>}} input
 * @returns {{ok:true} | {ok:false, reasons:string[]}}
 */
export function claimVerdict({ n, session, branch, nowMs, comments, openPrs }) {
  const reasons = [];
  const claim = latestOpenClaim(comments);
  if (claim && !(session && claim.session === session)) {
    const who = claim.session ?? "an unnamed session";
    reasons.push(
      `#${n} claimed by ${who} ${formatClaimAge(nowMs - claim.createdAtMs)} ago: ${claim.line}`,
    );
  }
  for (const pr of openPrs ?? []) {
    if (pr.headRefName === branch) continue;
    if (closesRefs(`${pr.title ?? ""}\n${pr.body ?? ""}`).includes(n))
      reasons.push(
        `#${n} has open PR #${pr.number} from branch ${pr.headRefName}`,
      );
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
