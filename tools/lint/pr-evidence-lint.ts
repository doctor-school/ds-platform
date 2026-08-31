#!/usr/bin/env tsx
/** Fail closed on missing, placeholder, known-red, or untracked PR evidence (#1637). */
import { ghViewJson } from "./lib/gh";

const TAG = "[pr-evidence]";
const REQUIRED = [
  "Stage-B",
  "Changeset",
  "Behavior change",
  "Local touched-suite verification",
] as const;

interface GhPR {
  number: number;
  body?: string | null;
  headRefName?: string | null;
}

function info(message: string): void {
  process.stdout.write(`${TAG} ${message}\n`);
}
function fail(message: string): never {
  process.stderr.write(`${TAG} ${message}\n`);
  process.exit(1);
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function markerValues(body: string, label: string): string[] {
  const pattern = new RegExp(
    `^\\s*(?:[-*]\\s*)?${escapeRegExp(label)}:\\s*(.*?)\\s*$`,
    "gim",
  );
  return [...body.matchAll(pattern)].map((match) => match[1].trim());
}
function sectionEntries(body: string, label: string): string[] {
  const lines = body.split(/\r?\n/);
  const heading = new RegExp(
    `^#{1,6}\\s+${escapeRegExp(label)}\\s*#*\\s*$`,
    "i",
  );
  const entries: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!heading.test(lines[i].trim())) continue;
    let current = "";
    const flush = (): void => {
      if (current.trim()) entries.push(current.trim());
      current = "";
    };
    for (i += 1; i < lines.length && !/^#{1,6}\s+/.test(lines[i]); i += 1) {
      const line = lines[i];
      const bullet = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
      if (bullet) {
        flush();
        current = bullet[1].trim();
      } else if (!line.trim()) {
        flush();
      } else {
        current = current ? `${current} ${line.trim()}` : line.trim();
      }
    }
    flush();
    i -= 1;
  }
  return entries;
}
function isPlaceholder(value: string): boolean {
  return (
    value.length === 0 ||
    /<[^>]+>/.test(value) ||
    /^[-–—]$/.test(value) ||
    /^\[\s\]$/.test(value) ||
    /^(?:tbd|todo|pending|placeholder|replace me|fill (?:me|this)|none)$/i.test(
      value,
    )
  );
}
function isReasonedNa(value: string): boolean {
  return /^N\/A\s*(?:\([^)]{4,}\)\s*)?(?:—|–|-|:)\s*\S.{5,}$/i.test(value);
}
function validStageB(value: string): boolean {
  if (/^GO\b.{6,}$/i.test(value)) return true;
  if (/^batched at #[1-9]\d*\b/i.test(value)) return true;
  return isReasonedNa(value);
}
function hasChangesetFile(value: string): boolean {
  return /(?:^|[\s`])\.changeset\/[\w.-]+\.md(?:[\s`]|$)/i.test(value);
}
function validChangeset(value: string): boolean {
  return isReasonedNa(value) || hasChangesetFile(value);
}
function validBehavior(value: string): boolean {
  return isReasonedNa(value) || value.length >= 12;
}
function validLocalVerification(value: string): boolean {
  if (
    isPlaceholder(value) ||
    /\b(?:known[- ]?red|fail(?:ed|ing|ure)?|error|not run|skipped|pending|blocked)\b|exit(?:ed)?\s+[1-9]\d*/i.test(
      value,
    )
  ) {
    return false;
  }
  const hasPass =
    /\bPASS(?:ED)?\b|\bGREEN\b|\bSUCCESS(?:FUL)?\b|exit(?:ed)?\s+0\b/i.test(
      value,
    );
  const hasCommand =
    /`[^`\n]*(?:pnpm|npm|yarn|npx|node|tsx|vitest|turbo|git|gh)\b[^`\n]*`/i.test(
      value,
    ) ||
    /(?:^|\s)(?:pnpm|npm|yarn|npx|node|tsx|vitest|turbo|git|gh)\s+\S+/i.test(
      value,
    );
  return hasPass && hasCommand;
}
function namesClause(value: string): boolean {
  return (
    /\bADR-\d{4}\b[^\n]*(?:§|\bsection\b|\bclause\b|\b(?:EARS|F)-\d+)/i.test(
      value,
    ) ||
    /(?:\b(?:requirements|design|product)\.md\b|\b(?:spec|specification)\b)[^\n]*(?:§|\b(?:EARS|F)-\d+)/i.test(
      value,
    ) ||
    /\b(?:EARS|F)-\d+(?:\.\d+)?\b/i.test(value)
  );
}
function hasTracking(value: string): boolean {
  return (
    /#[1-9]\d*\b/.test(value) ||
    /DEBT\.md#[a-z0-9][\w-]*/i.test(value) ||
    /\[[^\]]*DEBT\.md[^\]]*\]\([^)]*#[a-z0-9][^)]*\)/i.test(value)
  );
}
function resolvePrNumber(): string {
  let number = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!number && process.env.GITHUB_REF) {
    number = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//)?.[1] ?? "";
  }
  return number;
}

async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    info("not a pull_request event; skipping");
    process.exit(0);
  }
  const prNumber = resolvePrNumber();
  if (!prNumber) fail("cannot determine PR number from the environment");
  const result = await ghViewJson<GhPR>(
    "pr",
    prNumber,
    "number,body,headRefName",
  );
  if (!result.ok) fail(`could not fetch PR #${prNumber}: ${result.error}`);
  const branch = result.data.headRefName ?? "";
  if (branch === "changeset-release/main" || /^dependabot\//.test(branch)) {
    info(
      `PR #${result.data.number} is an automated PR (${branch}); evidence contract exempt.`,
    );
    process.exit(0);
  }
  const body = result.data.body ?? "";
  const findings: string[] = [];

  for (const label of REQUIRED) {
    const values = markerValues(body, label);
    if (values.length === 0) {
      findings.push(`${label}: missing`);
      continue;
    }
    const valid = values.every((value) => {
      if (isPlaceholder(value)) return false;
      if (label === "Stage-B") return validStageB(value);
      if (label === "Changeset") return validChangeset(value);
      if (label === "Behavior change") return validBehavior(value);
      return validLocalVerification(value);
    });
    if (!valid)
      findings.push(`${label}: missing, placeholder, or invalid evidence`);
  }

  const behaviorValues = markerValues(body, "Behavior change");
  const changesetValues = markerValues(body, "Changeset");
  if (
    behaviorValues.some((value) => !/^N\/A\b/i.test(value)) &&
    !changesetValues.some(hasChangesetFile)
  ) {
    findings.push(
      "Behavior change: a declared behavior change requires a real .changeset/*.md; Changeset: N/A is not allowed",
    );
  }

  const deviations = [
    ...markerValues(body, "Deviations"),
    ...sectionEntries(body, "Deviations"),
  ];
  for (const deviation of deviations) {
    if (isPlaceholder(deviation)) {
      findings.push("Deviations: placeholder evidence");
    } else if (/^N\/A\b/i.test(deviation) && !isReasonedNa(deviation)) {
      findings.push("Deviations: N/A must include a reason");
    } else if (namesClause(deviation) && !hasTracking(deviation)) {
      findings.push(
        "Deviations: an ADR/spec clause must name its tracked #<issue> or exact DEBT.md#anchor",
      );
    }
  }
  if (findings.length > 0) {
    fail(
      `PR #${result.data.number} delivery evidence is incomplete:\n- ${findings.join("\n- ")}`,
    );
  }
  info(`PR #${result.data.number} delivery evidence is complete.`);
  process.exit(0);
}

main().catch((error) => {
  fail(`unexpected error: ${(error as Error).stack ?? String(error)}`);
});
