#!/usr/bin/env tsx
/**
 * tools/lint/import-boundary-lint.ts — the IMPORT-BOUNDARY tree check of the
 * one-code-two-storefronts plan (Issue #2002 slice C, tech spec
 * `apps/docs/content/specs/tech/2026-09-07-one-code-two-storefronts-plan-en.md`
 * §3 rule 3, «Import boundary» bullet; graph §4; §5 on why the three checks
 * travel together).
 *
 * Why a guard and not just `eslint .`: the root lint run registers these rules at
 * `warn`, which exits 0 — useful in an editor, useless as a gate. This entry is
 * the PROMOTABLE pass/fail surface: it runs the dedicated config
 * (`eslint.import-boundary.config.mjs`, both rules at `error`) programmatically
 * and turns any finding into exit 1, so the CI step's `continue-on-error` is the
 * ONLY thing making it non-blocking — flip that (#2074) and the guard is BLOCK
 * with no rule change.
 *
 * What it checks (rules own the detail; both carry their rationale in-file):
 *   1. `local/package-import-boundary` over `packages/**` — no reach into
 *      `apps/**` (direct, via the host `@/` alias, or a relative climb), and no
 *      cross-package import the §4 graph does not allow.
 *   2. `local/host-config-boundary` over the host-config file convention
 *      (a `host-config.ts` / `host-config.tsx` file, or a `*.host-config.*`
 *      sibling, anywhere under `apps/portal` or `apps/doctor`) —
 *      no import of `apps/<host>/{lib,components}`, and no function-valued field
 *      in an exported object literal outside the closed adapter list (empty until
 *      #2027 lands `HostConfig`).
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6 — a new guard lands WARN, promotes
 * once stable). The step is NOT in the `ci` needs-list.
 *
 * Run: `pnpm lint:import-boundary`. Findings: stderr, exit 1. Clean: stdout
 * summary, exit 0.
 */
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

import boundaryConfig, {
  HOST_CONFIG_FILES,
  PACKAGE_FILES,
} from "../../eslint.import-boundary.config.mjs";

const TAG = "[import-boundary]";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * TEST SEAM: `LINT_FIXTURE_ROOT` (or `--root <dir>`) points the scan at a
 * fixture tree (tools/lint/guard-tests). Inert in production — unset, the root
 * resolves to the repo root, so runtime behaviour is unchanged.
 */
function resolveRoot(): string {
  const flag = process.argv.indexOf("--root");
  if (flag !== -1 && process.argv[flag + 1]) {
    return resolve(process.argv[flag + 1]);
  }
  return process.env.LINT_FIXTURE_ROOT
    ? resolve(process.env.LINT_FIXTURE_ROOT)
    : REPO_ROOT;
}

async function main(): Promise<void> {
  const root = resolveRoot();
  const eslint = new ESLint({
    cwd: root,
    // The dedicated config is passed as an object, not a path: that keeps the
    // base path at `cwd` (the repo root, or a fixture root under test) while the
    // rules and scopes stay the single SSOT in eslint.import-boundary.config.mjs.
    overrideConfigFile: true,
    overrideConfig: boundaryConfig,
    errorOnUnmatchedPattern: false,
  });

  const patterns = [...PACKAGE_FILES, ...HOST_CONFIG_FILES];
  const results = await eslint.lintFiles(patterns);

  const findings: string[] = [];
  for (const result of results) {
    for (const message of result.messages) {
      if (message.severity !== 2) continue;
      // Repo-relative posix path: CI is Linux, the dev box is Windows, and the
      // guard-test assertions must read the same on both.
      const rel = relative(root, result.filePath).split(sep).join("/");
      findings.push(
        `${rel}:${message.line}:${message.column} [${message.ruleId ?? "parse"}] ${message.message}`,
      );
    }
  }

  if (findings.length > 0) {
    process.stderr.write(
      `${TAG} ${findings.length} finding(s) — the package graph and host-config purity are the import boundary (#2002, tech spec §3 rule 3 / §4):\n`,
    );
    for (const f of findings) process.stderr.write(`${TAG}   ${f}\n`);
    process.stderr.write(
      `${TAG} WARN v1 (ADR-0007 §2.6): annotated, not merge-blocking. #2074 promotes this guard to BLOCK after wave 1.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `${TAG} OK — ${results.length} file(s) in scope: no packages/** → apps/** import, ` +
      `no cross-package import against the §4 graph, and every host-config module is data-only.\n`,
  );
  process.exit(0);
}

void main();
