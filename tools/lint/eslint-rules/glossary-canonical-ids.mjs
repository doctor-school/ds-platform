/**
 * glossary-canonical-ids — glossary-id SSOT enforcement (#468, ADR-0006 §6.3).
 *
 * WHY: a glossary canonical id (`packages/glossary/src/ids.ts` → `GLOSSARY_IDS`,
 * generated from `apps/docs/content/product/glossary/*.md`) referenced as a bare
 * string literal in code forks the SSOT silently — a later id rename leaves the
 * literal dangling with no compile error. This rule forces a glossary reference
 * through the typed constant `GLOSSARY_IDS.<id>` (import from `@ds/glossary/ids`),
 * so a rename breaks the TS build instead of drifting. (Prose references use the
 * separate `[[g:<id>]]` directive, ADR-0006 §6.4 / the `glossary-mdx` guard.)
 *
 * ── The id-vs-domain-enum collision (the whole reason this rule is scoped) ─────
 * A naive "flag any literal equal to a glossary id" rule is WRONG here: the id
 * `doctor_guest` is simultaneously a glossary term AND the live v1 RBAC role
 * wire-value used as a string literal across ~35 auth/authz/db sites (role arrays,
 * the `users.role` DB default, Zitadel grant payloads). Its SSOT is the roles
 * vocabulary — `apps/api/src/authz/authz.types.ts` `ROLES` /
 * `apps/api/src/auth/idp/idp.types.ts` `DOCTOR_GUEST_ROLE` — NOT the glossary doc
 * artifact. Coupling that wire-value to the glossary would be a false positive.
 * Two mechanisms keep the rule clean while still catching genuine doc-references:
 *
 *   1. SURFACE SCOPE (primary) — wired in `eslint.config.js` to the
 *      glossary-CONSUMER surface only (`apps/cms/**`, `apps/docs/**`), where a
 *      programmatic glossary reference legitimately belongs and should be typed.
 *      This keeps the rule entirely OFF `apps/api/**` / `packages/db/**` /
 *      `packages/schemas/**` — the home of the ~35 `doctor_guest` wire-value
 *      sites. WIDEN ADDITIVELY: add a `files:` entry when a new glossary-consumer
 *      surface lands (mirrors the `no-hardcoded-display-string` precedent).
 *   2. `domainEnumIds` OPTION (defense-in-depth) — an explicit, auditable list of
 *      ids that coincide with a live domain enum wire-value; the rule ABSTAINS on
 *      them everywhere in scope. Seeded `["doctor_guest"]` in `eslint.config.js`.
 *      So even if the scope later includes a directory carrying the wire-value,
 *      the known collision stays exempt by SSOT-tracked config, not by accident.
 *
 * The other three current ids (`consent_gate`, `enumeration_resistance`,
 * `user_mirror`) are pure doc terms with no wire-value collision → fully enforced.
 *
 * ── Id set: loaded from the glossary source, the same way the guards do ────────
 * The flagged id set is read at module load from the live glossary source
 * (`apps/docs/content/product/glossary/*.md`, `**Canonical id:**` marker) via the
 * plain-ESM sync twin of the `glossary-mdx` guard's loader
 * (`tools/lint/lib/glossary-ids.mjs`) — NOT `import … from "@ds/glossary/ids"`,
 * which would need a built `dist/` the plain-node `eslint .` path never produces.
 *
 * WHAT IT FLAGS: a string literal (or single-quasi template literal) whose value
 * is a glossary canonical id and is NOT in `domainEnumIds`, EXCEPT when it is an
 * import/export module-source string (a module id that merely equals a glossary id
 * is not a glossary reference).
 *
 * ESCAPE HATCH: `// eslint-disable-next-line local/glossary-canonical-ids -- <reason>`
 * for a genuine non-glossary literal the id set collides with. Never to dodge
 * typing a real glossary reference.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { readGlossaryIdsSync } from "../lib/glossary-ids.mjs";

/** Repo root (or a fixture root in guard tests), resolved from this file. */
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The glossary canonical-id set, loaded once at module load. */
const GLOSSARY_IDS_SET = readGlossaryIdsSync(REPO_ROOT);

/** Static string value of a Literal or single-quasi template, else null. */
function staticString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid a bare string literal matching a glossary canonical id in glossary-consumer code; reference it via GLOSSARY_IDS from @ds/glossary/ids so a rename breaks the build (#468, ADR-0006 §6.3). Ids that coincide with a domain-enum wire-value are exempted via the domainEnumIds option.",
    },
    schema: [
      {
        type: "object",
        properties: {
          domainEnumIds: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      useImport:
        '"{{value}}" is a glossary canonical id — reference it via `GLOSSARY_IDS.{{value}}` (import GLOSSARY_IDS from "@ds/glossary/ids") instead of a bare string literal, so a glossary rename breaks the build rather than drifting (ADR-0006 §6.3). If this literal is a domain wire-value that merely coincides with a glossary id, add it to the rule\'s `domainEnumIds`; a genuine one-off needs `// eslint-disable-next-line local/glossary-canonical-ids -- <reason>`.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const domainEnumIds = new Set(options.domainEnumIds ?? []);
    const sourceCode = context.sourceCode;

    function check(node) {
      const value = staticString(node);
      if (value === null) return;
      if (!GLOSSARY_IDS_SET.has(value)) return;
      if (domainEnumIds.has(value)) return;
      // A module-source string that equals a glossary id is not a reference.
      const ancestors = sourceCode.getAncestors(node);
      if (
        ancestors.some(
          (a) =>
            a.type === "ImportDeclaration" ||
            a.type === "ExportAllDeclaration" ||
            a.type === "ExportNamedDeclaration",
        )
      ) {
        return;
      }
      context.report({ node, messageId: "useImport", data: { value } });
    }

    return {
      Literal: check,
      // A single-quasi template (`` `consent_gate` ``) is an equivalent literal.
      TemplateLiteral: check,
    };
  },
};

export default rule;
