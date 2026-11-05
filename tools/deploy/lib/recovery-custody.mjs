// Issue #3662: the runner side of the automated key custody (recovery-custody.yml;
// spec apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md
// §5 «Prod read verbs.» → `recovery-bundle`, `recovery-check`; infra/deploy/RECOVERY.md
// §2 «Automated custody (CI)»).
//
// The repository is public, so the job log is public: the box answers status lines
// only, and this filter prints only the lines of that fixed grammar — a box line
// outside it is dropped and counted, never echoed.

/** The verbs of recovery-custody.yml, served by ds-read-entrypoint on ds-api-prod. */
export const RECOVERY_VERBS = ["recovery-bundle", "recovery-check"];
export const RECOVERY_BOXES = ["api-prod", "data-prod"];

// Pinned equal to ds-read-entrypoint's RECOVERY_LINE_RE by the tests.
export const RECOVERY_LINE_RE =
  /^(api-prod|data-prod) (MATCH|MISSING|STORED [0-9]{8}T[0-9]{6}Z members [0-9]{1,3}|STALE [0-9]{1,5}d|MISMATCH [A-Za-z0-9_.:-]{1,80})$/;
// The entrypoint's own refusal / failure lines (fixed texts, no values).
const ENTRYPOINT_LINE_RE = /^ds-read-entrypoint: [A-Za-z0-9 #().,:/_-]{1,240}$/;

/**
 * The job's verdict on one recovery verb: the lines it may print and whether the job
 * passes. Passing needs exit 0 and, for each box, its success word (STORED for a
 * bundle, MATCH for a check) and nothing else.
 */
export function recoveryReport({ verb, rc, stdout, stderr }) {
  if (!RECOVERY_VERBS.includes(verb)) {
    return {
      ok: false,
      lines: [`recovery-custody: unknown verb ${JSON.stringify(verb)}`],
    };
  }
  const lines = [];
  let dropped = 0;
  const status = [];
  for (const raw of String(stdout).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    if (RECOVERY_LINE_RE.test(line)) status.push(line);
    else dropped += 1;
  }
  const reasons = [];
  for (const raw of String(stderr).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (ENTRYPOINT_LINE_RE.test(line)) reasons.push(line);
  }
  lines.push(`recovery-custody: ${verb} exit ${rc}`);
  lines.push(...status);
  lines.push(...reasons.slice(-6));
  if (dropped > 0)
    lines.push(
      `recovery-custody: ${dropped} line(s) outside the status grammar dropped`,
    );
  if (rc === 255) lines.push("recovery-custody: ssh to ds-api-prod failed");
  const want = verb === "recovery-bundle" ? / STORED / : / MATCH$/;
  const perBox = RECOVERY_BOXES.map((box) =>
    status.filter((l) => l.startsWith(`${box} `)),
  );
  const ok =
    rc === 0 &&
    dropped === 0 &&
    perBox.every((ls) => ls.length === 1 && want.test(ls[0]));
  return { ok, lines };
}

/** The verb a scheduled run takes: the weekly cron bundles, the daily one checks. */
export function scheduledVerb(schedule, crons) {
  if (schedule === crons.bundle) return "recovery-bundle";
  if (schedule === crons.check) return "recovery-check";
  return null;
}

// Pinned equal to ds-recovery's RECIPIENT_RE and MIN_RECIPIENTS by the tests: native
// X25519 recipients only, at least two distinct.
export const RECIPIENT_RE = /^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/;
export const MIN_RECIPIENTS = 2;

/**
 * ds-recovery's custodian gate (check_custodians) on the committed custodians.txt:
 * `count` distinct native recipients, `invalid` other non-comment lines, `ready` when
 * the box would accept the file. Counts only — no recipient leaves this function.
 */
export function custodianGate(text) {
  const seen = new Set();
  let invalid = 0;
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (RECIPIENT_RE.test(line)) seen.add(line);
    else invalid += 1;
  }
  const count = seen.size;
  return { count, invalid, ready: invalid === 0 && count >= MIN_RECIPIENTS };
}
