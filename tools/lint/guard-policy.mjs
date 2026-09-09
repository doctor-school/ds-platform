import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** CI and local preflight share the existing WARN rollout posture (ADR-0007 section 2.6).
 * Unlisted guards fail closed as BLOCK. A nonzero execution error is never a finding.
 */
export const WARN_GUARDS = new Set([
  "aa-contrast",
  "asset-format",
  "audit-coverage",
  "axe-exclude",
  "catalog-deletion",
  "cross-front-reuse",
  "ears-naming",
  "ears-tests",
  "epic-autoclose",
  "external-anchor",
  "form-error",
  "form-rhythm",
  "glossary-ids",
  "glossary-mdx",
  "host-allowlist",
  "import-boundary",
  "interaction-states",
  "migration-index",
  "module-readme",
  "no-hardcoded-path",
  "no-stub",
  "prior-decisions",
  "product-note",
  "registry-research",
  "retained-data",
  "route-targets",
  "showcase-coverage",
  "showcase-snippet",
  "spec-deletion",
  "spec-status-fresh",
  "submit-pending",
  "tdd-signal",
  "tsc-version",
  "workflow-auth",
]);
export function guardSeverity(name) {
  return WARN_GUARDS.has(name) ? "WARN" : "BLOCK";
}
export function guardVerdict(name, status) {
  return status === 0
    ? "PASS"
    : status === 1 && guardSeverity(name) === "WARN"
      ? "WARN"
      : "FAIL";
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  for (const name of WARN_GUARDS) console.log(`${name}=WARN`);
}
