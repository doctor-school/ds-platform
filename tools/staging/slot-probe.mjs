/**
 * tools/staging/slot-probe.mjs — the `## Stage slots` section of `pnpm bootstrap`.
 *
 * A staging slot's lifetime is the owner's acceptance verdict, and the ask that
 * starts it is a `Stage-B request` comment on the PR (#2233). This module gathers
 * the two facts that answer «is every standing slot still invited?» — which slots
 * docker reports live on stage-1, and what each backing PR looks like — and hands
 * `tools/agent-bootstrap.ts` ready-to-print lines.
 *
 * Both effects are INJECTABLE (`readSlots`, `viewPr`), so the degrade paths this
 * section exists for — an unreachable box, a failing `gh` — are covered offline by
 * `slot-probe.test.mjs` instead of being exercised for the first time in a session.
 *
 * It never throws and it never prints a confident "0 slots": the box being silent
 * is `unavailable`, which is a different fact from the box having nothing running.
 */
import { spawn } from "node:child_process";

import { classifySlotRequests, parseRequestComment } from "./slot-requests.mjs";
import { readLiveSlots } from "./slot.mjs";

/** How long the box may stay silent before the section degrades. */
export const STAGE_SLOT_PROBE_MS = 8000;

/**
 * ssh options for THIS probe only. `pnpm bootstrap` runs on every SessionStart,
 * so an unreachable box must fail fast and non-interactively: without
 * `ConnectTimeout` a firewalled box costs the TCP-connect default (~21 s on
 * Windows, up to ~130 s on Linux) and without `BatchMode` ssh can sit on a
 * passphrase/host-key prompt forever. The wall-clock bound below kills the child
 * on top of these — the options keep the common case quick, the kill keeps the
 * pathological one bounded.
 */
const PROBE_SSH_OPTIONS = [
  "-o",
  "ConnectTimeout=5",
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=accept-new",
];

async function defaultReadSlots({ signal }) {
  // `stderr: "pipe"` keeps ssh's own diagnostics out of the SessionStart hook's
  // stderr — they come back folded into the one-line `unavailable (...)` reason.
  return readLiveSlots({
    sshOptions: PROBE_SSH_OPTIONS,
    signal,
    stderr: "pipe",
  });
}

/** `gh pr view <N> --json …`, spawned directly so it can be aborted too. */
async function defaultViewPr(number, { signal } = {}) {
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(
      "gh",
      [
        "pr",
        "view",
        String(number),
        "--json",
        "state,headRefOid,commits,comments",
      ],
      { stdio: ["ignore", "pipe", "ignore"], signal },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`gh pr view ${number} exited ${code}`)),
    );
  });
  return JSON.parse(stdout);
}

function firstLine(e) {
  return (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0] ?? "";
}

/**
 * @param {object} [deps]
 * @param {(opts: {signal: AbortSignal}) => Promise<Record<string, unknown>>} [deps.readSlots]
 * @param {(number: number, opts: {signal: AbortSignal}) => Promise<object>} [deps.viewPr]
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<{rows: Array<object>, states: Map<number, string>, error: string|null, warnings: Array<{source: string, message: string}>}>}
 */
export async function probeStageSlots({
  readSlots = defaultReadSlots,
  viewPr = defaultViewPr,
  timeoutMs = STAGE_SLOT_PROBE_MS,
} = {}) {
  const warnings = [];
  const controller = new AbortController();
  let timer;
  let names;

  try {
    const live = await Promise.race([
      readSlots({ signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          // Abort FIRST: the bound must end the ssh child, not merely the wait.
          controller.abort();
          reject(
            new Error(
              `ssh probe of the staging box timed out after ${Math.round(timeoutMs / 1000)}s`,
            ),
          );
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
    names = Object.keys(live ?? {});
  } catch (e) {
    controller.abort();
    const message = firstLine(e);
    warnings.push({ source: "stage-1 live slots", message });
    return { rows: [], states: new Map(), error: message, warnings };
  } finally {
    clearTimeout(timer);
  }

  const prs = new Map();
  const states = new Map();
  const ghErrors = new Set();
  const numbers = names
    .map((n) => Number(n.match(/^pr-(\d+)$/)?.[1] ?? NaN))
    .filter((n) => !Number.isNaN(n));

  // Bounded by the number of live slots (three, in practice) and run in parallel
  // so the section costs one `gh` round-trip, not one per slot in series.
  await Promise.all(
    numbers.map(async (number) => {
      try {
        const pr = await viewPr(number, { signal: controller.signal });
        states.set(number, pr.state ?? "?");
        if (pr.state !== "OPEN") return;
        const requestComments = (pr.comments ?? [])
          .map((c) => {
            const req = parseRequestComment(c.body);
            return req
              ? { createdAt: c.createdAt ?? "", head: req.head }
              : null;
          })
          .filter(Boolean);
        prs.set(number, {
          headSha: pr.headRefOid ?? "",
          // The MAXIMUM commit date, not the last list entry: a rebase can leave
          // an older `committedDate` at the end and would otherwise call a
          // headless request fresh (or convict a current one).
          headPushedAt:
            (pr.commits ?? [])
              .map((c) => c.committedDate ?? "")
              .filter(Boolean)
              .sort()
              .at(-1) ?? "",
          requestComments,
        });
      } catch (e) {
        ghErrors.add(number);
        warnings.push({
          source: `gh pr view ${number} (stage slot)`,
          message: firstLine(e),
        });
      }
    }),
  );

  // A slot whose PR could not be READ is not a slot whose PR is closed: keeping
  // the two apart stops an open, unbacked slot from reading as merged noise.
  const rows = classifySlotRequests({ liveSlots: names, prs }).map((row) =>
    row.pr !== null && ghErrors.has(row.pr)
      ? { ...row, status: "gh-error" }
      : row,
  );

  return { rows, states, error: null, warnings };
}

/** `⚠ pr-2229  no-request  head 162341f4  PR #2229 OPEN` — aligned columns. */
export function stageSlotLine(row, states) {
  const flag =
    row.status === "stale-request" || row.status === "no-request" ? "⚠" : " ";
  const head = row.head ? `head ${row.head.slice(0, 8)}` : "head —";
  const pr =
    row.pr === null
      ? "persistent slot (never flagged)"
      : row.status === "gh-error"
        ? `PR #${row.pr} (gh unavailable)`
        : `PR #${row.pr} ${states.get(row.pr) ?? "no open PR"}`;
  return `${flag} ${row.slot.padEnd(10)} ${row.status.padEnd(14)} ${head.padEnd(13)} ${pr}`;
}

/** The body of the `## Stage slots` section, one string per line. */
export function renderStageSlotSection(probe) {
  if (probe.error) return [`stage-1: unavailable (${probe.error})`];
  if (probe.rows.length === 0) return ["(no live slots)"];
  return [
    ...probe.rows.map((row) => stageSlotLine(row, probe.states)),
    "(a slot's lifetime is the owner's verdict; ⚠ = standing with no current Stage-B request — `tools/staging/README.md`)",
  ];
}
