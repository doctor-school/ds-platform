/**
 * tools/gh/lib/projects-v2.mjs — shared GitHub Projects v2 GraphQL plumbing.
 *
 * Why this exists (#1140): three call sites now touch the DS Platform Projects v2
 * board — `set-board-status.mjs` (set an Issue's Status), `pr-land.mjs` (delete a
 * merged PR's OWN board row so dead rows auto-leave), and `backlog-triage.ts`
 * (sweep for dead / under-fielded PR rows). Rather than copy-paste the query
 * strings, the item picker, and the `gh api graphql` spawn+parse into each, the
 * shared, single-sourced pieces live here. The 5000/hr `gh` token is shared
 * across all sessions (CLAUDE.md → Subagent context economy), so every query
 * here is either a TARGETED per-node read or an EXPLICITLY paginated full-board
 * scan — never a `gh project item-list` board dump (#984).
 *
 * Pure seams (query/mutation builders, the item picker, page parsing) carry no
 * side effect and are unit-tested. `ghGraphqlResult` is the one impure spawn; it
 * returns a discriminated result (never `process.exit`s) so a caller chooses its
 * own error posture — set-board-status dies, pr-land's board-clear stage treats a
 * failure as a non-fatal reported line.
 *
 * Board coordinates: memory `feedback_project_status_done_on_merge`.
 */
import { spawnSync } from "node:child_process";

export const OWNER = "doctor-school";
export const REPO = "ds-platform";
export const PROJECT_NUMBER = 1;
export const PROJECT_TITLE = "DS Platform";

// Generous stdout buffer (#315 hit ENOBUFS at the 1 MB default). A paginated
// board page can be large; keep the headroom — a silent truncation crash costs
// more than the bytes.
const GH_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Reject a value that would break out of a GraphQL double-quoted string literal.
 * @param {string} name
 * @param {unknown} value
 */
function assertSafeLiteral(name, value) {
  if (typeof value !== "string" || value === "" || /["\\{}]/.test(value))
    throw new Error(`projects-v2: invalid ${name}: ${value}`);
}

/**
 * Pick the projectItems node belonging to the DS Platform board (project number
 * 1) from a `projectItems.nodes` array. Shared by every targeted per-node read
 * (an Issue or a PR can sit on several projects). Null when absent / malformed.
 * @param {Array<{project?:{number?:number}}>|null|undefined} nodes
 * @param {number} [projectNumber]
 */
export function pickProjectItem(nodes, projectNumber = PROJECT_NUMBER) {
  if (!Array.isArray(nodes)) return null;
  return nodes.find((n) => n?.project?.number === projectNumber) ?? null;
}

/**
 * Targeted query for a single PR's board item: the PR's projectItems, each with
 * its id + owning project (id/number/title) — everything the delete mutation
 * needs, in one cheap call. Mirrors set-board-status's per-ISSUE query, swapping
 * `issue(number:N)` for `pullRequest(number:N)`.
 * @param {number} prNumber
 */
export function buildPrProjectItemsQuery(prNumber) {
  if (!Number.isInteger(prNumber) || prNumber <= 0)
    throw new Error(`buildPrProjectItemsQuery: invalid PR number ${prNumber}`);
  return (
    `query{repository(owner:"${OWNER}",name:"${REPO}"){` +
    `pullRequest(number:${prNumber}){projectItems(first:10){nodes{id ` +
    `project{id number title}}}}}}`
  );
}

/**
 * The deleteProjectV2Item mutation — removes an item from the board (the PR row
 * itself, not the PR). Both ids are live-resolved; the interpolation guard keeps
 * a malformed id out of the query string.
 * @param {string} projectId
 * @param {string} itemId
 */
export function buildDeleteItemMutation(projectId, itemId) {
  assertSafeLiteral("projectId", projectId);
  assertSafeLiteral("itemId", itemId);
  return (
    `mutation{deleteProjectV2Item(input:{projectId:"${projectId}",` +
    `itemId:"${itemId}"}){deletedItemId}}`
  );
}

/**
 * One page of the FULL board scan (#1140 triage): up to 100 items, each with its
 * content typename and — for a PullRequest — the number, state, assignee count,
 * and milestone title needed to flag dead / under-fielded PR rows. Paginated via
 * the opaque `after` cursor; `null`/omitted starts at the first page. This is the
 * ONE sanctioned board-wide read (explicit pagination, no `gh project item-list`
 * dump, #984).
 * @param {string|null} [after]
 */
export function buildBoardItemsPageQuery(after = null) {
  let cursor = "";
  if (after != null) {
    assertSafeLiteral("cursor", after);
    cursor = `,after:"${after}"`;
  }
  return (
    `query{organization(login:"${OWNER}"){projectV2(number:${PROJECT_NUMBER}){` +
    `items(first:100${cursor}){pageInfo{hasNextPage endCursor} nodes{id ` +
    `content{__typename ... on PullRequest{number state ` +
    `assignees(first:1){totalCount} milestone{title}}}}}}}}`
  );
}

/**
 * Extract `{nodes, hasNextPage, endCursor}` from a board-items page response, or
 * null when the shape is absent (a query error the caller already surfaced).
 * @param {unknown} data the `data` object from ghGraphqlResult
 */
export function parseBoardItemsPage(data) {
  const items = data?.organization?.projectV2?.items;
  if (!items) return null;
  return {
    nodes: Array.isArray(items.nodes) ? items.nodes : [],
    hasNextPage: !!items.pageInfo?.hasNextPage,
    endCursor: items.pageInfo?.endCursor ?? null,
  };
}

/**
 * Run `gh api graphql -f query=<q>` and return a discriminated result — NEVER
 * `process.exit`s, so a caller picks its own error posture. The spawn is
 * injectable (`spawn(query) -> {status,stdout,stderr,error}`) so the unit tests
 * drive every branch without a subprocess.
 * @param {string} query
 * @param {(query:string)=>{status:number|null,stdout?:string,stderr?:string,error?:Error}} [spawn]
 * @returns {{ok:true,data:unknown}|{ok:false,error:string}}
 */
export function ghGraphqlResult(query, spawn = defaultGraphqlSpawn) {
  const res = spawn(query);
  if (res.error)
    return {
      ok: false,
      error: `failed to spawn gh: ${res.error.message} (is the gh CLI installed + on PATH?)`,
    };
  if (res.status !== 0)
    return {
      ok: false,
      error: `gh api graphql exited ${res.status}: ${(res.stderr ?? "").trim()}`,
    };
  let parsed;
  try {
    parsed = JSON.parse(res.stdout ?? "");
  } catch {
    return { ok: false, error: "could not parse gh api graphql JSON output" };
  }
  if (parsed.errors?.length)
    return {
      ok: false,
      error: `GraphQL errors: ${parsed.errors.map((e) => e.message).join("; ")}`,
    };
  return { ok: true, data: parsed.data };
}

/** Default `gh api graphql` spawn — the only real subprocess in this module. */
function defaultGraphqlSpawn(query) {
  return spawnSync("gh", ["api", "graphql", "-f", `query=${query}`], {
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER,
  });
}
