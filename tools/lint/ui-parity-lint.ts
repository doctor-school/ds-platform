#!/usr/bin/env tsx
/** BLOCK guard for the approved-source parity evidence contract (Issue #1627). */
import { existsSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";
import { isUiSourcePath } from "./lib/ui-surface";

const TAG = "[ui-parity]";
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
const PLACEHOLDER_RE =
  /^(?:inspected|checked|tbd|todo|n\/?a|none|same|approved)$/i;

interface GhReview {
  body?: string;
  submittedAt?: string;
}
interface GhPR {
  number: number;
  body?: string;
  files?: { path: string }[];
  reviews?: GhReview[];
}
type Verdict = { ok: boolean; missing: string[] };

function marker(body: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    body
      .match(new RegExp(`^[ \\t>*-]*${escaped}\\s*:\\s*(.+?)\\s*$`, "im"))?.[1]
      ?.trim() ?? null
  );
}

function isArtifactLink(value: string | null): boolean {
  return Boolean(value && /https?:\/\/\S+/i.test(value));
}

function canvasExists(source: string, repoRoot: string): boolean {
  if (!/^design-source\/[A-Za-z0-9._/-]+\.dc\.html$/i.test(source))
    return false;
  const absolute = resolve(repoRoot, source);
  const designRoot = resolve(repoRoot, "design-source");
  const inside = relative(designRoot, absolute);
  return (
    Boolean(inside) &&
    !inside.startsWith("..") &&
    existsSync(absolute) &&
    statSync(absolute).isFile()
  );
}

function exactState(value: string | null): boolean {
  return Boolean(
    value &&
    value.length >= 8 &&
    !PLACEHOLDER_RE.test(value) &&
    /(?:=|:|\/|\bmode\b|\bstate\b|\bcomposition\b|\b(?:loading|empty|filled)\b)/i.test(
      value,
    ),
  );
}

export function bodyEvidenceVerdict(
  body: string,
  repoRoot = REPO_ROOT,
): Verdict {
  const missing: string[] = [];
  const kind = marker(body, "ui-source-kind");
  const source = marker(body, "ui-source");
  const state = marker(body, "ui-source-state");

  if (kind === "canvas") {
    if (!source || !canvasExists(source, repoRoot))
      missing.push("existing exact ui-source: design-source/*.dc.html");
  } else if (kind === "approved-non-canvas") {
    if (
      !source ||
      !/(?:#\d+|https?:\/\/\S+|[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+)/i.test(source)
    )
      missing.push("exact approved artifact/reference in ui-source");
    const reason = marker(body, "ui-source-reason");
    if (
      !reason ||
      reason.length < 24 ||
      !/\b(?:no canvas|non-canvas)\b/i.test(reason) ||
      !/\b(?:approved|composition|artifact|source)\b/i.test(reason)
    )
      missing.push("reasoned approved non-canvas source justification");
    if (
      !state ||
      state.length < 24 ||
      !/\b(?:composition|state|screen|surface)\b/i.test(state)
    )
      missing.push("exact approved non-canvas state/composition");
  } else {
    missing.push("ui-source-kind: canvas or approved-non-canvas");
  }
  if (!exactState(state))
    missing.push("exact ui-source-state/state composition");

  const renderNames = [
    "ui-render-desktop-light",
    "ui-render-desktop-dark",
    "ui-render-mobile-light",
    "ui-render-mobile-dark",
  ];
  const renders = renderNames.map((name) => marker(body, name));
  renderNames.forEach((name, index) => {
    if (!isArtifactLink(renders[index])) missing.push(`${name} evidence link`);
  });
  const links = renders.flatMap(
    (value) => value?.match(/https?:\/\/\S+/i)?.[0] ?? [],
  );
  if (new Set(links).size !== links.length)
    missing.push("four distinct viewport/theme evidence links");

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

export function latestModeAComparisonVerdict(
  reviews: GhReview[] | null | undefined,
  prBody: string,
): Verdict {
  const latest =
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
      )[0]?.body ?? "";
  const missing: string[] = [];
  if (!latest)
    return { ok: false, missing: ["latest structured Mode (a) review"] };
  for (const name of ["ui-source-kind", "ui-source", "ui-source-state"]) {
    const submitted = marker(prBody, name);
    if (!submitted || marker(latest, name) !== submitted)
      missing.push(`comparison against the submitted ${name}`);
  }
  const artifacts = marker(latest, "ui-artifacts-compared") ?? "";
  for (const name of [
    "desktop-light",
    "desktop-dark",
    "mobile-light",
    "mobile-dark",
    "interaction",
  ])
    if (!artifacts.toLowerCase().includes(name))
      missing.push(`${name} artifact comparison`);
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
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    info("not a pull_request event, skipping");
    return;
  }
  const prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber) {
    info("cannot determine PR number, skipping");
    return;
  }
  const response = await ghViewJson<GhPR>(
    "pr",
    prNumber,
    "number,body,files,reviews",
    REPO_ROOT,
  );
  if (!response.ok) fail(`could not fetch PR #${prNumber}: ${response.error}`);
  const pr = response.data;
  if (!(pr.files ?? []).some((file) => isUiSourcePath(file.path))) {
    info(
      `PR #${pr.number} touches no non-exempt UI source; rule does not apply`,
    );
    return;
  }
  const bodyVerdict = bodyEvidenceVerdict(pr.body ?? "");
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
        `latest Mode (a) review lacks explicit comparison against the submitted UI source artifacts: ${reviewVerdict.missing.join("; ")}`,
      );
    info(`PR #${pr.number} latest Mode (a) source comparison evidence OK`);
    return;
  }
  info(`PR #${pr.number} approved-source parity body evidence OK`);
}

const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF)
  runUiParityGuard().catch((error) =>
    fail((error as Error).stack ?? String(error)),
  );
