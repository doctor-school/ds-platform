#!/usr/bin/env tsx
/** BLOCK guard for the canvas-parity evidence contract (Issue #1627). */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";
import { isUiSourcePath } from "./lib/ui-surface";

const TAG = "[ui-parity]";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODE_A_HEADER_RE = /^## Mode \(a\) Review\b/im;
const MODE_A_VERDICT_RE = /^VERDICT:\s*(?:APPROVE|REQUEST_CHANGES)\b/im;

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

export function bodyEvidenceVerdict(body: string): Verdict {
  const missing: string[] = [];
  const source = marker(body, "canvas-source");
  const state = marker(body, "canvas-state");
  if (!source || !/^design-source\/[^\s]+\.dc\.html(?:\s|$)/i.test(source))
    missing.push("exact canvas-source: design-source/*.dc.html");
  if (
    !state ||
    /^(?:inspected|checked|tbd|todo|n\/?a|none)$/i.test(state) ||
    !/(?:=|:|\bmode\b|\bstate\b)/i.test(state)
  )
    missing.push("exact canvas-state (for example mode=past)");

  const renderNames = [
    "canvas-render-desktop-light",
    "canvas-render-desktop-dark",
    "canvas-render-mobile-light",
    "canvas-render-mobile-dark",
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

  const interactions = marker(body, "canvas-interactions");
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
  const modeAReviews = (reviews ?? [])
    .filter(
      (review) =>
        MODE_A_HEADER_RE.test(review.body ?? "") &&
        MODE_A_VERDICT_RE.test(review.body ?? ""),
    )
    .sort(
      (a, b) =>
        Date.parse(b.submittedAt ?? "1970-01-01") -
        Date.parse(a.submittedAt ?? "1970-01-01"),
    );
  const latest = modeAReviews[0]?.body ?? "";
  const source = marker(prBody, "canvas-source");
  const state = marker(prBody, "canvas-state");
  const missing: string[] = [];
  if (!latest)
    return { ok: false, missing: ["latest structured Mode (a) review"] };
  if (!source || marker(latest, "canvas-source") !== source)
    missing.push("comparison against the submitted canvas-source");
  if (!state || marker(latest, "canvas-state") !== state)
    missing.push("comparison against the submitted canvas-state");
  const artifacts = marker(latest, "canvas-artifacts-compared") ?? "";
  for (const name of [
    "desktop-light",
    "desktop-dark",
    "mobile-light",
    "mobile-dark",
    "interaction",
  ])
    if (!artifacts.toLowerCase().includes(name))
      missing.push(`${name} artifact comparison`);
  const applicability = marker(latest, "canvas-source-applicability") ?? "";
  if (
    !/(?:appl(?:y|ies|icable)|approved)/i.test(applicability) ||
    !/(?:surface|apps\/|portal|promo|admin|academy)/i.test(applicability)
  )
    missing.push("source applicability/purpose-fit for the touched surface");
  const result = marker(latest, "canvas-comparison-result") ?? "";
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
      `PR #${pr.number} lacks canvas parity evidence: ${bodyVerdict.missing.join("; ")}`,
    );
  if (process.env.UI_PARITY_REQUIRE_REVIEW === "1") {
    const reviewVerdict = latestModeAComparisonVerdict(
      pr.reviews,
      pr.body ?? "",
    );
    if (!reviewVerdict.ok)
      fail(
        `latest Mode (a) review lacks explicit comparison against the submitted canvas artifacts: ${reviewVerdict.missing.join("; ")}`,
      );
    info(`PR #${pr.number} latest Mode (a) canvas comparison evidence OK`);
    return;
  }
  info(`PR #${pr.number} canvas parity body evidence OK`);
}

const INVOKED = process.argv[1] ? resolve(process.argv[1]) : "";
const SELF = resolve(fileURLToPath(import.meta.url));
if (INVOKED === SELF)
  runUiParityGuard().catch((error) =>
    fail((error as Error).stack ?? String(error)),
  );
