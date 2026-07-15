#!/usr/bin/env tsx
/**
 * tools/lint/route-target-lint.ts — WARN v1 route-target guard (Issue #676).
 *
 * Why this exists: an internal navigation target can point at a route that does
 * not exist. #673 shipped a `/webinars/<slug>/room` navigation before the
 * matching `app/webinars/[slug]/room/page.tsx` route existed — a dead link that
 * typecheck/lint could not see (an href string is just a string). This guard
 * makes that class of defect fire at CI time: every internal nav target in
 * `apps/portal` and `apps/admin` must resolve to a real app-router route.
 *
 * ── What it scans ─────────────────────────────────────────────────────────────
 * For each app (`apps/portal`, `apps/admin`) it collects internal navigation
 * targets from `*.ts`/`*.tsx` source (tests/stories excluded):
 *   - `<Link href="…">` / `href={"…"}` / `href={`…`}` (string OR template literal)
 *   - `router.push("…")` / `router.replace("…")`
 *   - `redirect("…")`
 * The path may be a string literal OR a template literal. A template's `${…}`
 * interpolations are resolved to a dynamic segment: `/webinars/${slug}/room`
 * resolves to the route `/webinars/[*]/room` (the `room` literal still has to
 * exist under the dynamic parent).
 *
 * ── How a target is resolved ──────────────────────────────────────────────────
 * The app-router route tree is built from `page.tsx` / `route.ts` files under
 * that app's `app/` (or `src/app/`) dir. Folder names map to segments; Next.js
 * route groups `(group)` and private `_folders` are folded out of the URL;
 * dynamic `[seg]`, catch-all `[...seg]`, and optional catch-all `[[...seg]]`
 * folders match accordingly. A target resolves if some route pattern matches it
 * segment-for-segment and ends on a routable (page/route) node. Query strings
 * (`?…`) and hash fragments (`#…`) are stripped before matching.
 *
 * ── Deliberately out of scope (first cut) ─────────────────────────────────────
 * Only string literals and template literals are evaluated — arbitrary computed
 * expressions are NOT. A target that is a bare variable / call
 * (`router.push(nextUrl)`), or a template whose FIRST segment is an
 * interpolation (`` `${base}/x` `` — no static `/`-anchored prefix), or any path
 * not starting with `/` (external URL, relative link, `mailto:`/`tel:`, pure
 * `#hash`, protocol-relative `//host`) is SKIPPED — the guard cannot know the
 * value, so it does not guess. A line may also opt out explicitly with the
 * inline marker `// route-target-ok: <reason>` (reason required) for a genuinely
 * dynamic target the guard would otherwise skip anyway or a known false-positive.
 *
 * ── Output / severity ─────────────────────────────────────────────────────────
 * Unresolvable target → stderr `file:line -> target` + exit 1. Clean → exit 0.
 * WARN v1 in Phase 0 (ADR-0007 §2.6; new guard lands WARN, CI job uses
 * `continue-on-error: true`, promote to BLOCK once stable).
 *
 * Seam: `LINT_FIXTURE_ROOT` (guard-tests harness) points the scan at a fixture
 * tree; inert in production (unset → repo root from import.meta.url).
 * Run: `pnpm lint:route-targets`. Findings: stderr + exit 1. Clean: exit 0.
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
const TAG = "[route-target]";

/** Apps whose internal nav targets are checked. */
const APPS = ["apps/portal", "apps/admin"];

/** Source globs (relative to an app dir) scanned for nav targets. */
const SRC_GLOBS = ["**/*.{ts,tsx}"];
const SRC_IGNORE = [
  "**/*.test.{ts,tsx}",
  "**/*.spec.{ts,tsx}",
  "**/*.stories.{ts,tsx}",
  "**/__tests__/**",
  "**/node_modules/**",
  "**/.next/**",
];

/** Route-file globs (relative to an app's `app/` dir) defining the route tree. */
const ROUTE_FILE_GLOB = "**/{page,route}.{ts,tsx,js,jsx}";

// Sentinel standing in for a `${…}` interpolation in a template literal. A
// segment containing it is treated as dynamic (matches a `[seg]` route folder).
const INTERP = "__INTERP__";

const SUPPRESS_RE = /\broute-target-ok\s*:\s*\S/i;

// href="…" / href='…' / href={"…"} / href={'…'} / href={`…`} / href=`…`
const HREF_RE = /\bhref=(?:\{\s*)?(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
// router.push("…") / router.replace(`…`) / redirect("…")
const NAV_RE =
  /\b(?:router\.(?:push|replace)|redirect)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

interface RawTarget {
  file: string;
  line: number;
  /** The literal/template content as written (template still holds `${…}`). */
  raw: string;
  isTemplate: boolean;
}

interface Finding {
  file: string;
  line: number;
  target: string;
}

/** A node in the route trie. */
interface RouteNode {
  children: Map<string, RouteNode>;
  /** A routable page/route file terminates here. */
  terminal: boolean;
}

function newNode(): RouteNode {
  return { children: new Map(), terminal: false };
}

/** Is a folder name a Next.js route group `(group)` or private `_folder`? */
function isFoldedOut(seg: string): boolean {
  return seg.startsWith("(") || seg.startsWith("@") || seg.startsWith("_");
}

/**
 * Build a route trie for an app from its `page`/`route` files. The route path of
 * a file is its directory relative to the `app/` root, with route groups /
 * private folders folded out.
 */
function buildRouteTrie(routeFiles: string[], appDir: string): RouteNode {
  const root = newNode();
  for (const file of routeFiles) {
    const relDir = relative(appDir, dirname(file)).replace(/\\/g, "/");
    const segs = relDir
      .split("/")
      .filter((s) => s.length > 0 && !isFoldedOut(s));
    let node = root;
    for (const seg of segs) {
      let child = node.children.get(seg);
      if (!child) {
        child = newNode();
        node.children.set(seg, child);
      }
      node = child;
    }
    node.terminal = true;
  }
  return root;
}

const DYN_RE = /^\[[^.\]]+\]$/; // [seg]
const CATCH_RE = /^\[\.\.\.[^\]]+\]$/; // [...seg]
const OPT_CATCH_RE = /^\[\[\.\.\.[^\]]+\]\]$/; // [[...seg]]

/** Does a target segment (literal or INTERP) match a dynamic route folder? */
function isDynamicFolder(routeSeg: string): boolean {
  return DYN_RE.test(routeSeg);
}

/**
 * Recursively test whether `segs[i..]` matches some route pattern rooted at
 * `node`, ending on a terminal node.
 */
function matchFrom(node: RouteNode, segs: string[], i: number): boolean {
  if (i >= segs.length) return node.terminal;
  const seg = segs[i];
  const isInterp = seg.includes(INTERP);

  for (const [name, child] of node.children) {
    if (OPT_CATCH_RE.test(name)) {
      // Optional catch-all matches 0+ remaining segments.
      if (child.terminal) return true;
    }
    if (CATCH_RE.test(name)) {
      // Catch-all matches 1+ remaining segments (we are at 1+ here).
      if (child.terminal) return true;
      continue;
    }
    if (isInterp) {
      // An interpolated segment can only match a dynamic route folder.
      if (isDynamicFolder(name) && matchFrom(child, segs, i + 1)) return true;
    } else {
      // A literal target segment matches an identical literal folder…
      if (name === seg && matchFrom(child, segs, i + 1)) return true;
      // …or any dynamic folder (which accepts any concrete value).
      if (isDynamicFolder(name) && matchFrom(child, segs, i + 1)) return true;
    }
  }
  return false;
}

/**
 * Normalise a raw target into `/`-anchored segments, or `null` if the target is
 * out of scope (external, relative, computed-prefix, pure hash…).
 */
function toSegments(raw: string, isTemplate: boolean): string[] | null {
  let path = raw;
  if (isTemplate) {
    // Collapse each `${…}` interpolation to the INTERP sentinel.
    path = path.replace(/\$\{[^}]*\}/g, INTERP);
  }
  // Strip query string / hash fragment.
  path = path.replace(/[?#].*$/s, "");
  // Only `/`-anchored internal paths are in scope. Protocol-relative `//host`,
  // external URLs, `mailto:`/`tel:`, relative links, pure `#hash`, and templates
  // whose first segment is an interpolation (no static `/` prefix) fall out here.
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  const segs = path.split("/").filter((s) => s.length > 0);
  return segs; // [] === the index route `/`
}

function collectTargets(files: string[]): RawTarget[] {
  const out: RawTarget[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (SUPPRESS_RE.test(line)) return;
      for (const re of [HREF_RE, NAV_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          out.push({
            file,
            line: idx + 1,
            raw: m[2],
            isTemplate: m[1] === "`",
          });
        }
      }
    });
  }
  return out;
}

async function main(): Promise<void> {
  const findings: Finding[] = [];
  let scannedFiles = 0;
  let checkedTargets = 0;

  for (const app of APPS) {
    const appRoot = resolve(REPO_ROOT, app);
    // App-router dir: `app/` or `src/app/`.
    const appDirs = await fg(["app", "src/app"], {
      cwd: appRoot,
      onlyDirectories: true,
      absolute: true,
    });
    if (appDirs.length === 0) continue;
    const appDir = appDirs[0];

    const routeFiles = await fg([ROUTE_FILE_GLOB], {
      cwd: appDir,
      absolute: true,
      ignore: ["**/node_modules/**", "**/.next/**"],
    });
    const trie = buildRouteTrie(routeFiles, appDir);

    const srcFiles = await fg(SRC_GLOBS, {
      cwd: appRoot,
      ignore: SRC_IGNORE,
      absolute: true,
    });
    scannedFiles += srcFiles.length;

    for (const t of collectTargets(srcFiles)) {
      const segs = toSegments(t.raw, t.isTemplate);
      if (segs === null) continue; // out of scope — not the guard's business
      checkedTargets += 1;
      if (!matchFrom(trie, segs, 0)) {
        findings.push({ file: t.file, line: t.line, target: t.raw });
      }
    }
  }

  info(
    `scanned ${scannedFiles} source file(s); checked ${checkedTargets} internal nav target(s).`,
  );

  if (findings.length === 0) {
    info("PASS — every internal nav target resolves to a real app-router route.");
    process.exit(0);
  }

  for (const f of findings) {
    const rel = relative(REPO_ROOT, f.file).replace(/\\/g, "/");
    process.stderr.write(`${TAG} ${rel}:${f.line} -> ${f.target}\n`);
  }
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} nav target(s) do not resolve to an existing ` +
      `app-router route. Add the route (page.tsx/route.ts) or fix the target. A genuinely ` +
      `dynamic target the guard cannot evaluate may carry \`// route-target-ok: <reason>\`.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
