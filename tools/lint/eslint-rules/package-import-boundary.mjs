/**
 * package-import-boundary — the package half of the IMPORT BOUNDARY check
 * (#2002 slice C, tech spec `2026-09-07-one-code-two-storefronts-plan-en.md`
 * §3 rule 3 «Import boundary», dependency graph §4).
 *
 * WHY: the one-code-two-storefronts plan converges Academy and doctor onto
 * shared packages. That only holds if the arrows point one way. A package that
 * imports `apps/portal/lib/*` is not shared code — it is host code parked in
 * `packages/`, and it makes the second storefront uncompilable. A package that
 * imports a SIBLING feature package (`@ds/events-storefront` → `@ds/room`)
 * quietly fuses two units the waves are supposed to keep separable. Neither
 * shows up in a review diff as an obvious problem; both are one import line.
 *
 * SCOPE: `packages/**` sources only (wired in `eslint.import-boundary.config.mjs`
 * at `error` for `pnpm lint:import-boundary`, and at `warn` in `eslint.config.js`
 * for editor feedback). Two classes:
 *   (a) `noAppsImport` — any specifier reaching a storefront: `apps/…`, the host
 *       `@/…` path alias (both `apps/portal` and `apps/doctor` map `@/*` → `./*`),
 *       or a relative path that climbs out of `packages/` into `apps/`.
 *   (b) `wrongDirection` — an `@ds/<pkg>` (or relative cross-package) import that
 *       the §4 dependency graph does not allow.
 *
 * The graph is DATA, not code: the `graph` option is the full allowed-edges
 * table, including packages that do NOT exist yet (`auth-flow` wave 1,
 * `account` wave 4) so the answer key is complete before the code lands. A
 * package absent from the table is unclaimed by class (b) — it still gets (a).
 *
 * ESCAPE HATCH: `// eslint-disable-next-line local/package-import-boundary -- <reason>`
 * and nothing else. A real violation is a re-sequencing signal (spec §4: «a
 * shared package that would need `apps/portal` to compile is a stop, not a
 * temporary `paths` alias»), never an allowlist entry.
 *
 * Severity: WARN v1 (ADR-0007 §2.6); #2074 promotes the guard to BLOCK.
 */

import { sep } from "node:path";

/** Repo-relative posix path of the linted file (RuleTester passes one already). */
function repoRelative(filename) {
  const posix = String(filename ?? "").split(sep).join("/");
  const m = /(?:^|\/)(packages\/.*)$/.exec(posix);
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

/**
 * What a module specifier points at: a storefront, another package, or neither.
 * `fileRel` anchors the relative forms.
 */
function classify(spec, fileRel) {
  if (spec === "@" || spec.startsWith("@/")) return { kind: "apps" };
  if (spec === "apps" || spec.startsWith("apps/")) return { kind: "apps" };
  const ds = /^@ds\/([^/]+)/.exec(spec);
  if (ds) return { kind: "package", name: ds[1] };
  if (spec.startsWith(".")) {
    const segments = resolveRelative(dirOf(fileRel), spec).split("/");
    if (segments[0] === "apps") return { kind: "apps" };
    if (segments[0] === "packages" && segments[1]) {
      return { kind: "package", name: segments[1] };
    }
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid a package under packages/** from importing apps/** (directly, via the host @/ alias, or via a relative climb) and from importing another package against the declared dependency graph (#2002, tech spec 2026-09-07-one-code-two-storefronts-plan-en.md §3 rule 3 / §4). The graph is supplied as data via the `graph` option.",
    },
    schema: [
      {
        type: "object",
        properties: {
          graph: {
            type: "object",
            additionalProperties: {
              type: "array",
              items: { type: "string" },
              uniqueItems: true,
            },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noAppsImport:
        'A package must not import a storefront: "{{spec}}" resolves into `apps/**`. Shared code that needs a host to compile is host code in the wrong directory — move the dependency into the package (or the consumer into the app), never a `paths` alias (tech spec §4). Escape hatch: `// eslint-disable-next-line local/package-import-boundary -- <reason>`.',
      wrongDirection:
        '`@ds/{{from}}` must not import `@ds/{{to}}`: the §4 dependency graph allows `@ds/{{from}}` → [{{allowed}}] only. Fusing units the extraction waves keep separable is a re-sequencing signal, not an allowlist entry (tech spec 2026-09-07-one-code-two-storefronts-plan-en.md §4).',
    },
  },

  create(context) {
    const graph = context.options[0]?.graph ?? {};
    const fileRel = repoRelative(context.filename ?? context.getFilename?.());
    const segments = fileRel.split("/");
    const currentPackage =
      segments[0] === "packages" && segments[1] ? segments[1] : null;

    /** Report on the node carrying the specifier, if it crosses a boundary. */
    function check(node, spec) {
      if (typeof spec !== "string" || spec === "") return;
      const target = classify(spec, fileRel);
      if (!target) return;
      if (target.kind === "apps") {
        context.report({ node, messageId: "noAppsImport", data: { spec } });
        return;
      }
      if (!currentPackage || target.name === currentPackage) return;
      const allowed = graph[currentPackage];
      // A package outside the table makes no direction claim; so does a target
      // that is not a graph node (`@ds/db`, `@ds/utils` — class (a) only).
      if (!allowed || !(target.name in graph)) return;
      if (allowed.includes(target.name)) return;
      context.report({
        node,
        messageId: "wrongDirection",
        data: {
          from: currentPackage,
          to: target.name,
          allowed: allowed.map((p) => `@ds/${p}`).join(", ") || "nothing",
        },
      });
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
      if (node.source) check(node.source, staticString(node.source));
    }

    return {
      ImportDeclaration: checkSource,
      ExportNamedDeclaration: checkSource,
      ExportAllDeclaration: checkSource,
      ImportExpression: (node) => check(node.source, staticString(node.source)),
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require") {
          return;
        }
        const arg = node.arguments[0];
        check(arg ?? node, staticString(arg));
      },
    };
  },
};

export default rule;
