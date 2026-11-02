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
 * The `-en` and `-ru` halves SHALL carry identical values. A folder with no
 * requirements file, and a `surface: backend-only` spec, are not targets.
 * Targeting fails closed: every requirements file SHALL declare
 * `surface: backend-only | user-facing` (skill author-ears-spec) — a missing
 * or misspelt `surface:` is a finding, never a silent skip. A reason is one
 * YAML line; a block scalar (`|` / `>`) is refused rather than half-read.
 *
 * Pure tree scan — no PR context; exits 0 cleanly anywhere the tree is clean.
 * Seam: `LINT_FIXTURE_ROOT` (spec tree). Run: `pnpm lint:storefronts`.
 * Findings: stderr + exit 1. Clean: stdout + exit 0.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[storefronts]";
const FEATURES_REL = "apps/docs/content/specs/features";

const VALUES = ["both", "academy-only", "doctor-only", "none"] as const;
const FORMS = VALUES.join(" | ");
const SURFACES = ["backend-only", "user-facing"] as const;
const BLOCK_SCALAR_RE = /^[|>][+-]?\d*$/;
const PLACEHOLDER_RE = /^(?:n\/?a|tbd|todo|none|-+|\?+|<[^>]*>)$/i;

interface Declared {
  surface: string | null;
  storefronts: string | null;
  reason: string | null;
}

function unquote(v: string): string {
  return v
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, "$2")
    .trim();
}

function readDeclared(absPath: string): Declared {
  const text = readFileSync(absPath, "utf8").replace(/\r\n/g, "\n");
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const scope = fm ? fm[1] : "";
  const field = (name: string): string | null => {
    const m = scope.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "m"));
    return m ? unquote(m[1]) : null;
  };
  return {
    surface: field("surface"),
    storefronts: field("storefronts"),
    reason: field("storefronts_reason"),
  };
}

/** The requirements files of one spec folder (plain, or the -en/-ru pair). */
function requirementsFiles(folder: string, entries: string[]): string[] {
  const num = folder.slice(0, 3);
  const re = new RegExp(`^${num}-requirements(?:-(?:en|ru))?\\.md$`);
  return entries.filter((e) => re.test(e)).sort();
}

function checkOne(rel: string, d: Declared): string[] {
  const out: string[] = [];
  if (d.storefronts === null || d.storefronts === "") {
    out.push(
      `${rel}: \`surface: user-facing\` but no \`storefronts:\` — declare \`storefronts: ${FORMS}\` (any value but \`both\` with a \`storefronts_reason:\`).`,
    );
    return out;
  }
  if (!(VALUES as readonly string[]).includes(d.storefronts)) {
    out.push(
      `${rel}: \`storefronts: ${d.storefronts}\` is not one of \`${FORMS}\`.`,
    );
    return out;
  }
  if (d.storefronts === "both") {
    if (d.reason !== null && d.reason !== "") {
      out.push(
        `${rel}: \`storefronts: both\` with a \`storefronts_reason:\` is a contradiction — a reason records why ONE storefront (or none) is in scope; drop it or narrow the value.`,
      );
    }
    return out;
  }
  if (d.reason === null || d.reason === "") {
    out.push(
      `${rel}: \`storefronts: ${d.storefronts}\` needs \`storefronts_reason:\` — say what the other storefront does instead (which spec covers it, or which open Issue re-scopes it).`,
    );
  } else if (BLOCK_SCALAR_RE.test(d.reason)) {
    out.push(
      `${rel}: \`storefronts_reason: ${d.reason}\` is a YAML block scalar — write the reason as one quoted line.`,
    );
  } else if (PLACEHOLDER_RE.test(d.reason)) {
    out.push(
      `${rel}: \`storefronts_reason: ${d.reason}\` is a placeholder — write the real reason.`,
    );
  }
  return out;
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
    process.stdout.write(`${TAG} no ${FEATURES_REL} tree — nothing to check\n`);
    process.exit(0);
  }

  const failures: string[] = [];
  let targets = 0;
  for (const folder of folders) {
    const files = requirementsFiles(
      folder,
      readdirSync(join(featuresDir, folder)),
    );
    if (files.length === 0) continue;
    const declared = files.map((f) => ({
      rel: `${FEATURES_REL}/${folder}/${f}`,
      d: readDeclared(join(featuresDir, folder, f)),
    }));
    let surfaceBad = false;
    for (const { rel, d } of declared) {
      if (d.surface === null || d.surface === "") {
        surfaceBad = true;
        failures.push(
          `${rel}: no \`surface:\` — every requirements file declares \`surface: ${SURFACES.join(" | ")}\` (skill author-ears-spec).`,
        );
      } else if (!(SURFACES as readonly string[]).includes(d.surface)) {
        surfaceBad = true;
        failures.push(
          `${rel}: \`surface: ${d.surface}\` is not one of \`${SURFACES.join(" | ")}\`.`,
        );
      }
    }
    if (surfaceBad) continue;
    if (!declared.some(({ d }) => d.surface === "user-facing")) continue;
    targets += 1;
    for (const { rel, d } of declared) failures.push(...checkOne(rel, d));
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
  }

  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`${TAG} ${f}\n`);
    process.stderr.write(
      `${TAG} FAIL — ${failures.length} finding(s). Every user-facing spec names both storefronts or records why one (#3604; skill author-ears-spec).\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `${TAG} OK — ${targets} user-facing spec(s) declare their storefronts\n`,
  );
}

main();
