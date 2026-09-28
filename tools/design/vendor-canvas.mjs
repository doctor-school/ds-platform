#!/usr/bin/env node
// DS Platform — the ONE writer of vendored Claude Design canvases (#2389).
//
//   pnpm design:vendor <pulled-file>… [--remote <path>] [--note <text>]
//   pnpm design:vendor --check
//
// Vendoring = the lead's DesignSync `get_file` pull (lead-only tool) lands the
// canvas bytes on disk; this script copies each pulled `*.dc.html` byte-exact
// into `design-source/` (a file already under `design-source/` is recorded in
// place), computes its sha256 and upserts its entry in
// `design-source/manifest.json` with `pulledAt` = now (UTC), printing
// `NEW|SAME|CHANGED <file> <bytes>`. A real pull drops any earlier `note`
// (e.g. the #2389 backfill note) unless `--note` restates one.
//
// `--check` is the body of the `canvas-provenance` BLOCK guard
// (tools/lint/canvas-provenance-lint.ts): every `design-source/**/*.dc.html`
// has an entry whose sha256 equals its bytes, and every entry has its file.
// Honest limit: this proves the manifest and the bytes agree and that the
// vendoring was an explicit recorded act; it cannot prove, without network,
// that the bytes came from Claude Design. The structural control against a
// code-side canvas edit is ui-parity's co-edit BLOCK (a canvas never shares a
// PR with UI) plus its base-ref canvas read.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

export const DESIGN_SYNC_PROJECT = "8cc2f39a-d58e-4491-b539-4337881ced4f";
export const MANIFEST_REL = "design-source/manifest.json";
const CANVAS_RE = /\.dc\.html$/;

const DEFAULT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Repo root, overridable by the guard-tests seam `LINT_FIXTURE_ROOT`. */
export function repoRoot() {
  return process.env.LINT_FIXTURE_ROOT
    ? resolve(process.env.LINT_FIXTURE_ROOT)
    : DEFAULT_ROOT;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function toPosix(path) {
  return path.split(sep).join("/");
}

/** Every vendored canvas, as a path relative to `design-source/`, sorted. */
export function listCanvases(root) {
  const base = join(root, "design-source");
  if (!existsSync(base)) return [];
  const out = [];
  const walk = (dir) => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, dirent.name);
      if (dirent.isDirectory()) walk(full);
      else if (CANVAS_RE.test(dirent.name))
        out.push(toPosix(relative(base, full)));
    }
  };
  walk(base);
  return out.sort();
}

export function readManifest(root) {
  const path = join(root, MANIFEST_REL);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeManifest(root, manifest) {
  const files = Object.fromEntries(
    Object.keys(manifest.files)
      .sort()
      .map((key) => [key, manifest.files[key]]),
  );
  writeFileSync(
    join(root, MANIFEST_REL),
    `${JSON.stringify({ ...manifest, files }, null, 2)}\n`,
    "utf8",
  );
}

/** The `--check` verdict: `{ ok, problems }`, one problem per line. */
export function checkProvenance(root) {
  const problems = [];
  let manifest;
  try {
    manifest = readManifest(root);
  } catch (error) {
    return {
      ok: false,
      problems: [`${MANIFEST_REL} is not valid JSON: ${error.message}`],
    };
  }
  if (!manifest)
    return {
      ok: false,
      problems: [
        `${MANIFEST_REL} missing — run \`pnpm design:vendor\` on the pulled canvases`,
      ],
    };
  if (manifest.version !== 1)
    problems.push(`${MANIFEST_REL}: version must be 1`);
  if (manifest.designSyncProject !== DESIGN_SYNC_PROJECT)
    problems.push(
      `${MANIFEST_REL}: designSyncProject must be ${DESIGN_SYNC_PROJECT}`,
    );
  const entries =
    manifest.files && typeof manifest.files === "object" ? manifest.files : {};
  const canvases = listCanvases(root);
  for (const rel of canvases) {
    const entry = entries[rel];
    const label = `design-source/${rel}`;
    if (!entry) {
      problems.push(
        `${label}: no manifest entry — vendor it with \`pnpm design:vendor\``,
      );
      continue;
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? ""))
      problems.push(`${label}: sha256 must be 64 hex chars`);
    else if (
      entry.sha256 !== sha256Hex(readFileSync(join(root, "design-source", rel)))
    )
      problems.push(
        `${label}: sha256 mismatch — the file changed without a vendoring pass (Claude Design → DesignSync pull → \`pnpm design:vendor\`)`,
      );
    if (
      typeof entry.pulledAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}/.test(entry.pulledAt) ||
      Number.isNaN(Date.parse(entry.pulledAt))
    )
      problems.push(`${label}: pulledAt must be an ISO date`);
    if (
      entry.remotePath !== undefined &&
      entry.remotePath !== null &&
      typeof entry.remotePath !== "string"
    )
      problems.push(`${label}: remotePath must be a string or null`);
  }
  const onDisk = new Set(canvases);
  for (const rel of Object.keys(entries))
    if (!onDisk.has(rel))
      problems.push(
        `design-source/${rel}: manifest entry without a vendored file`,
      );
  return { ok: problems.length === 0, problems };
}

/**
 * Copy each pulled canvas into design-source/ byte-exact and upsert its entry.
 * Returns the `NEW|SAME|CHANGED <file> <bytes>` lines.
 */
export function vendorCanvases(
  root,
  pulledFiles,
  { remote = null, note, now = new Date() } = {},
) {
  if (remote !== null && pulledFiles.length !== 1)
    throw new Error("--remote names ONE pulled file's DesignSync path");
  const base = join(root, "design-source");
  const manifest = readManifest(root) ?? {
    version: 1,
    designSyncProject: DESIGN_SYNC_PROJECT,
    files: {},
  };
  const lines = [];
  for (const pulled of pulledFiles) {
    const source = resolve(pulled);
    if (!CANVAS_RE.test(source))
      throw new Error(`${pulled}: not a .dc.html canvas`);
    const insideBase = relative(base, source);
    const rel =
      insideBase && !insideBase.startsWith("..") && !isAbsolute(insideBase)
        ? toPosix(insideBase)
        : basename(source);
    const target = join(base, rel);
    const bytes = readFileSync(source);
    const sha = sha256Hex(bytes);
    const previous = existsSync(target)
      ? sha256Hex(readFileSync(target))
      : null;
    if (resolve(target) !== source) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
    const entry = {
      sha256: sha,
      pulledAt: now.toISOString(),
      remotePath: remote,
    };
    if (note) entry.note = note;
    manifest.files[rel] = entry;
    const status =
      previous === null ? "NEW" : previous === sha ? "SAME" : "CHANGED";
    lines.push(`${status} design-source/${rel} ${bytes.length}`);
  }
  writeManifest(root, manifest);
  return lines;
}

function parseArgs(argv) {
  const files = [];
  const opts = { check: false, remote: null, note: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") opts.check = true;
    else if (arg === "--remote") opts.remote = argv[++i] ?? null;
    else if (arg === "--note") opts.note = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`unknown flag ${arg}`);
    else files.push(arg);
  }
  return { files, opts };
}

function main() {
  const { files, opts } = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  if (opts.check) {
    const verdict = checkProvenance(root);
    for (const problem of verdict.problems)
      process.stderr.write(`[design:vendor] ${problem}\n`);
    if (!verdict.ok) process.exit(1);
    process.stdout.write(
      `[design:vendor] ${listCanvases(root).length} vendored canvases match ${MANIFEST_REL}\n`,
    );
    return;
  }
  if (!files.length) {
    process.stderr.write(
      "usage: pnpm design:vendor <pulled-file>… [--remote <path>] [--note <text>] | --check\n",
    );
    process.exit(2);
  }
  for (const line of vendorCanvases(root, files, opts))
    process.stdout.write(`${line}\n`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[design:vendor] ${error.message}\n`);
    process.exit(2);
  }
}
