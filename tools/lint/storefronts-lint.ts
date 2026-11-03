#!/usr/bin/env tsx
/**
 * tools/lint/storefronts-lint.ts — BLOCK tree guard (#3604).
 *
 * ── Why ───────────────────────────────────────────────────────────────────────
 * DS Platform serves two storefronts from one schema and one database — the
 * Academy (`apps/portal`, academy.doctor.school) and the doctor storefront
 * (`apps/doctor`). The owner's rule: «одна схема данных и одна БД… Любая
 * сущность должна браться из существующих». Work kept diverging because specs
 * were authored for ONE host and nothing forced the question «what does the
 * other storefront do?». `Reuse:` answers «which code», not «which
 * storefronts»; `track:*` is board taxonomy. This field is the scope answer.
 *
 * ── The rule (exact) ──────────────────────────────────────────────────────────
 * For every folder `apps/docs/content/specs/features/NNN-<slug>/`, the
 * requirements file — `NNN-requirements.md`, or BOTH halves of the bilingual
 * `NNN-requirements-en.md` / `-ru.md` — whose frontmatter says
 * `surface: user-facing` SHALL declare:
 *   - `storefronts: both | academy-only | doctor-only | none`
 *     (`none` = only admin / staff / sign-in-host surfaces, no storefront page);
 *   - for any value but `both`, a `storefronts_reason:` that is non-empty and
 *     not a placeholder (`n/a`, `tbd`, `none`, `-`, `<…>`);
 *   - for `both`, NO `storefronts_reason:` (a reason there is a contradiction).
 * The `-en` and `-ru` halves SHALL carry identical values. The product PRD —
 * `NNN-product.md` / `NNN-product-ru.md` (ADR-0014) — is gated the same way
 * (#3610): its halves are identical, and where a folder carries both a PRD
 * and requirements, their `storefronts:` values SHALL agree (the reasons may
 * be worded differently). A `surface: backend-only` file group is not a
 * target. Targeting fails closed: every requirements and product file SHALL
 * declare `surface: backend-only | user-facing` (skill author-ears-spec) — a
 * missing or misspelt `surface:` is a finding, never a silent skip. A reason
 * is one YAML line; a block scalar (`|` / `>`) is refused rather than
 * half-read. Vocabulary and messages: `tools/gh/lib/storefronts.mjs`, shared
 * with the Issue gate and the backlog report.
 *
 * Pure tree scan — no PR context; exits 0 cleanly anywhere the tree is clean.
 * Seam: `LINT_FIXTURE_ROOT` (spec tree). Run: `pnpm lint:storefronts`.
 * Findings: stderr + exit 1. Clean: stdout + exit 0.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FEATURES_REL,
  SURFACE_VALUES,
  declaredFindings,
  readSpecFields,
} from "../gh/lib/storefronts.mjs";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[storefronts]";
const SURFACES = SURFACE_VALUES.join(" | ");

interface Declared {
  surface: string | null;
  storefronts: string | null;
  reason: string | null;
}

/** One file group of a spec folder: the requirements or the product PRD. */
const GROUPS = [
  {
    kind: "requirements",
    re: (num: string) =>
      new RegExp(`^${num}-requirements(?:-(?:en|ru))?\\.md$`),
  },
  {
    kind: "product",
    re: (num: string) => new RegExp(`^${num}-product(?:-(?:en|ru))?\\.md$`),
  },
] as const;

interface GroupResult {
  kind: string;
  /** The agreed `storefronts:` value of a clean user-facing group, else null. */
  value: string | null;
}

function checkGroup(
  folder: string,
  kind: string,
  files: string[],
  featuresDir: string,
  failures: string[],
): GroupResult | null {
  const declared = files.map((f) => ({
    rel: `${FEATURES_REL}/${folder}/${f}`,
    d: readSpecFields(
      readFileSync(join(featuresDir, folder, f), "utf8"),
    ) as Declared,
  }));
  let surfaceBad = false;
  for (const { rel, d } of declared) {
    if (d.surface === null || d.surface === "") {
      surfaceBad = true;
      failures.push(
        `${rel}: no \`surface:\` — every ${kind} file declares \`surface: ${SURFACES}\` (skill author-ears-spec).`,
      );
    } else if (!SURFACE_VALUES.includes(d.surface)) {
      surfaceBad = true;
      failures.push(
        `${rel}: \`surface: ${d.surface}\` is not one of \`${SURFACES}\`.`,
      );
    }
  }
  if (surfaceBad) return null;
  if (!declared.some(({ d }) => d.surface === "user-facing")) return null;
  const before = failures.length;
  for (const { rel, d } of declared) failures.push(...declaredFindings(rel, d));
  if (declared.length > 1) {
    const sig = (d: Declared) =>
      `${d.storefronts ?? ""}\u0000${d.reason ?? ""}`;
    const first = sig(declared[0].d);
    if (declared.some(({ d }) => sig(d) !== first)) {
      failures.push(
        `${FEATURES_REL}/${folder}: the ${files.join(" / ")} halves disagree on \`storefronts:\` / \`storefronts_reason:\` — both languages carry identical values.`,
      );
    }
  }
  return {
    kind,
    value: failures.length === before ? declared[0].d.storefronts : null,
  };
}

function main(): void {
  const featuresDir = join(REPO_ROOT, FEATURES_REL);
  let folders: string[];
  try {
    folders = readdirSync(featuresDir)
      .filter((f) => /^\d{3}-/.test(f))
      .filter((f) => statSync(join(featuresDir, f)).isDirectory())
      .sort();
  } catch {
    process.stdout.write(`${TAG} no ${FEATURES_REL} tree — nothing to check
`);
    process.exit(0);
  }

  const failures: string[] = [];
  let targets = 0;
  for (const folder of folders) {
    const num = folder.slice(0, 3);
    const entries = readdirSync(join(featuresDir, folder));
    const results: GroupResult[] = [];
    for (const g of GROUPS) {
      const re = g.re(num);
      const files = entries.filter((e) => re.test(e)).sort();
      if (files.length === 0) continue;
      const r = checkGroup(folder, g.kind, files, featuresDir, failures);
      if (r) {
        targets += 1;
        results.push(r);
      }
    }
    const req = results.find((r) => r.kind === "requirements");
    const prd = results.find((r) => r.kind === "product");
    if (req?.value && prd?.value && req.value !== prd.value) {
      failures.push(
        `${FEATURES_REL}/${folder}: the product PRD says \`storefronts: ${prd.value}\` but the requirements say \`storefronts: ${req.value}\` — the two tiers of one feature declare the same storefronts.`,
      );
    }
  }

  if (failures.length > 0) {
    for (const f of failures)
      process.stderr.write(`${TAG} ${f}
`);
    process.stderr.write(
      `${TAG} FAIL — ${failures.length} finding(s). Every user-facing spec names both storefronts or records why one (#3604; skill author-ears-spec).
`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `${TAG} OK — ${targets} user-facing spec file group(s) declare their storefronts
`,
  );
}

main();
