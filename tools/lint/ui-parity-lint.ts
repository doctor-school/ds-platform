#!/usr/bin/env tsx
/** BLOCK guard for approved-source UI parity evidence (Issue #1627). */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";
import {
  evidenceProfilesForPaths,
  isUiSourcePath,
  type UiEvidenceProfile,
} from "./lib/ui-surface";

const TAG = "[ui-parity]";
const MANIFEST_PATH = "tools/lint/ui-approved-sources.json";
const DEFAULT_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : DEFAULT_REPO_ROOT;
const MODE_A_HEADER_RE = /^## Mode \(a\) Review\b/im;
const MODE_A_VERDICT_RE = /^VERDICT:\s*(?:APPROVE|REQUEST_CHANGES)\b/im;

export interface ApprovedSourceEntry {
  evidenceProfiles: UiEvidenceProfile[];
  surfacePaths: string[];
  states: string[];
  approvalProvenance: string[];
}
export interface ApprovedSourceManifest {
  version: 1;
  sources: Record<string, ApprovedSourceEntry>;
}
interface GhReview {
  body?: string;
  submittedAt?: string;
  commit?: { oid?: string } | null;
}
interface GhPR {
  number: number;
  body?: string;
  headRefOid?: string;
  files?: { path: string }[];
  reviews?: GhReview[];
}
type Verdict = { ok: boolean; missing: string[] };
/** An N/A claim is only adjudicated when the author actually made one. */
type NaVerdict = Verdict & { claimed: boolean };

function marker(body: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    body
      .match(new RegExp(`^[ \\t>*-]*${escaped}\\s*:\\s*(.+?)\\s*$`, "im"))?.[1]
      ?.trim() ?? null
  );
}
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isArtifactLink(value: string | null): boolean {
  return Boolean(value && /https?:\/\/\S+/i.test(value));
}
function canvasPath(source: string, repoRoot: string): string | null {
  if (!/^design-source\/[A-Za-z0-9._/-]+\.dc\.html$/i.test(source)) return null;
  const absolute = resolve(repoRoot, source);
  const inside = relative(resolve(repoRoot, "design-source"), absolute);
  return Boolean(inside) &&
    !inside.startsWith("..") &&
    existsSync(absolute) &&
    statSync(absolute).isFile()
    ? absolute
    : null;
}
function canvasDeclaresState(path: string, state: string): boolean {
  const pair = /^([A-Za-z_$][\w$-]*)=([A-Za-z0-9_$.-]+)$/.exec(state);
  if (!pair)
    return (
      state.length >= 8 &&
      !/^(?:inspected|checked|tbd|todo|n\/?a|none)$/i.test(state)
    );
  const html = readFileSync(path, "utf8");
  return new RegExp(
    `\\b${escapeRe(pair[1])}\\s*:\\s*['"]${escapeRe(pair[2])}['"]`,
  ).test(html);
}
function pathFitsScope(path: string, scope: string): boolean {
  return scope.endsWith("/") ? path.startsWith(scope) : path === scope;
}
function validEntry(
  entry: ApprovedSourceEntry | undefined,
): entry is ApprovedSourceEntry {
  const profiles = entry?.evidenceProfiles ?? [];
  return Boolean(
    entry &&
    profiles.length &&
    new Set(profiles).size === profiles.length &&
    profiles.every(
      (profile) => profile === "native-mobile" || profile === "responsive-web",
    ) &&
    entry.surfacePaths.length &&
    entry.states.length &&
    entry.approvalProvenance.length &&
    entry.approvalProvenance.every((url) =>
      /^https:\/\/github\.com\/doctor-school\/ds-platform\/issues\/\d+#issuecomment-\d+$/.test(
        url,
      ),
    ),
  );
}

export function readBaseApprovedSources(
  repoRoot = REPO_ROOT,
): ApprovedSourceManifest {
  const fixture = process.env.UI_APPROVED_SOURCES_BASE_FILE;
  if (fixture)
    return JSON.parse(
      readFileSync(resolve(fixture), "utf8"),
    ) as ApprovedSourceManifest;
  const base = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : "origin/main";
  const result = spawnSync("git", ["show", `${base}:${MANIFEST_PATH}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return { version: 1, sources: {} };
  return JSON.parse(result.stdout) as ApprovedSourceManifest;
}

const PROFILE_MARKERS: Record<UiEvidenceProfile, string[]> = {
  "responsive-web": [
    "desktop-light",
    "desktop-dark",
    "mobile-light",
    "mobile-dark",
  ],
  "native-mobile": ["phone-light", "phone-dark", "tablet-light", "tablet-dark"],
};

function declaredProfiles(body: string): UiEvidenceProfile[] {
  const value = marker(body, "ui-evidence-profile") ?? "";
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(
      (part): part is UiEvidenceProfile =>
        part === "responsive-web" || part === "native-mobile",
    )
    .sort();
}

export function bodyEvidenceVerdict(
  body: string,
  repoRoot = REPO_ROOT,
  changedPaths: string[] = [],
  baseManifest?: ApprovedSourceManifest,
): Verdict {
  const missing: string[] = [];
  const uiPaths = changedPaths.filter(isUiSourcePath);
  const requiredProfiles = evidenceProfilesForPaths(uiPaths);
  const submittedProfiles = declaredProfiles(body);
  if (requiredProfiles.join(",") !== submittedProfiles.join(","))
    missing.push(`ui-evidence-profile exactly ${requiredProfiles.join(", ")}`);

  const kind = marker(body, "ui-source-kind");
  const source = marker(body, "ui-source");
  const state = marker(body, "ui-source-state");
  if (kind === "canvas") {
    const path = source ? canvasPath(source, repoRoot) : null;
    if (!path)
      missing.push("existing exact ui-source: design-source/*.dc.html");
    else if (!state || !canvasDeclaresState(path, state))
      missing.push(
        "ui-source-state declared by the canvas when expressed as key=value",
      );
  } else if (kind === "approved-non-canvas") {
    const manifest = baseManifest ?? readBaseApprovedSources(repoRoot);
    const entry = source ? manifest.sources[source] : undefined;
    if (!validEntry(entry))
      missing.push("ui-source id approved in the base manifest");
    else {
      if (!state || !entry.states.includes(state))
        missing.push("ui-source-state declared by the approved manifest entry");
      if (
        uiPaths.some(
          (path) =>
            !entry.surfacePaths.some((scope) => pathFitsScope(path, scope)),
        )
      )
        missing.push(
          "every touched UI path inside the approved manifest surface scope",
        );
      const approvedProfiles = [...entry.evidenceProfiles].sort();
      if (requiredProfiles.join(",") !== approvedProfiles.join(","))
        missing.push(
          "evidence profiles exactly matching the approved manifest entry",
        );
    }
  } else missing.push("ui-source-kind: canvas or approved-non-canvas");

  const renderNames = requiredProfiles.flatMap(
    (profile) => PROFILE_MARKERS[profile],
  );
  const links: string[] = [];
  for (const suffix of renderNames) {
    const value = marker(body, `ui-render-${suffix}`);
    if (!isArtifactLink(value))
      missing.push(`ui-render-${suffix} evidence link`);
    else links.push(value!.match(/https?:\/\/\S+/i)![0]);
  }
  if (new Set(links).size !== links.length)
    missing.push("distinct profile-specific render evidence links");
  const interactions = marker(body, "ui-interactions");
  const reasonedNa = Boolean(
    interactions &&
    /^n\/?a\b/i.test(interactions) &&
    /no interactive (?:elements|controls|states)/i.test(interactions),
  );
  if (!isArtifactLink(interactions) && !reasonedNa)
    missing.push(
      "driven interaction-state evidence link or reasoned non-interactive N/A",
    );
  return { ok: missing.length === 0, missing };
}

/**
 * The LATEST structured `## Mode (a) Review` by submission time — the same
 * selection both the comparison verdict and the reviewer-certified N/A path
 * pin on. Unstructured drive-by reviews (no header, no `VERDICT:`) are ignored.
 */
export function latestModeAReview(
  reviews: GhReview[] | null | undefined,
): GhReview | null {
  return (
    (reviews ?? [])
      .filter(
        (review) =>
          MODE_A_HEADER_RE.test(review.body ?? "") &&
          MODE_A_VERDICT_RE.test(review.body ?? ""),
      )
      .sort(
        (a, b) =>
          Date.parse(b.submittedAt ?? "1970-01-01") -
          Date.parse(a.submittedAt ?? "1970-01-01"),
      )[0] ?? null
  );
}

/**
 * Reviewer-certified N/A path (Issue #1708).
 *
 * A diff can touch an `isUiSourcePath` file and still produce no rendered-output
 * delta (a behavioral-only edit inside a render-capable file). Demanding the
 * full canvas/manifest evidence set there forces fabricated evidence, so the
 * guard accepts the body marker
 *
 *     ui-parity: N/A (no render delta) — <reason>
 *
 * ONLY when the latest structured Mode (a) review, pinned to the CURRENT head
 * SHA (same invalidate-on-rework rule as the merge gate), itself carries an
 * explicit `render-delta: none` certification line. An author-asserted N/A with
 * no such reviewer line stays FAIL — the author cannot self-certify.
 */
export function certifiedNaVerdict(
  prBody: string,
  reviews: GhReview[] | null | undefined,
  headSha: string | null | undefined,
): NaVerdict {
  const claim = marker(prBody, "ui-parity");
  if (!claim || !/^n\/?a\b/i.test(claim))
    return { claimed: false, ok: false, missing: [] };
  const missing: string[] = [];
  const reason = /^n\/a\s*\(no render delta\)\s*[—-]\s*(.+)$/i.exec(
    claim.replace(/^n\/?a/i, "N/A"),
  )?.[1];
  if (!reason || reason.trim().length < 12)
    missing.push(
      "marker exactly `ui-parity: N/A (no render delta) — <reason>` with a stated reason",
    );
  const latest = latestModeAReview(reviews);
  if (!latest) missing.push("latest structured Mode (a) review");
  else {
    const oid = latest.commit?.oid ?? "";
    if (!headSha || oid !== headSha)
      missing.push(
        `Mode (a) review pinned to the current head ${headSha || "(unresolved)"}`,
      );
    if (marker(latest.body ?? "", "render-delta")?.toLowerCase() !== "none")
      missing.push("reviewer `render-delta: none` certification line");
  }
  return { claimed: true, ok: missing.length === 0, missing };
}

export function latestModeAComparisonVerdict(
  reviews: GhReview[] | null | undefined,
  prBody: string,
): Verdict {
  const latest = latestModeAReview(reviews)?.body ?? "";
  if (!latest)
    return { ok: false, missing: ["latest structured Mode (a) review"] };
  const missing: string[] = [];
  for (const name of [
    "ui-source-kind",
    "ui-source",
    "ui-source-state",
    "ui-evidence-profile",
  ]) {
    const submitted = marker(prBody, name);
    if (!submitted || marker(latest, name) !== submitted)
      missing.push(`comparison against submitted ${name}`);
  }
  const artifacts =
    marker(latest, "ui-artifacts-compared")?.toLowerCase() ?? "";
  for (const profile of declaredProfiles(prBody))
    for (const name of PROFILE_MARKERS[profile])
      if (!artifacts.includes(name))
        missing.push(`${name} artifact comparison`);
  if (!artifacts.includes("interaction"))
    missing.push("interaction artifact comparison");
  const applicability = marker(latest, "ui-source-applicability") ?? "";
  if (
    applicability.length < 24 ||
    !/(?:appl(?:y|ies|icable)|approved|purpose)/i.test(applicability) ||
    !/(?:surface|screen|composition|app|render)/i.test(applicability) ||
    !/(?:purpose|audience|workflow|operator|patient|doctor|catalog|documentation)/i.test(
      applicability,
    )
  )
    missing.push("source applicability/purpose-fit for the touched surface");
  const result = marker(latest, "ui-comparison-result") ?? "";
  if (
    !/\b(?:match|mismatch|diverg)/i.test(result) ||
    !/(?:element-by-element|geometry|presentation|values|states)/i.test(result)
  )
    missing.push("explicit element-level comparison result");
  return { ok: missing.length === 0, missing };
}

function info(message: string): void {
  process.stdout.write(`${TAG} ${message}\n`);
}
function fail(message: string): never {
  process.stderr.write(`${TAG} ${message}\n`);
  process.exit(1);
}

export async function runUiParityGuard(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request")
    return info("not a pull_request event, skipping");
  const prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber) return info("cannot determine PR number, skipping");
  const response = await ghViewJson<GhPR>(
    "pr",
    prNumber,
    "number,body,headRefOid,files,reviews",
    REPO_ROOT,
  );
  if (!response.ok) fail(`could not fetch PR #${prNumber}: ${response.error}`);
  const pr = response.data;
  const paths = (pr.files ?? []).map((file) => file.path);
  if (!paths.some(isUiSourcePath))
    return info(
      `PR #${pr.number} touches no render-capable UI source; rule does not apply`,
    );
  const na = certifiedNaVerdict(pr.body ?? "", pr.reviews, pr.headRefOid);
  if (na.claimed) {
    if (!na.ok)
      fail(
        `PR #${pr.number} asserts ui-parity N/A without reviewer certification: ${na.missing.join("; ")}`,
      );
    return info(
      `PR #${pr.number} ui-parity N/A certified by the latest head-pinned Mode (a) review (render-delta: none)`,
    );
  }
  const bodyVerdict = bodyEvidenceVerdict(pr.body ?? "", REPO_ROOT, paths);
  if (!bodyVerdict.ok)
    fail(
      `PR #${pr.number} lacks approved-source parity evidence: ${bodyVerdict.missing.join("; ")}`,
    );
  if (process.env.UI_PARITY_REQUIRE_REVIEW === "1") {
    const reviewVerdict = latestModeAComparisonVerdict(
      pr.reviews,
      pr.body ?? "",
    );
    if (!reviewVerdict.ok)
      fail(
        `latest Mode (a) review lacks current source comparison: ${reviewVerdict.missing.join("; ")}`,
      );
    return info(
      `PR #${pr.number} latest Mode (a) source comparison evidence OK`,
    );
  }
  info(`PR #${pr.number} approved-source parity body evidence OK`);
}

const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF)
  runUiParityGuard().catch((error) =>
    fail((error as Error).stack ?? String(error)),
  );
