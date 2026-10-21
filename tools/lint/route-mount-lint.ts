#!/usr/bin/env tsx
/**
 * tools/lint/route-mount-lint.ts — the ROUTE-MOUNT check of the
 * one-code-two-storefronts plan (Issue #2002, tech spec
 * `apps/docs/content/specs/tech/2026-09-07-one-code-two-storefronts-plan-en.md`
 * §3 rule 3, «Route mount» bullet + «Honest limit» bullet; §5).
 *
 * Why this exists: the host-file allowlist (`host-allowlist-lint.ts`) scans
 * everything under `apps/{portal,doctor}` EXCEPT Next.js route files, so the
 * one place a storefront can still grow host logic unobserved is `page.tsx`
 * itself — fetch-and-branch written straight into the route, and the allowlist
 * stays green. §5 is explicit that the allowlist alone is necessary, not
 * sufficient; this guard closes that hole from the other side. A route file
 * whose registry row assigns it to a package is a THIN PROJECTION: it mounts
 * the package's page export, hands it the host-config object, and does nothing
 * else.
 *
 * What it checks (three classes, each its own finding):
 *   1. TREE — every `apps/{portal,doctor}/app/**\/{page,layout}.tsx` needs an
 *      exact-path row in the checked-in answer key
 *      (`capability-ownership.md` → «Route-file registry»); every row must name
 *      a live file (stale rows rot the key), no row may be a glob (one `**` row
 *      makes the check vacuously green), and `until` must be one of the three
 *      recorded states: `wave N (#Issue)`, `mounted`, `permanent`.
 *   2. MOUNT — for a `mounted` row the file is parsed with the TypeScript
 *      compiler API (structure, never a regex over source text): the only
 *      imports allowed are the row's package (`@ds/<name>` and its subpaths),
 *      the route's own host-config module (a relative `host-config` /
 *      `*.host-config` specifier) and `import type … from "next"`; the only
 *      top-level statements allowed are those imports, the Next segment-config
 *      exports, and ONE default export whose body is a single `return` of the
 *      package mount with props built from identifiers and literals, optionally
 *      preceded by `await` of the route props (`params` / `searchParams`).
 *      Anything else — a `fetch`, another `await`, `if` / ternary / `&&`
 *      branching, `try`, a call that is not the mount — is a finding.
 *      SERVER-ACTION BINDING — a server action cannot live in the package
 *      bound to a host (the package never imports a host config) nor in the
 *      host-config module (an action needs a `"use server"` module or an
 *      inline server function), so a mounted route may import ONE
 *      same-directory sibling (`./<name>`) that is nothing but that binding,
 *      and the sibling is parsed too: a `"use server"` directive; imports only
 *      from the row's package (and subpaths), the host-config module and
 *      `import type … from "react"`; every other top-level statement an
 *      exported async function whose body is a single
 *      `return <packageFn>(<HOST_CONFIG>, …)` — the callee imported from the
 *      package, the first argument imported from the host-config module, the
 *      remaining arguments free of calls, `await` and branching. Anything else
 *      in the sibling is a finding, so host logic cannot hide there.
 *   3. HONEST LIMIT — on a `pull_request` event, a diff touching a route file
 *      whose `until` names an extraction wave is reported with the row quoted.
 *      Those pages still carry inline host logic (the wave has not extracted
 *      them yet) and their body is deliberately NOT read, so the claim stays
 *      honest: growth of a doomed route file is an annotation, never a
 *      blocking finding (tech spec §3 rule 3 «Honest limit»).
 *
 * Out of scope by design: `loading` / `error` / `not-found` / `template` /
 * `default` / `route` files. The first five are presentational shells and
 * `route.ts` is an API stub — none of them is the composition surface a wave
 * extracts, and all of them stay excluded from the allowlist too.
 *
 * Severity: BLOCK (ADR-0007 §2.6; tech spec §5) — a plain step of the
 * `guards-block` batch, which is in the `ci` needs-list. Classes 1 and 2 exit 1;
 * class 3 alone prints its annotation and exits 0.
 *
 * Outside a `pull_request` event class 3 is skipped with an info line; classes
 * 1 and 2 always run (that is what `pnpm pr:preflight --static` executes).
 *
 * Run: `pnpm lint:route-mount`. Findings: stderr, exit 1. Clean: stdout
 * summary, exit 0.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, posix, resolve } from "node:path";
import fg from "fast-glob";
import ts from "typescript";

import { ghViewJson } from "./lib/gh";
import {
  GLOB_CHARS_RE,
  REGISTRY_REL,
  type Row,
  WAVE_RE,
  parseRegistryRows,
  registryRoot,
} from "./lib/registry-rows";

// TEST SEAM: `LINT_FIXTURE_ROOT` (honoured by `registryRoot()`) lets the
// guard-tests harness point the scan at a fixture tree. Inert in production.
const REPO_ROOT = registryRoot();
const TAG = "[route-mount]";

/** The heading that opens the route-file section of the shared answer key. */
const SECTION_HEADING = "## Route-file registry";

/** Composition route files only — see the header on the excluded basenames. */
const SCAN_GLOBS = [
  "apps/portal/app/**/page.tsx",
  "apps/portal/app/**/layout.tsx",
  "apps/doctor/app/**/page.tsx",
  "apps/doctor/app/**/layout.tsx",
];
const SCAN_IGNORE = [
  "**/node_modules/**",
  "**/.next/**",
  "**/e2e/**",
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*",
];

/** The three recorded lifetimes of a route-file row. */
const UNTIL_WAVE_RE = /^wave\s+\d+\s*\(#\d+\)$/;
const UNTIL_STATES = ["`wave N (#Issue)`", "`mounted`", "`permanent`"];
/** The package cell of a mounted/wave row: a backticked `@ds/<name>`. */
const PACKAGE_RE = /`(@ds\/[a-z0-9-]+)`/;
/** A host-config module, by the file convention the import-boundary guard uses. */
const HOST_CONFIG_RE = /^([\w.-]+\.)?host-config$/;
/** Next.js segment config — declarative route metadata, not host logic. */
const SEGMENT_CONFIG = new Set([
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "metadata",
  "viewport",
]);
/** The only values a mounted route body may `await`: its own route props. */
const ROUTE_PROPS = new Set(["params", "searchParams", "props"]);

interface GhPR {
  number: number;
  files?: { path: string }[];
}

function fail(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** Repo-relative posix paths of every composition route file. */
function scanRouteFiles(): string[] {
  return fg.sync(SCAN_GLOBS, { cwd: REPO_ROOT, ignore: SCAN_IGNORE }).sort();
}

/** `wave` | `mounted` | `permanent` | null for an unrecognised `until`. */
function classifyUntil(until: string): string | null {
  if (until === "mounted" || until === "permanent") return until;
  return UNTIL_WAVE_RE.test(until) ? "wave" : null;
}

/** True for `params`, `searchParams`, `props` and any property read off them. */
function isRouteProp(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) return ROUTE_PROPS.has(expr.text);
  if (ts.isPropertyAccessExpression(expr)) return isRouteProp(expr.expression);
  return false;
}

/**
 * Recursively reject the node kinds a thin projection cannot contain: any call
 * (the mount is JSX, not a call), any `await`, and any branching. Applied to
 * the segment-config initialisers, the pre-mount `await`s and the mount JSX, so
 * host logic cannot hide inside an allowed statement shape.
 */
function banWalk(
  node: ts.Node,
  sf: ts.SourceFile,
  rel: string,
  findings: string[],
): void {
  const at = (n: ts.Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const flag = (n: ts.Node, what: string) =>
    findings.push(
      `${rel}:${at(n)}: body beyond mount + config — ${what}; a mounted route file mounts the package and passes its host config, nothing else`,
    );
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      flag(n, `a call (\`${n.expression.getText(sf).slice(0, 40)}\`)`);
    } else if (ts.isAwaitExpression(n)) {
      flag(n, "an `await` outside the route props");
    } else if (ts.isConditionalExpression(n)) {
      flag(n, "a ternary");
    } else if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      flag(n, "branching (`&&` / `||` / `??`)");
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
}

/** Names imported from the row's package — the only legal mount targets. */
function collectMountNames(
  decl: ts.ImportDeclaration,
  into: Set<string>,
): void {
  const clause = decl.importClause;
  if (!clause) return;
  if (clause.name) into.add(clause.name.text);
  const b = clause.namedBindings;
  if (b && ts.isNamedImports(b))
    for (const e of b.elements) into.add(e.name.text);
  if (b && ts.isNamespaceImport(b)) into.add(b.name.text);
}

/** True when a module specifier names a host-config module. */
function isHostConfigSpec(spec: string): boolean {
  return (
    spec.startsWith(".") &&
    HOST_CONFIG_RE.test(basename(spec).replace(/\.(ts|tsx)$/, ""))
  );
}

/**
 * The repo-relative path of a same-directory sibling module (`./<name>`, no
 * deeper path) next to route file `rel`, or null when `spec` is not one or no
 * such `.ts` / `.tsx` file exists.
 */
function siblingOf(rel: string, spec: string): string | null {
  const m = /^\.\/([\w.-]+)$/.exec(spec);
  if (!m) return null;
  const stem = posix.join(dirname(rel).replace(/\\/g, "/"), m[1]);
  for (const cand of [stem, `${stem}.ts`, `${stem}.tsx`]) {
    if (/\.tsx?$/.test(cand) && existsSync(resolve(REPO_ROOT, cand)))
      return cand;
  }
  return null;
}

/** True when `st` carries the modifier `kind` (`export`, `async`, …). */
function hasModifier(st: ts.Statement, kind: ts.SyntaxKind): boolean {
  return (
    (ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined)?.some(
      (m) => m.kind === kind,
    ) ?? false
  );
}

/**
 * The sibling server-action binding of a mounted route: `"use server"`, imports
 * from the row's package / the host-config module / `import type` from `react`
 * only, and exported async functions whose body is a single
 * `return <packageFn>(<HOST_CONFIG>, …)` — so the binding names its config and
 * nothing else.
 */
function checkBinding(rel: string, pkg: string): string[] {
  const findings: string[] = [];
  const src = readFileSync(resolve(REPO_ROOT, rel), "utf8");
  const sf = ts.createSourceFile(
    rel,
    src,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const at = (n: ts.Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const beyond = (n: ts.Node, what: string) =>
    findings.push(
      `${rel}:${at(n)}: beyond the server-action binding — ${what}; the sibling of a mounted route only binds \`${pkg}\`'s function to its host config`,
    );
  const pkgFns = new Set<string>();
  const configs = new Set<string>();
  const stmts = sf.statements;
  const first = stmts[0];
  const directive =
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server";
  if (!directive) {
    findings.push(
      `${rel}:1: a route's sibling module must open with the \`"use server"\` directive — only a server-action binding may sit beside a mounted route`,
    );
  }
  let exportsSeen = 0;
  for (const st of directive ? stmts.slice(1) : stmts) {
    if (ts.isImportDeclaration(st)) {
      const spec = ts.isStringLiteral(st.moduleSpecifier)
        ? st.moduleSpecifier.text
        : "";
      const clause = st.importClause;
      if (spec === pkg || spec.startsWith(`${pkg}/`)) {
        if (clause && !clause.isTypeOnly) {
          if (clause.name) pkgFns.add(clause.name.text);
          const b = clause.namedBindings;
          if (b && ts.isNamedImports(b))
            for (const e of b.elements)
              if (!e.isTypeOnly) pkgFns.add(e.name.text);
        }
      } else if (isHostConfigSpec(spec)) {
        if (clause && !clause.isTypeOnly) collectMountNames(st, configs);
      } else if (!(spec === "react" && clause?.isTypeOnly === true)) {
        findings.push(
          `${rel}:${at(st)}: foreign import \`${spec}\` — a server-action binding imports only \`${pkg}\` (and its subpaths), the host-config module, and \`import type … from "react"\``,
        );
      }
      continue;
    }
    if (
      !ts.isFunctionDeclaration(st) ||
      !hasModifier(st, ts.SyntaxKind.ExportKeyword) ||
      !hasModifier(st, ts.SyntaxKind.AsyncKeyword)
    ) {
      beyond(
        st,
        "a top-level statement that is neither an import nor an exported async function",
      );
      continue;
    }
    exportsSeen += 1;
    const body = st.body?.statements ?? ts.factory.createNodeArray();
    const ret = body[0];
    if (body.length !== 1 || !ret || !ts.isReturnStatement(ret)) {
      beyond(st, "an export whose body is not a single `return`");
      continue;
    }
    let e = ret.expression;
    while (e && ts.isParenthesizedExpression(e)) e = e.expression;
    if (!e || !ts.isCallExpression(e) || !ts.isIdentifier(e.expression)) {
      beyond(ret, "the export does not return a package call");
      continue;
    }
    if (!pkgFns.has(e.expression.text)) {
      findings.push(
        `${rel}:${at(e)}: \`${e.expression.text}\` is not imported from \`${pkg}\` — a server-action binding returns a call of the package's own function`,
      );
    }
    const [cfg, ...rest] = e.arguments;
    if (!cfg || !ts.isIdentifier(cfg) || !configs.has(cfg.text)) {
      findings.push(
        `${rel}:${at(e)}: the first argument is not imported from the host-config module — a server-action binding passes its host config first`,
      );
    }
    for (const a of rest) banWalk(a, sf, rel, findings);
  }
  if (directive && exportsSeen === 0) {
    findings.push(
      `${rel}: no exported async function — a server-action binding exports the bound action`,
    );
  }
  return findings;
}

/** Class 2 for one `mounted` row: the file is a thin projection or it is not. */
function checkMount(
  rel: string,
  pkg: string,
): { findings: string[]; bindings: number } {
  const findings: string[] = [];
  const src = readFileSync(resolve(REPO_ROOT, rel), "utf8");
  const sf = ts.createSourceFile(
    rel,
    src,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const at = (n: ts.Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const beyond = (n: ts.Node, what: string) =>
    findings.push(
      `${rel}:${at(n)}: body beyond mount + config — ${what}; a mounted route file mounts the package and passes its host config, nothing else`,
    );
  const mounts = new Set<string>();
  const bindings: string[] = [];
  let fn:
    | ts.FunctionDeclaration
    | ts.ArrowFunction
    | ts.FunctionExpression
    | undefined;

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const spec = ts.isStringLiteral(st.moduleSpecifier)
        ? st.moduleSpecifier.text
        : "";
      const fromPkg = spec === pkg || spec.startsWith(`${pkg}/`);
      const isHostConfig = isHostConfigSpec(spec);
      const isNextType =
        spec === "next" && st.importClause?.isTypeOnly === true;
      const sibling = fromPkg || isHostConfig ? null : siblingOf(rel, spec);
      if (fromPkg) collectMountNames(st, mounts);
      else if (sibling && bindings.length === 0) bindings.push(sibling);
      else if (sibling) {
        findings.push(
          `${rel}:${at(st)}: a second sibling \`${spec}\` — a mounted route file imports ONE server-action binding at most`,
        );
      } else if (!isHostConfig && !isNextType) {
        findings.push(
          `${rel}:${at(st)}: foreign import \`${spec}\` — a mounted route file imports only \`${pkg}\` (and its subpaths), its own host-config module, one sibling server-action binding, and \`import type … from "next"\``,
        );
      }
      continue;
    }
    if (ts.isVariableStatement(st)) {
      const exported = st.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      const names = st.declarationList.declarations.map((d) =>
        ts.isIdentifier(d.name) ? d.name.text : "",
      );
      if (exported && names.every((n) => SEGMENT_CONFIG.has(n))) {
        for (const d of st.declarationList.declarations) {
          if (d.initializer) banWalk(d.initializer, sf, rel, findings);
        }
        continue;
      }
      beyond(st, "a top-level binding that is not Next segment config");
      continue;
    }
    if (
      ts.isFunctionDeclaration(st) &&
      st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      fn = st;
      continue;
    }
    if (ts.isExportAssignment(st) && !st.isExportEquals) {
      const e = st.expression;
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
        fn = e;
        continue;
      }
    }
    beyond(
      st,
      "a top-level statement that is neither an import, segment config nor the default export",
    );
  }

  for (const b of bindings) findings.push(...checkBinding(b, pkg));
  const done = () => ({ findings, bindings: bindings.length });

  if (!fn) {
    findings.push(
      `${rel}: no default export — a \`mounted\` row promises this route mounts \`${pkg}\`'s page export`,
    );
    return done();
  }

  const checkMountExpr = (expr: ts.Expression | undefined, node: ts.Node) => {
    let e = expr;
    while (e && ts.isParenthesizedExpression(e)) e = e.expression;
    if (!e || (!ts.isJsxElement(e) && !ts.isJsxSelfClosingElement(e))) {
      beyond(node, "the default export does not return a single package mount");
      return;
    }
    const tag = ts.isJsxElement(e) ? e.openingElement.tagName : e.tagName;
    const name = tag.getText(sf).split(".")[0];
    if (!mounts.has(name)) {
      findings.push(
        `${rel}:${at(e)}: the mount \`<${tag.getText(sf)}>\` is not imported from \`${pkg}\` — a mounted route file renders the package's page export`,
      );
    }
    banWalk(e, sf, rel, findings);
  };

  const body = fn.body;
  if (!body) {
    beyond(fn, "the default export has no body");
    return done();
  }
  if (!ts.isBlock(body)) {
    checkMountExpr(body as ts.Expression, fn);
    return done();
  }
  const stmts = body.statements;
  let returned = false;
  for (const st of stmts) {
    if (ts.isReturnStatement(st)) {
      if (st !== stmts[stmts.length - 1]) {
        beyond(st, "an early `return`");
      }
      returned = true;
      checkMountExpr(st.expression, st);
      continue;
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer;
        if (
          init &&
          ts.isAwaitExpression(init) &&
          isRouteProp(init.expression)
        ) {
          banWalk(init.expression, sf, rel, findings);
          continue;
        }
        beyond(
          st,
          "only `await` of the route props (`params` / `searchParams`) may precede the mount",
        );
      }
      continue;
    }
    beyond(st, `\`${st.getText(sf).split("\n")[0].trim().slice(0, 60)}\``);
  }
  if (!returned)
    beyond(fn, "the default export never returns the package mount");
  return done();
}

function resolvePrNumber(): string {
  let prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber && process.env.GITHUB_REF) {
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  return prNumber;
}

/**
 * Class 3 — the honest limit. A `wave N` route file still holds inline host
 * logic the guard deliberately does not read; a PR growing it is reported, not
 * blocked. Returns an empty list when the check does not apply.
 */
async function honestLimit(rows: Row[]): Promise<string[]> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    info(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}), honest-limit check skipped`,
    );
    return [];
  }
  const prNumber = resolvePrNumber();
  if (!prNumber) {
    info(
      "cannot determine PR number from environment, honest-limit check skipped",
    );
    return [];
  }
  const res = await ghViewJson<GhPR>("pr", prNumber, "number,files");
  if (!res.ok) {
    process.stderr.write(
      `${TAG} gh pr view ${prNumber} failed: ${res.error}\n`,
    );
    return [];
  }
  const touched = new Set((res.data.files ?? []).map((f) => f.path));
  return rows
    .filter((r) => touched.has(r.path) && WAVE_RE.test(r.until))
    .map(
      (r) =>
        `${r.path}: PR #${prNumber} grows a route file that still carries inline host logic until its extraction wave — ` +
        `row: | \`${r.path}\` | ${r.reason} | ${r.until} |`,
    );
}

async function main(): Promise<void> {
  let rows: Row[];
  try {
    rows = parseRegistryRows(SECTION_HEADING);
  } catch (e) {
    fail((e as Error).message);
  }
  const listed = new Map(rows.map((r) => [r.path, r]));
  const findings: string[] = [];

  // Class 1a — the answer key checks itself first: a rotten key cannot judge a tree.
  for (const row of rows) {
    if (GLOB_CHARS_RE.test(row.path)) {
      findings.push(
        `glob row \`${row.path}\` — the route-file registry takes EXACT repo-relative paths; ` +
          `a pattern makes the tree check vacuously green`,
      );
      continue;
    }
    if (!existsSync(resolve(REPO_ROOT, row.path))) {
      findings.push(
        `stale row \`${row.path}\` — the file no longer exists; the row is deleted by the PR that deletes the route`,
      );
      continue;
    }
    if (classifyUntil(row.until) === null) {
      findings.push(
        `\`${row.path}\`: invalid \`until\` «${row.until}» — one of ${UNTIL_STATES.join(", ")}`,
      );
    }
  }

  // Class 1b — the tree check, and class 2 for every `mounted` row.
  const files = scanRouteFiles();
  let mountedCount = 0;
  let bindingCount = 0;
  for (const rel of files) {
    const row = listed.get(rel);
    if (!row) {
      findings.push(
        `${rel}: no route-file registry row — add one to ${REGISTRY_REL} under «${SECTION_HEADING}» in THIS PR ` +
          `(the \`@ds/<name>\` it mounts or will mount, and one of ${UNTIL_STATES.join(", ")})`,
      );
      continue;
    }
    if (classifyUntil(row.until) !== "mounted") continue;
    mountedCount += 1;
    const pkg = PACKAGE_RE.exec(row.reason)?.[1];
    if (!pkg) {
      findings.push(
        `\`${rel}\`: a \`mounted\` row must name the package it mounts as a backticked \`@ds/<name>\`, got «${row.reason}»`,
      );
      continue;
    }
    const mount = checkMount(rel, pkg);
    bindingCount += mount.bindings;
    findings.push(...mount.findings);
  }

  // Class 3 — the honest limit: annotated, never blocking.
  const notes = await honestLimit(rows);
  if (notes.length > 0) {
    process.stderr.write(
      `${TAG} ${notes.length} honest limit (annotation, not blocking) — tech spec §3 rule 3:\n`,
    );
    for (const n of notes) process.stderr.write(`::warning::${TAG} ${n}\n`);
  }

  if (findings.length > 0) {
    process.stderr.write(
      `${TAG} ${findings.length} finding(s) — a route file assigned to a package is a thin projection (#2002, tech spec §3 rule 3):\n`,
    );
    for (const f of findings) process.stderr.write(`${TAG}   ${f}\n`);
    process.exit(1);
  }

  info(
    `OK — ${files.length} route file(s) under apps/portal/app + apps/doctor/app all carry a registry row, ` +
      `all ${rows.length} row(s) name an exact, existing path with a recorded lifetime, ` +
      `and all ${mountedCount} \`mounted\` route(s) are mount + config only, ` +
      `with ${bindingCount} server-action binding(s) bound to their host config only.`,
  );
  process.exit(0);
}

void main();
