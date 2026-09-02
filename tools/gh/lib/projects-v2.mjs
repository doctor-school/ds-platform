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
 *
 * Issue rows carry the roadmap-taxonomy fields too (#1729): title, labels,
 * milestone and the sub-issue `parent` (with ITS milestone, so the inheritance
 * check needs no second call), plus the item's date field values so the
 * «Start date» / «Target date» roadmap columns are read in the SAME scan. One
 * board sweep feeds both the PR-board hygiene and the roadmap-hygiene sections.
 * @param {string|null} [after]
 */
/**
 * Page size of the per-item `labels` connection in the board-items query. An
 * Issue carrying MORE labels than this is read incompletely, which silently
 * changes how `classifyIssueTaxonomy` sees it — so the page size is a named
 * constant and the parser compares it against the connection's `totalCount`.
 */
export const LABELS_PAGE_SIZE = 30;

/**
 * Page size of the per-item `fieldValues` connection. Under-reading it hides a
 * «Start date» / «Target date» value and manufactures a false `missing-dates`
 * finding, so it is checked the same way.
 */
export const FIELD_VALUES_PAGE_SIZE = 20;

export function buildBoardItemsPageQuery(after = null) {
  let cursor = "";
  if (after != null) {
    assertSafeLiteral("cursor", after);
    cursor = `,after:"${after}"`;
  }
  return (
    `query{organization(login:"${OWNER}"){projectV2(number:${PROJECT_NUMBER}){` +
    `items(first:100${cursor}){pageInfo{hasNextPage endCursor} nodes{id ` +
    `fieldValues(first:${FIELD_VALUES_PAGE_SIZE}){totalCount ` +
    `nodes{... on ProjectV2ItemFieldDateValue{date ` +
    `field{... on ProjectV2FieldCommon{name}}}}} ` +
    `content{__typename ... on PullRequest{number state ` +
    `assignees(first:1){totalCount} milestone{title}} ` +
    `... on Issue{number state title milestone{title} ` +
    `labels(first:${LABELS_PAGE_SIZE}){totalCount nodes{name}} ` +
    `parent{number milestone{title}}}}}}}}}`
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
  const nodes = Array.isArray(items.nodes) ? items.nodes : [];
  const truncations = [];
  for (const node of nodes) truncations.push(...boardNodeTruncations(node));
  return {
    nodes,
    truncations,
    hasNextPage: !!items.pageInfo?.hasNextPage,
    endCursor: items.pageInfo?.endCursor ?? null,
  };
}

/**
 * @typedef {object} BoardConnectionTruncation
 * @property {number|null} number   Issue/PR number the item points at, null when unknown
 * @property {"labels"|"fieldValues"} connection
 * @property {number} totalCount    what the API says the connection holds
 * @property {number} pageSize      what the query actually asked for
 */

/**
 * The connections of ONE board-items node that were read short — the API's
 * `totalCount` exceeds the page size the query asked for. Without this the scan
 * under-reads labels and date values in silence, and the roadmap-hygiene
 * findings computed from it are wrong in a way nothing surfaces.
 * @param {any} node one element of `projectV2.items.nodes`
 * @returns {BoardConnectionTruncation[]}
 */
export function boardNodeTruncations(node) {
  const number =
    typeof node?.content?.number === "number" ? node.content.number : null;
  const out = [];
  const check = (connection, conn, pageSize) => {
    const totalCount = conn?.totalCount;
    if (typeof totalCount !== "number") return;
    if (totalCount <= pageSize) return;
    out.push({ number, connection, totalCount, pageSize });
  };
  check("fieldValues", node?.fieldValues, FIELD_VALUES_PAGE_SIZE);
  check("labels", node?.content?.labels, LABELS_PAGE_SIZE);
  return out;
}

/**
 * One-line WARN text for a truncated connection — the wording triage prints.
 * @param {BoardConnectionTruncation} t
 */
export function formatBoardTruncation(t) {
  const who = typeof t?.number === "number" ? `#${t.number}` : "(unknown item)";
  return `${who}: ${t.connection} truncated (totalCount ${t.totalCount} > page ${t.pageSize})`;
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
