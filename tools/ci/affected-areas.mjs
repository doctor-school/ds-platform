// tools/ci/affected-areas.mjs — heavy-e2e area classifier for the `changes` job
// of .github/workflows/ci.yml (Issue #2592).
//
// The `code` output only separates docs-only diffs from code diffs, so every
// code PR paid every heavy e2e job — a copy edit in one package nothing boots
// still ran api-e2e + five browser suites. This module maps the PR's changed
// files to workspace packages, closes the set over DEPENDENTS (a change to a
// package affects everything that depends on it, transitively, through any
// dependency field), and emits `run-<job>=true|false` for each heavy job: a job
// runs when ANY package it builds or boots is affected.
//
// The graph is read from the committed package.json manifests at GRAPH_SHA
// (the merge ref CI tests; default: the head) via `git show` — the `changes`
// job has no `pnpm install`, and reading at a ref keeps a dry run over a
// historical range faithful to that range. A file inside a package marks that
// package changed whatever its extension; per-job `extraInputs` cover files a
// job's tests read outside its dependency closure.
//
// Fail-open — every heavy job runs — on: a non-`pull_request` event (`main`
// always verifies the full set), an empty diff, a change to a shared build/CI
// input (FULL_RUN_PATHS), a non-docs path no workspace package owns, a
// HEAVY_JOBS package missing from the workspace, and any classifier error. A
// classifier that cannot prove a job is unaffected never skips it.
//
// Usage: in CI the env carries EVENT_NAME/BASE_SHA/HEAD_SHA/GRAPH_SHA and
// results go to $GITHUB_OUTPUT. Dry run:
// `node tools/ci/affected-areas.mjs --base <sha> --head <sha> [--graph <sha>]`
// (treated as a pull_request range; prints the outputs).

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The ONE job → input mapping. `packages` is what the job's steps build or
 * boot (ci.yml): keep it in sync when a job starts booting another app.
 * `extraInputs` are repo files OUTSIDE those packages' dependency closure that
 * the job's tests read directly (a file read is not a package.json edge, so the
 * graph cannot see it); each entry names its reader.
 */
export const HEAVY_JOBS = {
  "admin-e2e": {
    packages: ["@ds/api", "@ds/admin"],
    extraInputs: [
      // apps/admin/playwright.config.ts `taxonomyTestDir`: bddgen generates the
      // `taxonomy` project from the spec scenarios under featuresRoot.
      /^apps\/docs\/content\/specs\/features\/.*\.feature$/,
    ],
  },
  "api-e2e": {
    packages: ["@ds/api"],
    extraInputs: [
      // apps/api/test/taxonomy/archived-speakers.e2e-spec.ts scans these sources.
      /^apps\/portal\/app\/webinars\/\[slug\]\/page\.tsx$/,
      /^packages\/design-system\/src\/blocks\/event-page-view\.ts$/,
      // apps/api/test/events/hidden-rename.e2e-spec.ts reads the SDK snapshot.
      /^packages\/api-client\/openapi\.snapshot\.json$/,
    ],
  },
  "playwright-academy-demo": {
    packages: ["@ds/academy-demo"],
    extraInputs: [],
  },
  "playwright-axe": { packages: ["@ds/showcase"], extraInputs: [] },
  "playwright-axe-doctor": { packages: ["@ds/doctor"], extraInputs: [] },
  "playwright-axe-portal": { packages: ["@ds/portal"], extraInputs: [] },
  "standalone-boot": {
    packages: ["@ds/portal", "@ds/admin", "@ds/doctor"],
    extraInputs: [],
  },
};

/**
 * Docs-class paths: the same set the `code` classifier ignores. Applied ONLY
 * to files no workspace package owns — inside a package any extension
 * (`.md` legal documents, an authz matrix) can be a runtime or test input.
 */
const DOCS_CLASS = [/\.md$/, /^apps\/docs\/content\//, /^design-source\//];

/**
 * Shared build/CI inputs every heavy job consumes (install, toolchain, the
 * workflow itself, the scripts the jobs execute, the stand they boot, images).
 */
const FULL_RUN_PATHS = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^turbo\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^\.npmrc$/,
  /^\.nvmrc$/,
  // `.github/ui-evidence/**` is PR screenshot evidence, read by no job — left
  // to the unowned-path rule (NO_HEAVY_IMPACT) so every UI PR is not a full run.
  /^\.github\/(?!ui-evidence\/)/,
  /^tools\/ci\//,
  /^tools\/scripts\//,
  /^infra\//,
  /(?:^|\/)Dockerfile[^/]*$/,
  /\.dockerfile$/,
  /(?:^|\/)\.dockerignore$/,
  /(?:^|\/)(?:docker-)?compose[^/]*\.ya?ml$/,
];

/**
 * Paths outside every workspace package that no heavy job reads: agent
 * configuration, changeset entries, editor settings, and repo tooling other
 * than the tools/ci + tools/scripts the jobs execute (both fail open above).
 * Any other unowned path fails open.
 */
const NO_HEAVY_IMPACT = [
  /^\.claude\//,
  /^\.codex\//,
  /^\.agents\//,
  /^\.changeset\//,
  /^\.vscode\//,
  /^\.design-sync\//,
  /^\.github\/ui-evidence\//,
  /^tools\//,
];

/** `packages:` entries of pnpm-workspace.yaml; refuses globs it cannot expand exactly. */
export function parseWorkspacePatterns(yaml) {
  const patterns = [];
  let inPackages = false;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = /^packages:\s*$/.test(line);
      continue;
    }
    const entry = inPackages && line.match(/^\s+-\s+(.+?)\s*$/);
    if (!entry) continue;
    const pattern = entry[1].replace(/^(["'])(.*)\1$/, "$2");
    if (
      pattern.startsWith("!") ||
      /\*\*|\*./.test(pattern) ||
      /[?[{]/.test(pattern)
    )
      throw new Error(`unsupported workspace pattern '${pattern}'`);
    patterns.push(pattern.replace(/\/$/, ""));
  }
  if (patterns.length === 0)
    throw new Error("no workspace patterns in pnpm-workspace.yaml");
  return patterns;
}

function patternMatchesDir(pattern, dir) {
  if (pattern.endsWith("/*")) {
    const parent = pattern.slice(0, -2);
    return (
      dir.startsWith(`${parent}/`) &&
      !dir.slice(parent.length + 1).includes("/")
    );
  }
  return dir === pattern;
}

/**
 * Builds the workspace graph from `{ "<dir>/package.json": manifest }`, keeping
 * only manifests whose dir a workspace pattern selects.
 */
export function workspaceFromManifests(patterns, manifests) {
  const packages = [];
  for (const [file, manifest] of Object.entries(manifests)) {
    const dir = file.replace(/\/package\.json$/, "");
    if (!patterns.some((pattern) => patternMatchesDir(pattern, dir))) continue;
    if (!manifest.name) throw new Error(`${file} has no name`);
    packages.push({ name: manifest.name, dir, manifest });
  }
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const dependents = new Map(packages.map((pkg) => [pkg.name, new Set()]));
  for (const pkg of packages) {
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const dep of Object.keys(pkg.manifest[field] ?? {})) {
        if (byName.has(dep)) dependents.get(dep).add(pkg.name);
      }
    }
  }
  // Longest dir first, so a nested package wins over an enclosing one.
  const byDir = [...packages].sort((a, b) => b.dir.length - a.dir.length);
  return { byName, byDir, dependents };
}

function allJobs(value) {
  return Object.fromEntries(Object.keys(HEAVY_JOBS).map((job) => [job, value]));
}

/**
 * @returns {{ fullRun: string | null, affected: string[], jobs: Record<string, boolean> }}
 */
export function classifyAffectedAreas({ event, paths, workspace }) {
  const full = (reason) => ({
    fullRun: reason,
    affected: [],
    jobs: allJobs(true),
  });
  if (event !== "pull_request")
    return full(`event '${event}' is not a pull_request`);
  if (paths.length === 0) return full("empty changed-file set");

  // A renamed/removed mapped package would otherwise skip its job on every PR
  // silently; throwing makes the caller fail open instead.
  for (const [job, { packages }] of Object.entries(HEAVY_JOBS)) {
    for (const name of packages) {
      if (!workspace.byName.has(name))
        throw new Error(`HEAVY_JOBS['${job}'] names unknown package ${name}`);
    }
  }

  const changed = new Set();
  const extraHits = new Set();
  for (const path of paths) {
    if (FULL_RUN_PATHS.some((re) => re.test(path)))
      return full(`shared build/CI input changed: ${path}`);
    for (const [job, { extraInputs }] of Object.entries(HEAVY_JOBS)) {
      if (extraInputs.some((re) => re.test(path))) extraHits.add(job);
    }
    // Owner first: inside a package every extension counts as that package.
    const owner = workspace.byDir.find((pkg) => path.startsWith(`${pkg.dir}/`));
    if (owner) {
      changed.add(owner.name);
      continue;
    }
    if (DOCS_CLASS.some((re) => re.test(path))) continue;
    if (NO_HEAVY_IMPACT.some((re) => re.test(path))) continue;
    return full(`no workspace package owns ${path}`);
  }

  const affected = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    for (const dependent of workspace.dependents.get(queue.pop()) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }

  const jobs = Object.fromEntries(
    Object.entries(HEAVY_JOBS).map(([job, { packages }]) => [
      job,
      extraHits.has(job) || packages.some((name) => affected.has(name)),
    ]),
  );
  return { fullRun: null, affected: [...affected].sort(), jobs };
}

export function outputLines(result) {
  return Object.keys(result.jobs)
    .sort()
    .map((job) => `run-${job}=${result.jobs[job]}`);
}

function git(args) {
  const run = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${run.stderr.trim()}`);
  return run.stdout;
}

/** Reads the workspace graph from the manifests committed at `ref`. */
export function readWorkspaceAt(ref) {
  const patterns = parseWorkspacePatterns(
    git(["show", `${ref}:pnpm-workspace.yaml`]),
  );
  const manifests = {};
  for (const file of git(["ls-tree", "-r", "--name-only", "-z", ref]).split(
    "\0",
  )) {
    if (!file.endsWith("/package.json")) continue;
    const dir = file.slice(0, -"/package.json".length);
    if (!patterns.some((pattern) => patternMatchesDir(pattern, dir))) continue;
    manifests[file] = JSON.parse(git(["show", `${ref}:${file}`]));
  }
  return workspaceFromManifests(patterns, manifests);
}

function changedPaths(base, head) {
  return git(["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`])
    .split("\0")
    .filter(Boolean);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const arg = (flag) => {
    const at = process.argv.indexOf(flag);
    return at === -1 ? undefined : process.argv[at + 1];
  };
  const dryRun = arg("--base") !== undefined;
  const event = dryRun ? "pull_request" : process.env.EVENT_NAME;
  const base = arg("--base") ?? process.env.BASE_SHA;
  const head = arg("--head") ?? process.env.HEAD_SHA ?? "HEAD";
  // CI tests the merge ref, so the graph is read there (GRAPH_SHA =
  // github.sha): a dependency edge main gained after the branch point counts.
  const graphRef = arg("--graph") ?? process.env.GRAPH_SHA ?? head;

  let result;
  try {
    result =
      event === "pull_request"
        ? classifyAffectedAreas({
            event,
            paths: changedPaths(base, head),
            workspace: readWorkspaceAt(graphRef),
          })
        : classifyAffectedAreas({ event, paths: [], workspace: null });
  } catch (error) {
    result = {
      fullRun: `classifier error: ${error.message}`,
      affected: [],
      jobs: allJobs(true),
    };
  }

  const lines = outputLines(result);
  const summary = [
    result.fullRun
      ? `Heavy e2e: FULL run — ${result.fullRun}`
      : `Heavy e2e: affected packages: ${result.affected.join(", ") || "(none)"}`,
    ...lines,
  ];
  console.log(summary.join("\n"));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
}
