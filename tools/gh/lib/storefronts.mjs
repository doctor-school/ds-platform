// tools/gh/lib/storefronts.mjs — the ONE definition of the storefronts scope
// answer (#3604, #3610), shared by the spec tree guard
// (`tools/lint/storefronts-lint.ts`), the Issue creation gate
// (`tools/gh/create-issue.mjs`) and the grooming report
// (`tools/backlog-triage.ts`), so the three never drift on the vocabulary, the
// placeholder rule or the Issue ↔ spec consistency rule.
//
// Two storefronts — the Academy (`apps/portal`) and the doctor storefront
// (`apps/doctor`) — run on one schema and one database. A spec's frontmatter
// `storefronts:` says which of them a feature covers; an Issue body's
// `Storefronts:` line says which of them that Issue covers. Pure helpers plus
// one read-only file lookup (`specStorefronts`); no network.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { TRACK_LABELS, isEpicTitle } from "./roadmap-taxonomy.mjs";

export const STOREFRONTS_VALUES = [
  "both",
  "academy-only",
  "doctor-only",
  "none",
];
export const STOREFRONTS_FORMS = STOREFRONTS_VALUES.join(" | ");
export const SURFACE_VALUES = ["backend-only", "user-facing"];
export const BLOCK_SCALAR_RE = /^[|>][+-]?\d*$/;
export const STOREFRONTS_PLACEHOLDER_RE =
  /^(?:n\/?a|tbd|todo|none|-+|\?+|<[^>]*>)$/i;

/** The spec folder path under the repo root. */
export const FEATURES_REL = "apps/docs/content/specs/features";

function unquote(v) {
  return v
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, "$2")
    .trim();
}

/**
 * Read `surface:` / `storefronts:` / `storefronts_reason:` from a spec file's
 * YAML frontmatter (one-line values only — a block scalar comes back as its
 * `|` / `>` indicator, which `declaredFindings` refuses).
 * @param {string} text
 * @returns {{surface: string|null, storefronts: string|null, reason: string|null}}
 */
export function readSpecFields(text) {
  const norm = text.replace(/\r\n/g, "\n");
  const fm = norm.match(/^---\n([\s\S]*?)\n---/);
  const scope = fm ? fm[1] : "";
  const field = (name) => {
    const m = scope.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "m"));
    return m ? unquote(m[1]) : null;
  };
  return {
    surface: field("surface"),
    storefronts: field("storefronts"),
    reason: field("storefronts_reason"),
  };
}

/**
 * The findings for one `surface: user-facing` spec file's declaration.
 * @param {string} rel  repo-relative path, for the message
 * @param {{storefronts: string|null, reason: string|null}} d
 * @returns {string[]}
 */
export function declaredFindings(rel, d) {
  if (d.storefronts === null || d.storefronts === "") {
    return [
      `${rel}: \`surface: user-facing\` but no \`storefronts:\` — declare \`storefronts: ${STOREFRONTS_FORMS}\` (any value but \`both\` with a \`storefronts_reason:\`).`,
    ];
  }
  if (!STOREFRONTS_VALUES.includes(d.storefronts)) {
    return [
      `${rel}: \`storefronts: ${d.storefronts}\` is not one of \`${STOREFRONTS_FORMS}\`.`,
    ];
  }
  if (d.storefronts === "both") {
    return d.reason !== null && d.reason !== ""
      ? [
          `${rel}: \`storefronts: both\` with a \`storefronts_reason:\` is a contradiction — a reason records why ONE storefront (or none) is in scope; drop it or narrow the value.`,
        ]
      : [];
  }
  if (d.reason === null || d.reason === "") {
    return [
      `${rel}: \`storefronts: ${d.storefronts}\` needs \`storefronts_reason:\` — say what the other storefront does instead (which spec covers it, or which open Issue re-scopes it).`,
    ];
  }
  if (BLOCK_SCALAR_RE.test(d.reason)) {
    return [
      `${rel}: \`storefronts_reason: ${d.reason}\` is a YAML block scalar — write the reason as one quoted line.`,
    ];
  }
  if (STOREFRONTS_PLACEHOLDER_RE.test(d.reason)) {
    return [
      `${rel}: \`storefronts_reason: ${d.reason}\` is a placeholder — write the real reason.`,
    ];
  }
  return [];
}

/**
 * The `Storefronts:` line of an Issue body (`.github/ISSUE_TEMPLATE/*.md`):
 * `both`, or `academy-only` / `doctor-only` / `none` followed by `: <reason>`.
 * Bold and list-marker tolerant, like the `Reuse:` field.
 */
const ISSUE_FIELD_RE =
  /^[ \t>*-]*(?:\*\*)?storefronts(?:\*\*)?[ \t]*:[ \t]*(?:\*\*)?[ \t]*(?:(both)\b[ \t\r]*$|(academy-only|doctor-only|none)[ \t]*:[ \t]*(.*\S)[ \t\r]*$)/gim;

/**
 * The first valid `Storefronts:` line of an Issue body, or null when there is
 * none (absent, malformed, or a single-host value with a placeholder reason).
 * @param {string|null|undefined} body
 * @returns {{value: string, reason: string|null}|null}
 */
export function parseIssueStorefronts(body) {
  for (const m of (body ?? "").matchAll(ISSUE_FIELD_RE)) {
    if (m[1]) return { value: "both", reason: null };
    const reason = (m[3] ?? "").trim();
    if (reason && !STOREFRONTS_PLACEHOLDER_RE.test(reason))
      return { value: m[2].toLowerCase(), reason };
  }
  return null;
}

/**
 * Is the Issue in scope of the `Storefronts:` line requirement? The ONE scope
 * predicate shared by the creation gate (`pnpm issue:create`) and the grooming
 * report (`pnpm backlog:triage`): a tracked (`track:*`) Issue that is not an
 * `epic: …` container (its children carry the line) and not bot-maintained
 * (Renovate rewrites its Dependency Dashboard body, so a hand-added line
 * cannot persist).
 * @param {{labels: string[], title: string, author?: string}} issue
 * @returns {boolean}
 */
export function requiresStorefrontsLine({ labels, title, author }) {
  if (!(labels ?? []).some((l) => TRACK_LABELS.includes(l.trim())))
    return false;
  if (isEpicTitle(title)) return false;
  if (/^app\/.*renovate/i.test(author ?? "")) return false;
  if ((title ?? "").trim() === "Dependency Dashboard") return false;
  return true;
}

/**
 * The three-digit feature number of the first `feature:NNN-*` label.
 * @param {string[]} labels
 * @returns {string|null}
 */
export function featureNumberFromLabels(labels) {
  for (const l of labels ?? []) {
    const m = /^feature:(\d{3})-/.exec(l);
    if (m) return m[1];
  }
  return null;
}

/**
 * A spec's declared `storefronts:` value — the requirements file (plain, else
 * the `-en` half), else the product file (`NNN-product.md`). Returns null when
 * the folder, the file or a valid value is missing: spec validity is the tree
 * guard's job, so a broken spec never adds a second refusal elsewhere.
 * @param {string} featuresDir  absolute path of `apps/docs/content/specs/features`
 * @param {string} num          three-digit feature number
 * @returns {{value: string, file: string}|null}
 */
export function specStorefronts(featuresDir, num) {
  let folder;
  try {
    folder = readdirSync(featuresDir)
      .filter((f) => f.startsWith(`${num}-`))
      .find((f) => statSync(join(featuresDir, f)).isDirectory());
  } catch {
    return null;
  }
  if (!folder) return null;
  const entries = readdirSync(join(featuresDir, folder));
  for (const name of [
    `${num}-requirements.md`,
    `${num}-requirements-en.md`,
    `${num}-product.md`,
  ]) {
    if (!entries.includes(name)) continue;
    let d;
    try {
      d = readSpecFields(readFileSync(join(featuresDir, folder, name), "utf8"));
    } catch {
      return null;
    }
    if (!d.storefronts || !STOREFRONTS_VALUES.includes(d.storefronts))
      return null;
    return { value: d.storefronts, file: `${FEATURES_REL}/${folder}/${name}` };
  }
  return null;
}

const OTHER_HOST = {
  "academy-only": "doctor-only",
  "doctor-only": "academy-only",
};

/**
 * The Issue ↔ spec consistency rule (#3610). An Issue may cover MORE than its
 * spec (a shared-package fix under a single-host spec serves both storefronts
 * — wider coverage is never divergence) and may be `none` under any spec
 * (admin / API / test work), but it never crosses its spec or silently drops
 * half of it:
 *   - spec `none` → the Issue is `none` (a storefront value has no spec page);
 *   - spec single-host → the Issue does not name the OTHER single host;
 *   - spec `both` → a single-host Issue names its sibling Issue (`#N`) in the
 *     reason, so the other storefront's half is never silently dropped. The
 *     check is lexical — any `#N` passes; whether it is an OPEN sibling for
 *     the other storefront is the Mode (a) review's question
 *     (`request-mode-a-review` Pass 2). There is no «why none» escape: if the
 *     other storefront truly needs nothing, the Issue is re-scoped to `both`
 *     (the shared change serves both) or the spec's `storefronts:` is
 *     corrected in a spec PR.
 * @param {{value: string, file: string}} spec
 * @param {{value: string, reason: string|null}} issue
 * @returns {string|null}  the refusal, or null when consistent
 */
export function storefrontsConsistencyError(spec, issue) {
  const s = spec.value;
  const i = issue.value;
  if (s === "none" && i !== "none") {
    return `the spec (${spec.file}) declares \`storefronts: none\` — no storefront page — but the Issue says \`Storefronts: ${i}\`. Write \`Storefronts: none: <reason>\`, or re-scope the spec first.`;
  }
  if (OTHER_HOST[s] && i === OTHER_HOST[s]) {
    return `the spec (${spec.file}) declares \`storefronts: ${s}\` but the Issue says \`Storefronts: ${i}\` — the Issue names the other storefront only. Write \`Storefronts: ${s}: <reason>\` or \`Storefronts: both\` (a shared-package change), or re-scope the spec first.`;
  }
  if (s === "both" && OTHER_HOST[i] && !/#\d+/.test(issue.reason ?? "")) {
    return `the spec (${spec.file}) declares \`storefronts: both\` and the Issue covers only one (\`Storefronts: ${i}\`) without naming the sibling Issue for the other storefront. Cite the existing sibling in the reason (\`#N\`); or open it (\`pnpm issue:create\`) and cite it; or, if the other storefront truly needs nothing, write \`Storefronts: both\` (the shared change serves both) or correct the spec's \`storefronts:\` in a spec PR.`;
  }
  return null;
}
