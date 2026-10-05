/**
 * Change tiers (#2584): risk-proportional procedure per PR.
 *
 *   ship — small reversible presentational change (allowlisted UI / copy /
 *          email / product-doc paths only): no Mode (a) reviewer, no
 *          ui-parity evidence, Stage-B = the owner's head-pinned chat
 *          decision (no live URL).
 *   show — Mode (a) review and ui-parity as for every PR; a Stage-B GO may
 *          cite a PR evidence capture instead of a live staging URL.
 *   ask  — the full procedure, unchanged.
 *
 * The PR body DECLARES a tier (`Change-tier: ship|show|ask — <reason>`); the
 * changed-file set DETERMINES the minimum tier. A declaration below the
 * minimum is refused. Absent or malformed declarations are `ask`, so every PR
 * that does not opt in keeps today's behaviour byte-for-byte.
 *
 * Pure on purpose: `tools/gh/merge-gate.mjs` loads this file through Node's
 * native type stripping, the lint guards through tsx — one rule for every
 * gate. Its only import (`ui-surface.ts`, itself import-free) carries the
 * explicit `.ts` extension native type stripping needs.
 */

import { isUiSourcePath } from "./ui-surface.ts";

export type ChangeTier = "ship" | "show" | "ask";

/** One changed file, normalised from `gh pr view --json files` or the REST
 * `pulls/<n>/files` listing. */
export interface ChangeTierFile {
  path: string;
  /** `modified` | `added` | `removed` | `renamed` | … (lower-case). */
  status: string;
  additions: number;
  deletions: number;
  /** Rename source, when the listing reports one. */
  previousPath?: string;
}

export interface ChangeTierClassification {
  minimum: ChangeTier;
  reasons: string[];
}

export interface ResolvedTier {
  declared: ChangeTier;
  minimum: ChangeTier;
  /** `declared` when it is at or above `minimum`; `null` = BLOCK. */
  effective: ChangeTier | null;
  reasons: string[];
}

const ORDER: Record<ChangeTier, number> = { ship: 0, show: 1, ask: 2 };

export const SHIP_LINE_CAP = 80;

/**
 * Email copy/template files under `apps/api` whose edits are wording, not
 * behaviour: the auth code mails (003 EARS-29), the notice mails incl. the
 * congress 044 confirmation / 046 receipt letters, and the e2e subject mirror
 * that `code-emails.ts` requires to change in the same PR.
 */
export const API_COPY_ALLOWLIST: readonly string[] = [
  "apps/api/src/mailer/code-emails.ts",
  "apps/api/src/mailer/notice-emails.ts",
  "apps/api/test/support/notification-subjects.ts",
];

const ASK_PATH_RES: readonly RegExp[] = [
  /^packages\/(?:db|schemas|api-client)\//,
  /^apps\/api\//,
  /^(?:infra|tools|\.github|\.claude|\.codex|scripts)\//,
  /(?:^|\/)design-source\//,
  /^apps\/docs\/content\/(?:specs|adr|skills)\//,
  /^(?:AGENTS|CLAUDE)\.md$/,
  /(?:^|\/)package\.json$/,
  /^(?:pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json)$/,
  /(?:^|\/)[^/]*\.config\.[^/]+$/,
  /(?:^|\/)Dockerfile[^/]*$/,
  /(?:^|\/)docker-compose[^/]*$/,
  /(?:^|\/)\.env[^/]*$/,
  /(?:^|\/)(?:middleware|proxy)\.[^/]+$/,
  /(?:^|\/)migrations\//,
  /^apps\/docs\/content\/agent-discipline\.md$/,
];

/**
 * Ship is an ALLOWLIST: every changed non-test file must be presentational —
 * UI source, a copy module, an allowlisted email file or a plain product doc.
 * Anything else floors at show.
 */
const COPY_MODULE_RE =
  /^packages\/[^/]+\/src\/(?:.*\/)?(?:copy\.ts|[^/]+-copy\.ts|copy\/.+)$/;
const PRODUCT_DOC_RE = /^apps\/docs\/content\/.+\.mdx?$/;
const PROCEDURE_DOC_RE =
  /^apps\/docs\/content\/(?:(?:specs|adr|skills)\/|agent-discipline\.md$)/;

/**
 * UI-shaped files that still carry server, routing or auth behaviour: never
 * ship, whatever their extension says.
 */
const SERVER_ROUTE_RES: readonly RegExp[] = [
  /(?:^|\/)server\//,
  /(?:^|\/)actions\//,
  /(?:^|\/)[^/]*action[^/]*\.[cm]?[jt]sx?$/i,
  /(?:^|\/)app\/(?:.*\/)?(?:page|layout|route|template|default|loading|error|not-found|global-error)\.(?:ts|tsx|js|jsx)$/,
  /(?:^|\/)lib\/(?:.*\/)?[^/]*auth/i,
  /(?:^|\/)(?:proxy|middleware|instrumentation)\.[^/]+$/,
];

function isCopyModule(path: string): boolean {
  return COPY_MODULE_RE.test(path);
}

function isServerOrRoutePath(path: string): boolean {
  if (SERVER_ROUTE_RES.some((re) => re.test(path))) return true;
  const authSegment = path.split("/").some((segment) => /auth/i.test(segment));
  return authSegment && !/\/src\/ui\//.test(path) && !isCopyModule(path);
}

/** A non-test, non-changeset path that may change under ship. */
export function isShipPath(path: string): boolean {
  if (API_COPY_ALLOWLIST.includes(path)) return true;
  if (PRODUCT_DOC_RE.test(path)) return !PROCEDURE_DOC_RE.test(path);
  if (isServerOrRoutePath(path)) return false;
  return isCopyModule(path) || isUiSourcePath(path);
}

/** Test sources: excluded from the ship size cap and may be added. */
export function isTestPath(path: string): boolean {
  return /\.(?:test|spec|e2e-spec)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\/|(?:^|\/)e2e\//.test(
    path,
  );
}

function isChangesetPath(path: string): boolean {
  return /^\.changeset\/[^/]+\.md$/.test(path);
}

export function isAskPath(path: string): boolean {
  if (API_COPY_ALLOWLIST.includes(path)) return false;
  return ASK_PATH_RES.some((re) => re.test(path));
}

export function classifyChangeTier(
  files: ChangeTierFile[],
  expectedCount?: number,
): ChangeTierClassification {
  if (!files.length)
    return { minimum: "ask", reasons: ["no changed-file set to classify"] };
  if (expectedCount !== undefined && files.length !== expectedCount)
    return {
      minimum: "ask",
      reasons: [
        `incomplete changed-file set (${files.length} of ${expectedCount})`,
      ],
    };
  const ask: string[] = [];
  const show: string[] = [];
  let lines = 0;
  for (const file of files) {
    for (const path of [file.path, file.previousPath].filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    ))
      if (isAskPath(path)) ask.push(`ask path: ${path}`);
    const exempt = isTestPath(file.path) || isChangesetPath(file.path);
    if (exempt) {
      if (file.status !== "modified" && file.status !== "added")
        show.push(`${file.status || "unknown-status"} file: ${file.path}`);
      continue;
    }
    if (file.status !== "modified")
      show.push(`${file.status || "unknown-status"} file: ${file.path}`);
    if (!isShipPath(file.path))
      show.push(`not a ship path (UI/copy/email/product doc): ${file.path}`);
    lines += (file.additions || 0) + (file.deletions || 0);
  }
  if (lines > SHIP_LINE_CAP)
    show.push(
      `${lines} changed lines in non-test files (ship cap ${SHIP_LINE_CAP})`,
    );
  if (ask.length) return { minimum: "ask", reasons: ask };
  if (show.length) return { minimum: "show", reasons: show };
  return {
    minimum: "ship",
    reasons: [`${files.length} modified file(s), ${lines} line(s)`],
  };
}

/** `Change-tier: ship|show|ask — <reason>`; anything else ⇒ `ask`. */
export function parseDeclaredTier(body: string): ChangeTier {
  const lines = [...(body ?? "").matchAll(/^[ \t]*Change-tier:[ \t]*(.*)$/gim)];
  if (lines.length !== 1) return "ask";
  const match = /^(ship|show|ask)\b[ \t]*(?:[-–—:][ \t]*(.*))?$/i.exec(
    lines[0][1].trim(),
  );
  if (!match) return "ask";
  const tier = match[1].toLowerCase() as ChangeTier;
  if (tier === "ask") return "ask";
  const reason = (match[2] ?? "").trim();
  if (!reason || /^(?:n\/a|none|tbd|todo|<.*>)$/i.test(reason)) return "ask";
  return tier;
}

export function resolveTier(
  prBody: string,
  files: ChangeTierFile[],
  expectedCount?: number,
): ResolvedTier {
  const declared = parseDeclaredTier(prBody);
  const { minimum, reasons } = classifyChangeTier(files, expectedCount);
  return {
    declared,
    minimum,
    effective: ORDER[declared] >= ORDER[minimum] ? declared : null,
    reasons,
  };
}

/** Accepts the `gh pr view --json files` shape (`path`, `changeType`) or the
 * REST shape (`filename`, `status`, `previous_filename`). */
export function normalizeTierFiles(
  raw: ReadonlyArray<Record<string, unknown>>,
): ChangeTierFile[] {
  return raw.map((file) => {
    const path = String(file.path ?? file.filename ?? "");
    const status = String(file.status ?? file.changeType ?? "").toLowerCase();
    const previous = file.previous_filename ?? file.previousPath;
    return {
      path,
      status,
      additions: Number(file.additions) || 0,
      deletions: Number(file.deletions) || 0,
      ...(typeof previous === "string" && previous
        ? { previousPath: previous }
        : {}),
    };
  });
}
