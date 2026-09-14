#!/usr/bin/env tsx
/**
 * The generation-time gate of the host-selection contract (§6.1, Issue #2067).
 *
 * Runs in FRONT of `bddgen` (see this package's `bddgen` script), so a feature
 * file that carries no Feature-level `@host:*` tag fails generation and NAMES
 * itself, instead of quietly being selected by no project and disappearing from
 * both storefront suites.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HOST_TAG_VALUES,
  hostTagCounts,
  hostTagViolation,
} from "../lib/host-tags.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
/** The same tree `playwright.config.ts` points `features` at. */
const FEATURES_ROOT = resolve(REPO_ROOT, "apps/docs/content/specs/features");

/** Every `<NNN-slug>/<NNN>-scenarios.feature` under the spec tree. */
function featureFiles(): string[] {
  return readdirSync(FEATURES_ROOT)
    .map((entry) => join(FEATURES_ROOT, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => name.endsWith("-scenarios.feature"))
        .map((name) => join(dir, name)),
    )
    .sort();
}

const files = featureFiles();
const violations = files
  .map((file) => ({
    file: relative(REPO_ROOT, file).split(sep).join("/"),
    reason: hostTagViolation(readFileSync(file, "utf8")),
  }))
  .filter((row): row is { file: string; reason: string } => row.reason !== null);

if (violations.length > 0) {
  for (const { file, reason } of violations) {
    process.stderr.write(`[host-tags] ${file}: ${reason}\n`);
  }
  process.stderr.write(
    `[host-tags] ${violations.length} of ${files.length} feature file(s) carry no valid Feature-level host tag. ` +
      `The storefront projects select positively, so an untagged feature runs on NEITHER storefront.\n`,
  );
  process.exit(1);
}

// Per-host SUITE SIZE in the CI log: retargeting a Feature tag removes a spec
// from both storefront suites with every structural check still green, so the
// counts are what makes a shrinking suite visible at zero cost.
const counts = hostTagCounts(files.map((file) => readFileSync(file, "utf8")));
process.stdout.write(
  `[host-tags] PASS — ${files.length} feature file(s) each declare exactly one Feature-level host tag: ` +
    `${HOST_TAG_VALUES.map((value) => `${value} ${counts[value]}`).join(" / ")}.\n`,
);
