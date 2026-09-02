/**
 * tools/gh/lib/roadmap-taxonomy.mjs — the ONE shared implementation of the
 * roadmap Issue taxonomy (#1729, Stage 3).
 *
 * Why this exists: three call sites classify the same Issue shapes — `pnpm
 * issue:create` (fail-closed creation gates), `pnpm backlog:triage` (the
 * `## Roadmap hygiene` WARN section) and `pnpm bootstrap` (the matching
 * `## Warnings` rows). A copy of the "what is an epic / a feature / an EARS
 * task" rule in each would drift, so the taxonomy lives here once and every
 * consumer reads it.
 *
 * Canon: `apps/docs/content/specs/tech/2026-05-21-dsp-198-github-projects-v2-board-design.md`
 * §7.1 (taxonomy table + Naming / Epic / Release-gate rules).
 *
 *   kind          | title shape              | milestone            | board dates
 *   ------------- | ------------------------ | -------------------- | -----------
 *   epic          | `epic: …`                | NONE (spans releases)| none
 *   feature       | `[Академия][NNN] …`      | the track release    | Start+Target
 *                 | `[Витрина][NNN] …`       |                      |
 *   ears-task     | `[NNN] EARS-k: …`        | INHERITED from parent| none
 *   release-gate  | `gate: <milestone name>` | the gated release    | Start+Target
 *   platform-task | no prefix                | via blocked_by, else | none
 *                 |                          | «Platform ops & hardening»
 *
 * Everything here is PURE (no I/O, no process exit) so both the .mjs and the
 * .ts consumers can import it and the classifiers are unit-tested directly.
 */

/** The `kind:*` label that marks an EARS handler task (spec §7.1). */
export const EARS_KIND_LABEL = "kind:ears-handler";

/** Title prefix of an epic container Issue. */
export const EPIC_TITLE_PREFIX = "epic:";

/** Title prefix of a release-gate Issue. */
export const RELEASE_GATE_TITLE_PREFIX = "gate:";

/** The standing fallback milestone for ops/process Issues (#1137). */
export const FALLBACK_MILESTONE = "Platform ops & hardening";

/**
 * Track label ↔ the Russian milestone-name prefix of that track's releases.
 * `track:platform` has no track release prefix — it homes on the fallback
 * milestone — so it is deliberately absent.
 */
export const TRACK_MILESTONE_PREFIXES = Object.freeze({
  "track:academy": "Академия",
  "track:doctor": "Витрина",
});

/**
 * Feature title prefix ↔ the track label that prefix implies.
 * `[Академия][NNN] …` is an academy feature, `[Витрина][NNN] …` a showcase one.
 */
export const FEATURE_TITLE_TRACKS = Object.freeze({
  "[Академия]": "track:academy",
  "[Витрина]": "track:doctor",
});

/** Normalise an arbitrary value into a trimmed string (never null/undefined). */
function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

/** Does the title mark an epic container (`epic: …`)? Case-insensitive. */
export function isEpicTitle(title) {
  return str(title).toLowerCase().startsWith(EPIC_TITLE_PREFIX);
}

/** Does the title mark a release gate (`gate: …`)? Case-insensitive. */
export function isReleaseGateTitle(title) {
  return str(title).toLowerCase().startsWith(RELEASE_GATE_TITLE_PREFIX);
}

/**
 * The feature title prefix (`[Академия]` / `[Витрина]`) this title carries, or
 * null when it is not a feature-level title.
 * @param {string} title
 * @returns {string|null}
 */
export function featureTitlePrefix(title) {
  const t = str(title);
  for (const prefix of Object.keys(FEATURE_TITLE_TRACKS)) {
    if (t.startsWith(prefix)) return prefix;
  }
  return null;
}

/**
 * The track a milestone name belongs to, from its Russian prefix («Академия …»
 * → `track:academy`, «Витрина …» → `track:doctor`). Null for the fallback
 * milestone and anything else that is not a track release.
 * @param {string|null|undefined} milestoneTitle
 * @returns {string|null}
 */
export function milestoneTrack(milestoneTitle) {
  const m = str(milestoneTitle);
  if (!m) return null;
  for (const [label, prefix] of Object.entries(TRACK_MILESTONE_PREFIXES)) {
    if (m.startsWith(prefix)) return label;
  }
  return null;
}

/**
 * Classify one Issue into the spec §7.1 taxonomy. Order matters: an epic title
 * wins over everything (an epic never carries a feature prefix), then the
 * release gate, then the EARS kind label, then the feature title prefix;
 * anything left is a platform task.
 * @param {{title?:string, labels?:string[]}} issue
 * @returns {"epic"|"release-gate"|"ears-task"|"feature"|"platform-task"}
 */
export function classifyIssueTaxonomy(issue) {
  const title = str(issue?.title);
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  if (isEpicTitle(title)) return "epic";
  if (isReleaseGateTitle(title)) return "release-gate";
  if (labels.includes(EARS_KIND_LABEL)) return "ears-task";
  if (featureTitlePrefix(title)) return "feature";
  return "platform-task";
}

/**
 * Does this taxonomy kind own Start/Target dates on board #1? Feature-level
 * work (features + release gates) is what the roadmap view plots; EARS tasks,
 * epics and platform tasks are deliberately dateless (spec §7.1 Forecast rule).
 * @param {string} kind
 */
export function ownsBoardDates(kind) {
  return kind === "feature" || kind === "release-gate";
}

/**
 * @typedef {object} RoadmapRow  One open Issue, as seen from the board scan.
 * @property {number} number
 * @property {string} title
 * @property {string[]} labels
 * @property {string|null} milestone         milestone title, null when unset
 * @property {{number:number, milestone:string|null}|null} parent  sub-issue parent
 * @property {string|null} startDate         board «Start date» value (ISO), null when unset
 * @property {string|null} targetDate        board «Target date» value (ISO), null when unset
 */

/**
 * @typedef {object} RoadmapFinding
 * @property {number} number
 * @property {"parent-milestone"|"missing-dates"|"ears-no-parent"|"track-milestone"} rule
 * @property {string} message
 */

/** Human labels for the four hygiene rules — one wording, both renderers. */
export const ROADMAP_RULES = Object.freeze({
  "parent-milestone": "child milestone ≠ parent milestone",
  "missing-dates": "feature-level Issue without Start/Target date",
  "ears-no-parent": "`kind:ears-handler` without a parent",
  "track-milestone": "track label names a different track than the milestone",
});

/**
 * The roadmap-hygiene findings for one open Issue (spec §7.1). Pure — board
 * rows in, findings out. An Issue can trip more than one rule; each is its own
 * finding so the counts per rule stay honest.
 * @param {RoadmapRow} row
 * @returns {RoadmapFinding[]}
 */
export function roadmapFindingsFor(row) {
  const findings = [];
  const number = row?.number;
  if (typeof number !== "number") return findings;
  const kind = classifyIssueTaxonomy(row);
  const milestone = str(row?.milestone) || null;
  const parent = row?.parent ?? null;
  const labels = Array.isArray(row?.labels) ? row.labels : [];

  // (a) A child's milestone must equal its parent's — EARS tasks and any other
  //     sub-issue inherit the feature's release (spec §7.1 Epic rule).
  if (parent && typeof parent.number === "number") {
    const parentMilestone = str(parent.milestone) || null;
    if (parentMilestone && milestone !== parentMilestone)
      findings.push({
        number,
        rule: "parent-milestone",
        message:
          `milestone «${milestone ?? "(unset)"}» ≠ parent #${parent.number} ` +
          `milestone «${parentMilestone}»`,
      });
  }

  // (b) Feature-level work carries the roadmap dates the Roadmap view plots.
  if (ownsBoardDates(kind)) {
    const missing = [];
    if (!str(row?.startDate)) missing.push("Start date");
    if (!str(row?.targetDate)) missing.push("Target date");
    if (missing.length > 0)
      findings.push({
        number,
        rule: "missing-dates",
        message: `${kind} Issue without ${missing.join(" + ")} on board #1`,
      });
  }

  // (c) An EARS task inherits its feature's milestone — it is meaningless
  //     without the parent that supplies it.
  if (labels.includes(EARS_KIND_LABEL) && !parent)
    findings.push({
      number,
      rule: "ears-no-parent",
      message: `\`${EARS_KIND_LABEL}\` with no parent feature Issue`,
    });

  // (d) The track label and the track release milestone must agree.
  const msTrack = milestoneTrack(milestone);
  if (msTrack) {
    const trackLabels = labels.filter((l) => l.startsWith("track:"));
    for (const label of trackLabels) {
      if (label !== msTrack)
        findings.push({
          number,
          rule: "track-milestone",
          message: `label \`${label}\` but milestone «${milestone}» belongs to \`${msTrack}\``,
        });
    }
  }

  return findings;
}

/**
 * All findings across the open board rows, sorted by Issue number then rule.
 * @param {RoadmapRow[]} rows
 * @returns {RoadmapFinding[]}
 */
export function roadmapHygiene(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    out.push(...roadmapFindingsFor(row));
  }
  return out.sort(
    (a, b) => a.number - b.number || a.rule.localeCompare(b.rule),
  );
}

/**
 * Render the `## Roadmap hygiene` report section. Silent (empty string) when
 * every open Issue is compliant — mirrors `formatFieldHygiene`'s convention.
 * @param {RoadmapFinding[]} findings
 * @returns {string}
 */
export function formatRoadmapHygiene(findings) {
  const list = Array.isArray(findings) ? findings : [];
  if (list.length === 0) return "";
  const out = [
    `## Roadmap hygiene (${list.length})`,
    "Open Issues deviating from the roadmap taxonomy (spec §7.1 — `2026-05-21-dsp-198-github-projects-v2-board-design.md`): milestone inheritance, feature-level roadmap dates, EARS parentage, track ↔ milestone agreement. `pnpm issue:create --parent <N>` enforces the inheritance at creation; pre-gate Issues surface here.",
  ];
  for (const f of list) out.push(`- #${f.number}: ${f.message}`);
  return out.join("\n");
}

/**
 * The same findings as `{source, message}` warning rows, for the FACTS-ONLY
 * bootstrap `## Warnings` block (#1700 — no recommendation prose).
 * @param {RoadmapFinding[]} findings
 * @returns {Array<{source:string, message:string}>}
 */
export function roadmapHygieneWarnings(findings) {
  return (Array.isArray(findings) ? findings : []).map((f) => ({
    source: `roadmap hygiene #${f.number}`,
    message: f.message,
  }));
}

/**
 * Per-rule counts, for a compact summary line / a return contract.
 * @param {RoadmapFinding[]} findings
 * @returns {Record<string, number>}
 */
export function roadmapRuleCounts(findings) {
  const counts = Object.fromEntries(
    Object.keys(ROADMAP_RULES).map((r) => [r, 0]),
  );
  for (const f of Array.isArray(findings) ? findings : []) {
    if (f?.rule in counts) counts[f.rule] += 1;
  }
  return counts;
}

/**
 * Turn one Projects v2 board-items node into a `RoadmapRow`, or null when the
 * node is not an OPEN Issue. Pure — the pagination + `gh` spawn stay in the
 * calling script, this is the shared shape adapter so triage and bootstrap read
 * the board identically.
 * @param {any} node one element of `projectV2.items.nodes`
 * @returns {RoadmapRow|null}
 */
export function parseIssueBoardNode(node) {
  const content = node?.content;
  if (content?.__typename !== "Issue") return null;
  if (typeof content.number !== "number") return null;
  if (content.state && content.state !== "OPEN") return null;
  const labels = Array.isArray(content.labels?.nodes)
    ? content.labels.nodes.map((l) => l?.name).filter((n) => typeof n === "string")
    : [];
  const parentNumber = content.parent?.number;
  const dates = boardDateValues(node);
  return {
    number: content.number,
    title: str(content.title),
    labels,
    milestone: str(content.milestone?.title) || null,
    parent:
      typeof parentNumber === "number"
        ? {
            number: parentNumber,
            milestone: str(content.parent?.milestone?.title) || null,
          }
        : null,
    startDate: dates.startDate,
    targetDate: dates.targetDate,
  };
}

/** The board «Start date» field name. */
export const START_DATE_FIELD = "Start date";
/** The board «Target date» field name. */
export const TARGET_DATE_FIELD = "Target date";

/**
 * Read the Start/Target date field values off a board item's `fieldValues`.
 * @param {any} node
 * @returns {{startDate:string|null, targetDate:string|null}}
 */
export function boardDateValues(node) {
  const nodes = node?.fieldValues?.nodes;
  let startDate = null;
  let targetDate = null;
  for (const fv of Array.isArray(nodes) ? nodes : []) {
    const name = fv?.field?.name;
    const date = typeof fv?.date === "string" ? fv.date : null;
    if (!date) continue;
    if (name === START_DATE_FIELD) startDate = date;
    else if (name === TARGET_DATE_FIELD) targetDate = date;
  }
  return { startDate, targetDate };
}
