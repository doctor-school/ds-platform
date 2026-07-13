#!/usr/bin/env tsx
/**
 * tools/lint/registry-research-lint.ts — enforcement gate for the
 * "registry-research before bespoke UI" rule (epic #247 Theme C, child #251).
 *
 * Why this exists: ADR-0013 + AGENTS.md §6 ("UI from the design system — adopt
 * before bespoke") + the `build-ui-from-design-system` skill all require that,
 * before writing ANY UI, the agent searches the approved registry toolbox and
 * **reports what it searched and what it found**. The audit (epic #247) found
 * this rule was already written and STILL recurred ("зачем переизобретаем
 * велосипед?") — it lived as passive prose and never fired at the decision
 * point. This gate makes it fire: a PR that touches a user-facing UI surface
 * must carry the registry-research artifact in its body, or CI goes red.
 *
 * The artifact is exactly what the skill's "Output" section already mandates:
 * an explicit adoption decision in the PR body. We make that citation a
 * machine-checked requirement so the gate cannot be silently skipped.
 *
 * What it checks: if the PR diff touches any user-facing UI path
 * (apps/portal/**, apps/promo/**, apps/admin/**, packages/design-system/**),
 * the PR body MUST contain a `registry-research:` marker line (or a
 * `## Registry research` section) whose value is non-empty and is one of the
 * two sanctioned shapes from the skill:
 *   - `adopted <block> from <registry>` (shadcn / Origin UI / Intent·Jolly / Kibo)
 *   - `bespoke — <why the toolbox search came up empty>`
 * An empty marker, or a marker that names no registry and gives no bespoke
 * rationale, fails — a checkbox the author can leave blank is not evidence.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6 posture: new AI-specific guards land
 * as WARN, promote to BLOCK once stable). The CI job uses `continue-on-error`.
 *
 * Non-PR runs, and PRs that touch no UI surface → exit 0 with a skip note.
 * Failures: stderr, exit 1. Success: stdout summary, exit 0.
 *
 * Run: `pnpm lint:registry-research` (PR_NUMBER from the Actions context).
 */
import { ghViewJson } from "./lib/gh";

const TAG = "[registry-research]";

// User-facing UI surfaces. A diff that touches any of these requires the
// registry-research artifact. `packages/design-system/**` is included because
// that is where adopted/bespoke blocks actually land (the #235 sin lived there).
const UI_PATH_RE =
  /^(apps\/portal\/|apps\/promo\/|apps\/admin\/|packages\/design-system\/)/;

// Non-UI files inside those trees that should NOT trip the gate on their own
// (config, docs, tests, generated tokens). If a PR ONLY touches these, the
// registry-research artifact is not required.
// NOTE on `\.config\.[mc]?[tj]s$`: build-config files are not UI source. The
// pattern matches every real config extension — `.config.{ts,js,mts,mjs,cts,cjs}`
// — not just the bare `.ts`/`.js` an earlier `[tjm]s$` covered (which silently
// failed to exempt `.config.mjs` / `.config.cjs`, tripping the guard on a
// build-config-only change such as `style-dictionary.config.mjs`).
// NOTE on `(^|\/)e2e\/`: the Playwright E2E tree (`apps/<app>/e2e/**`, including
// its `support/` helpers like `e2e/support/mailpit.ts`) is test code, not UI
// source — the same as `*.spec.ts` / `__tests__/`. The path-segment anchor
// matches an `e2e/` directory anywhere in the relative path, but NOT a file or
// dir merely *named* like `*e2e*` inside `src/` (#309).
// NOTE on `\.setup\.[mc]?[tj]sx?$`: Vitest/Jest setup files (`vitest.setup.ts`,
// `*.setup.tsx`, …) are test-harness code in the same kind as `*.config.*` and
// `*.test.*` — they wire up the test environment and ship no rendered UI. The
// pattern covers every real setup extension (`.setup.{ts,tsx,js,jsx,mts,mjs,
// cts,cjs}`). Before this, a test-only PR whose only non-`.test.tsx` file was
// `packages/design-system/vitest.setup.ts` tripped the guard as if it were a
// user-facing surface (#378, surfaced by #377).
// NOTE on the infra/deploy family (#746): container build recipes
// (`Dockerfile`, `Dockerfile.<variant>`), dotfiles (`.dockerignore`, `.env`,
// `.env.example`, `.eslintrc.*`, …), non-dot env templates (`*.env.example`),
// and YAML manifests (compose files, CI/deploy config — `*.yml`/`*.yaml`) are
// deploy/config artifacts, never rendered UI source. Before this, an
// infra-only PR touching `apps/admin/Dockerfile` tripped the guard and taxed
// the author with a registry-research artifact for a change that ships no UI
// (#648, PR #745). The exemption is PATH-based only: any `.tsx`/`.jsx`/UI
// source file in the same diff still requires the artifact, and comment-only
// UI-source changes still count (no content-based opt-out — see
// `reference_registry_research_guard_no_comment_optout`).
const UI_PATH_EXEMPT_RE =
  /(\.md$|\.mdx$|\.json$|\.css$|\.test\.[tj]sx?$|\.spec\.[tj]sx?$|\/__tests__\/|(^|\/)e2e\/|\.config\.[mc]?[tj]s$|\.setup\.[mc]?[tj]sx?$|\/styles\/tokens\.css$|allowed-tokens\.json$|(^|\/)Dockerfile[^/]*$|(^|\/)\.[^/]+$|\.env\.example$|\.ya?ml$)/;

// The artifact: a `registry-research:` marker line, or a `## Registry research`
// section heading followed by its body. Either form is accepted.
const MARKER_RE = /^[ \t>*-]*registry-research\s*:\s*(.*)$/im;
const SECTION_RE = /^#{1,6}\s*registry[ -]research\b[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|\n*$)/im;

// A non-empty value must name a registry (adopt path) OR give a bespoke
// rationale. We accept the two sanctioned shapes plus a loose "names a known
// registry" fallback so authors are not over-constrained on phrasing.
const ADOPT_RE = /\b(adopt(?:ed)?|reused?)\b/i;
const BESPOKE_RE = /\bbespoke\b/i;
const KNOWN_REGISTRY_RE =
  /\b(shadcn|origin\s*ui|intent\s*ui|jolly\s*ui|jolly|kibo)\b/i;
// Placeholder values that read as "left blank" — reject these explicitly.
const EMPTY_VALUE_RE =
  /^(|n\/?a|none|tbd|todo|xxx|\.\.\.|<.*>|_+|-+)$/i;

interface GhPR {
  number: number;
  body: string;
  files?: { path: string }[];
}

function fail(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}
function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function resolvePrNumber(): string {
  let prNumber =
    process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber && process.env.GITHUB_REF) {
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  return prNumber;
}

async function ghPR(prNumber: string): Promise<GhPR | null> {
  const res = await ghViewJson<GhPR>("pr", prNumber, "number,body,files");
  if (!res.ok) {
    process.stderr.write(`${TAG} gh pr view ${prNumber} failed: ${res.error}\n`);
    return null;
  }
  return res.data;
}

function extractArtifact(body: string): string | null {
  if (!body) return null;
  const marker = body.match(MARKER_RE);
  if (marker) return (marker[1] ?? "").trim();
  const section = body.match(SECTION_RE);
  if (section) return (section[1] ?? "").trim();
  return null;
}

function artifactIsEvidence(value: string): boolean {
  const firstLine = value.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const v = firstLine.trim();
  if (EMPTY_VALUE_RE.test(v)) return false;
  if (BESPOKE_RE.test(value)) {
    // bespoke must carry a rationale, not just the word.
    return value.replace(BESPOKE_RE, "").replace(/[—\-:]/g, "").trim().length >= 8;
  }
  if (ADOPT_RE.test(value) && KNOWN_REGISTRY_RE.test(value)) return true;
  // A bare registry name with a component is also acceptable evidence.
  if (KNOWN_REGISTRY_RE.test(value) && v.length >= 8) return true;
  return false;
}

async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    info(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}), skipping`,
    );
    process.exit(0);
  }
  const prNumber = resolvePrNumber();
  if (!prNumber) {
    info("cannot determine PR number from environment, skipping");
    process.exit(0);
  }
  const pr = await ghPR(prNumber);
  if (!pr) fail(`could not fetch PR #${prNumber} metadata`);

  const files = (pr.files ?? []).map((f) => f.path);
  const uiFiles = files.filter(
    (p) => UI_PATH_RE.test(p) && !UI_PATH_EXEMPT_RE.test(p),
  );
  if (uiFiles.length === 0) {
    info(
      `PR #${pr.number} touches no user-facing UI source (apps/portal|promo|admin, packages/design-system), rule does not apply`,
    );
    process.exit(0);
  }

  info(
    `PR #${pr.number} touches ${uiFiles.length} UI source file(s), e.g. ${uiFiles
      .slice(0, 3)
      .join(", ")}`,
  );

  const artifact = extractArtifact(pr.body ?? "");
  if (artifact === null) {
    fail(
      `PR #${pr.number} touches user-facing UI but carries no registry-research artifact. ` +
        `Run the \`build-ui-from-design-system\` gate and add to the PR body either:\n` +
        `    registry-research: adopted <block> from <shadcn|Origin UI|Intent·Jolly|Kibo>\n` +
        `  or, if the toolbox search came up empty:\n` +
        `    registry-research: bespoke — <which registries searched, candidates rejected and why>`,
    );
  }
  if (!artifactIsEvidence(artifact)) {
    fail(
      `PR #${pr.number} has a registry-research marker but its value is not evidence: "${artifact.slice(0, 80)}". ` +
        `Name the adopted block + registry, or give a real bespoke rationale (which registries searched, why no fit). ` +
        `An empty/placeholder marker is not the artifact.`,
    );
  }

  info(`registry-research artifact OK: "${artifact.split(/\r?\n/)[0].slice(0, 100)}"`);
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
