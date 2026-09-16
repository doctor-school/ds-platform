/**
 * tools/staging/slot-requests.mjs — is every live slot backed by a Stage-B request?
 *
 * A staging slot exists for exactly one reason: the owner was ASKED to accept a
 * rendered head. The ask itself is the artifact — a `Stage-B request` comment on
 * the PR (AGENTS.md §6, `build-ui-from-design-system/design-approval.md`). A slot
 * standing without one is a stand nobody was invited to, and a slot whose request
 * pins a head the PR has moved past is worse: the owner is looking at old pixels.
 *
 * This module is PURE — no ssh, no `gh`, no clock. `tools/agent-bootstrap.ts`
 * supplies the live slot names (docker labels via `parseLiveSlots`) and the PR
 * facts, and prints the classification in its `## Stage slots` section.
 */

/** A request comment opens with its own heading — never a passing mention. */
const REQUEST_HEADING_RE = /^#{1,3}\s*Stage-B request\b/;

/** `head: <sha>` inside the request body; 7+ hex, compared by prefix. */
const HEAD_LINE_RE = /^head:\s*([0-9a-f]{7,40})\b/im;

const SLOT_PR_RE = /^pr-(\d+)$/;

/**
 * Parse one PR comment body. Returns `{ head }` for a Stage-B request (with
 * `head: null` when the request pins no SHA), or `null` when the comment is not
 * a request at all — `Stage-B: GO` markers and ordinary prose included.
 */
export function parseRequestComment(body) {
  const text = String(body ?? "");
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "");
  if (!firstLine || !REQUEST_HEADING_RE.test(firstLine.trim())) return null;
  const head = text.match(HEAD_LINE_RE)?.[1]?.toLowerCase() ?? null;
  return { head };
}

/** Two SHAs are the same commit when the shorter is a prefix of the longer. */
function sameCommit(a, b) {
  if (!a || !b) return false;
  const x = String(a).toLowerCase();
  const y = String(b).toLowerCase();
  return x.length <= y.length ? y.startsWith(x) : x.startsWith(y);
}

/** `createdAt` is at least as recent as the head push (both ISO-8601). */
function notOlderThan(createdAt, headPushedAt) {
  const c = Date.parse(createdAt ?? "");
  const h = Date.parse(headPushedAt ?? "");
  if (Number.isNaN(c)) return false;
  // An unknown push time cannot convict the request of being stale.
  if (Number.isNaN(h)) return true;
  return c >= h;
}

/**
 * Classify every live slot against its PR's Stage-B request comments.
 *
 * @param {object} input
 * @param {string[]} input.liveSlots slot names, e.g. `["main", "pr-2229"]`
 * @param {Map<number, {headSha: string, headPushedAt: string, requestComments: Array<{createdAt: string, head: string|null}>}>} input.prs
 *   open PRs backing those slots; a slot missing from the map has no open PR.
 * @returns {Array<{slot: string, pr: number|null, status: "fresh"|"stale-request"|"no-request"|"no-open-pr"|"persistent", head: string|null}>}
 *   one row per input slot, in the order given.
 */
export function classifySlotRequests({ liveSlots = [], prs = new Map() } = {}) {
  return liveSlots.map((slot) => {
    if (slot === "main") {
      return { slot, pr: null, status: "persistent", head: null };
    }
    const number = Number(slot.match(SLOT_PR_RE)?.[1] ?? NaN);
    if (Number.isNaN(number)) {
      return { slot, pr: null, status: "no-open-pr", head: null };
    }
    const pr = prs.get(number);
    if (!pr) return { slot, pr: number, status: "no-open-pr", head: null };

    const head = pr.headSha ?? null;
    const comments = pr.requestComments ?? [];
    let status = "no-request";
    if (comments.length > 0) {
      const fresh = comments.some((c) =>
        c.head
          ? sameCommit(c.head, head)
          : notOlderThan(c.createdAt, pr.headPushedAt),
      );
      status = fresh ? "fresh" : "stale-request";
    }
    return { slot, pr: number, status, head };
  });
}
