/**
 * host-config-boundary — the host half of the IMPORT BOUNDARY check (#2002
 * slice C, tech spec `2026-09-07-one-code-two-storefronts-plan-en.md` §3 rule 3
 * «Import boundary»: «a host-config module imports nothing from
 * `apps/<host>/{lib,components}` and type-checks against the package's
 * `HostConfig` (`satisfies`), which rejects function-valued fields outside the
 * closed adapter list»).
 *
 * WHY: a thin host projection is a route file plus a host-config OBJECT. The
 * moment that object grows a callback, host behaviour re-enters through the
 * config — the two storefronts diverge again, and the allowlist tree check sees
 * nothing, because the file was already listed. The «callback smuggled through
 * host config» bypass is named verbatim in spec §5 as the reason the three
 * checks travel together.
 *
 * SCOPE (wired in `eslint.import-boundary.config.mjs` / `eslint.config.js`): the
 * host-config FILE CONVENTION only — `apps/{portal,doctor}/**` files named
 * `host-config.{ts,tsx}` or `*.host-config.{ts,tsx}`. Slice C fixes the
 * convention; the `HostConfig` TYPE and the first real config are #2027.
 *
 * Two classes:
 *   (c) `hostLogicImport` — an import of `@/lib/*`, `@/components/*`, or a
 *       relative path resolving into `apps/<host>/{lib,components}`. A config is
 *       data plus package imports; reaching into host logic makes it a module.
 *   (d) `callbackOutsideAdapterList` — inside an EXPORTED object literal
 *       (default export, `export const x = {…}`, `{…} satisfies X`, `{…} as X`,
 *       nested literals included) a property whose value is an arrow function,
 *       a function expression or a shorthand method, whose key is not in the
 *       `allowedAdapters` option. That option is the CLOSED adapter list and is
 *       deliberately EMPTY (`[]`) in the repo config: #2027 fills it when
 *       `HostConfig` lands and names the adapters the type actually permits.
 *
 * ESCAPE HATCH: `// eslint-disable-next-line local/host-config-boundary -- <reason>`
 * and nothing else — a needed adapter is added to `allowedAdapters` (a tracked
 * config edit), never disabled per site.
 *
 * Severity: WARN v1 (ADR-0007 §2.6); #2074 promotes the guard to BLOCK.
 */

import { sep } from "node:path";

/** Repo-relative posix path of the linted file (RuleTester passes one already). */
function repoRelative(filename) {
  const posix = String(filename ?? "").split(sep).join("/");
  const m = /(?:^|\/)(apps\/.*)$/.exec(posix);
  return m ? m[1] : posix;
}

/** Posix `dirname` on an already-relative path. */
function dirOf(rel) {
  const i = rel.lastIndexOf("/");
  return i === -1 ? "" : rel.slice(0, i);
}

/** Resolve `spec` against `fromDir` without touching the filesystem. */
function resolveRelative(fromDir, spec) {
  const parts = fromDir ? fromDir.split("/").filter(Boolean) : [];
  for (const seg of spec.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** The two host directories a config must not reach into. */
const HOST_LOGIC_DIRS = new Set(["lib", "components"]);

/** True when `spec` names host logic (`@/lib|components/…` or a relative hop). */
function isHostLogic(spec, fileRel) {
  const alias = /^@\/(lib|components)(\/|$)/.exec(spec);
  if (alias) return true;
  if (!spec.startsWith(".")) return false;
  const segments = resolveRelative(dirOf(fileRel), spec).split("/");
  return segments[0] === "apps" && HOST_LOGIC_DIRS.has(segments[2]);
}

/** Strip `satisfies` / `as` / type-assertion / parenthesis wrappers. */
function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === "TSSatisfiesExpression" ||
      current.type === "TSAsExpression" ||
      current.type === "TSTypeAssertion" ||
      current.type === "TSNonNullExpression")
  ) {
    current = current.expression;
  }
  return current;
}

/** A property key rendered for the message; computed keys are never allowlisted. */
function keyName(property) {
  if (property.computed) return "<computed>";
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return "<computed>";
}

const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
]);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep a host-config module data-only: no import of apps/<host>/{lib,components} (via the @/ alias or a relative path), and no function-valued field in an exported object literal outside the closed `allowedAdapters` list (#2002, tech spec 2026-09-07-one-code-two-storefronts-plan-en.md §3 rule 3 / §5).",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowedAdapters: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      hostLogicImport:
        'A host-config module must not import host logic: "{{spec}}" resolves into `apps/<host>/{lib,components}`. A config is data plus package imports — move the behaviour into the shared package, or the call site into the route file (tech spec §3 rule 3).',
      callbackOutsideAdapterList:
        '`{{key}}` is a function-valued host-config field outside the closed adapter list ({{allowed}}). Host behaviour re-entering through config is the «callback smuggled through host config» bypass the allowlist cannot see (tech spec §5): move it into the shared package, or add `{{key}}` to the rule\'s `allowedAdapters` once `HostConfig` (#2027) admits it as an adapter.',
    },
  },

  create(context) {
    const allowedAdapters = new Set(
      context.options[0]?.allowedAdapters ?? [],
    );
    const allowedLabel =
      allowedAdapters.size === 0
        ? "empty until #2027 lands HostConfig"
        : [...allowedAdapters].join(", ");
    const fileRel = repoRelative(context.filename ?? context.getFilename?.());

    /** Walk an exported object literal, reporting function-valued fields. */
    function walkObject(node) {
      for (const property of node.properties) {
        if (property.type !== "Property") continue;
        const value = unwrap(property.value);
        if (!value) continue;
        if (value.type === "ObjectExpression") {
          walkObject(value);
          continue;
        }
        if (!FUNCTION_TYPES.has(value.type)) continue;
        const key = keyName(property);
        if (allowedAdapters.has(key)) continue;
        context.report({
          node: property.key,
          messageId: "callbackOutsideAdapterList",
          data: { key, allowed: allowedLabel },
        });
      }
    }

    function visitExported(node) {
      const value = unwrap(node);
      if (value && value.type === "ObjectExpression") walkObject(value);
    }

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

    function checkSource(node) {
      const spec = staticString(node.source);
      if (spec && isHostLogic(spec, fileRel)) {
        context.report({
          node: node.source,
          messageId: "hostLogicImport",
          data: { spec },
        });
      }
    }

    return {
      ImportDeclaration: checkSource,
      ExportNamedDeclaration(node) {
        if (node.source) {
          checkSource(node);
          return;
        }
        if (node.declaration?.type !== "VariableDeclaration") return;
        for (const declarator of node.declaration.declarations) {
          if (declarator.init) visitExported(declarator.init);
        }
      },
      ExportAllDeclaration: checkSource,
      ImportExpression(node) {
        const spec = staticString(node.source);
        if (spec && isHostLogic(spec, fileRel)) {
          context.report({
            node: node.source,
            messageId: "hostLogicImport",
            data: { spec },
          });
        }
      },
      ExportDefaultDeclaration(node) {
        visitExported(node.declaration);
      },
    };
  },
};

export default rule;
