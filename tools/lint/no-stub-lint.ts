#!/usr/bin/env tsx
/**
 * tools/lint/no-stub-lint.ts — enforcement gate for the "no workarounds / stubs /
 * placeholders" Hard rule (AGENTS.md §6; epic #247 Theme E, child #251).
 *
 * Why this exists: the no-stub / no-placeholder ban is already a Hard rule and
 * STILL recurred ("опять налепили заглушек, я строго это запретил!"). It lived
 * as prose and never fired at the decision point. This gate makes it fire by
 * grepping user-facing source for the two concrete banned shapes the audit and
 * memory call out:
 *
 *   1. A user-facing DEV PLACEHOLDER leaking to end users — e.g. a rendered
 *      "set this env var" / "configure …" note shown in the UI in place of the
 *      real thing. Banned outright (CLAUDE.md "UI verification": "A user-facing
 *      dev placeholder is a banned stub, not an affordance — render the real
 *      thing or nothing.").
 *   2. A TODO/FIXME/STUB marker that stands in for a real deliverable in
 *      user-facing code without a tracked Issue reference. The §6 rule "No
 *      untracked seam / scaffold" requires a tracked Issue (`#NNN`) — a bare
 *      `// TODO: implement` is an untracked obligation the tracker can't see.
 *      A TODO that cites an Issue (`TODO(#123)` / `TODO: … see #123`) passes.
 *
 * Scope: user-facing app source only (apps/portal|promo|admin/src, plus
 * packages/design-system/src) — *.ts/*.tsx/*.jsx, excluding tests. Backend BFF
 * and tooling are out of scope (a TODO in a tool is not user-facing). The gate
 * is intentionally narrow + literal so it is reliable, not a style nanny.
 *
 * Suppression: a line may carry `// no-stub-ok: <reason>` to acknowledge an
 * intentional, non-user-facing match (rare). The reason is required.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6; new guard lands WARN, promote to
 * BLOCK once stable). The CI job uses `continue-on-error`.
 *
 * Run: `pnpm lint:no-stub`. Failures: stderr + exit 1. Clean: exit 0.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

// TEST SEAM: `LINT_FIXTURE_ROOT` lets the guard-tests harness point the scan at a
// fixture tree (tools/lint/guard-tests). Inert in production — when unset the root
// resolves to the repo root exactly as before, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[no-stub]";

const GLOBS = [
  "apps/portal/src/**/*.{ts,tsx,jsx}",
  "apps/promo/src/**/*.{ts,tsx,jsx}",
  "apps/admin/src/**/*.{ts,tsx,jsx}",
  "packages/design-system/src/**/*.{ts,tsx,jsx}",
];
const IGNORE = [
  "**/*.test.{ts,tsx,jsx}",
  "**/*.spec.{ts,tsx,jsx}",
  "**/__tests__/**",
  "**/*.stories.{ts,tsx,jsx}",
  "**/node_modules/**",
];

// (1) A user-facing dev placeholder: user-readable copy (a string literal OR
// JSX text) that tells the user to set/configure an env var or a config value.
// This is the "set this env var" banned stub. We require the imperative AND the
// env/config object in proximity so a legitimate label like "Configure your
// profile" is not caught. Matched anywhere on the line (literal or JSX text),
// because the leak the memory describes ("set this env var" shown to end users)
// renders both ways.
const ENV_PLACEHOLDER_RE =
  /\b(set|configure|define|provide|missing)\b[^\n]{0,40}?\b(env(?:ironment)?\s*var(?:iable)?s?|\.env\b|environment variables?|config(?:uration)? values?)\b/i;

// (2) A TODO/FIXME/STUB marker standing in for a real deliverable. Passes if
// the same line cites a tracked Issue (#NNN). These are matched CASE-SENSITIVELY
// (uppercase convention) so the legitimate lowercase React `placeholder` prop
// and ordinary prose are not caught — only the comment-marker convention is. We
// deliberately do NOT include `PLACEHOLDER`: `placeholder` is a real DOM/React
// attribute, and the user-facing-placeholder shape is covered by check (1).
const STUB_MARKER_RE = /\b(TODO|FIXME|XXX|HACK|STUB)\b/;
const ISSUE_REF_RE = /#\d{1,6}\b/;
const SUPPRESS_RE = /\bno-stub-ok\s*:\s*\S/i;

interface Finding {
  file: string;
  line: number;
  kind: "user-facing-env-placeholder" | "untracked-stub-marker";
  text: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

async function main(): Promise<void> {
  const files = await fg(GLOBS, {
    cwd: REPO_ROOT,
    ignore: IGNORE,
    absolute: true,
  });

  const findings: Finding[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((raw, i) => {
      const lineNo = i + 1;
      if (SUPPRESS_RE.test(raw)) return;

      if (ENV_PLACEHOLDER_RE.test(raw)) {
        findings.push({
          file,
          line: lineNo,
          kind: "user-facing-env-placeholder",
          text: raw.trim().slice(0, 120),
        });
        return;
      }
      if (STUB_MARKER_RE.test(raw) && !ISSUE_REF_RE.test(raw)) {
        findings.push({
          file,
          line: lineNo,
          kind: "untracked-stub-marker",
          text: raw.trim().slice(0, 120),
        });
      }
    });
  }

  info(`scanned ${files.length} user-facing source file(s)`);

  if (findings.length === 0) {
    info("PASS — no banned placeholder/stub patterns in user-facing code.");
    process.exit(0);
  }

  for (const f of findings) {
    const rel = relative(REPO_ROOT, f.file).replace(/\\/g, "/");
    process.stderr.write(`${TAG} ${f.kind}  ${rel}:${f.line}\n    ${f.text}\n`);
  }
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} banned pattern(s). ` +
      `User-facing dev placeholders ("set this env var") are forbidden (render the real thing or nothing); ` +
      `a stub marker standing in for a deliverable must cite a tracked Issue (#NNN) per AGENTS.md §6 ` +
      `("No untracked seam / scaffold"), or carry \`// no-stub-ok: <reason>\` if it is a genuine non-deliverable.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
