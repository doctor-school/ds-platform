/**
 * host-config-parity — the two storefronts may differ only where a spec says so
 * (#2443, BLOCK).
 *
 * Why. `@ds/auth-flow` and `@ds/storefront-shell` are ONE capability each,
 * mounted by the doctor storefront (Витрина, `apps/doctor`) and the Academy
 * (`apps/portal`) through a per-host config. A per-host value is where a
 * storefront difference can be introduced silently: #2324 set the doctor host
 * to e-mail-only sign-in, no spec or owner decision backed it, and later canvas
 * and code work (#2429, #2430) treated it as a product fact. The owner ruled
 * (2026-09-29) that auth-flow MECHANICS are not a storefront difference and that
 * the agreed differences are recorded in the spec, not in exceptions.
 *
 * What it checks, per config pair (auth flow, shell):
 *   1. It imports the REAL host constants of both apps (a tsx child per app,
 *      under that app's own `tsconfig.json`, see `lib/host-config-load.ts`) —
 *      no regex over source.
 *   2. Every leaf key a host config sets is classified by the field table below
 *      (longest dotted-path prefix wins) as presentation, brand, route,
 *      envelope or product-difference. Product-difference is EXACTLY the
 *      package manifest (`AUTH_FLOW_PRODUCT_DIFFERENCE_FIELDS`,
 *      `SHELL_PRODUCT_DIFFERENCE_FIELDS`), read from the package, never
 *      restated here. An unlisted key fails closed; a mechanics key (package-
 *      owned since #2443 — `channels`, `routes.allowAuthenticated`, `returnTo`,
 *      `verify`) fails as such.
 *   3. A product-difference field whose values DIFFER between the hosts needs a
 *      row, keyed by the backticked field in its first cell, in the
 *      «## Differences between storefronts» table of the manifest's `spec` —
 *      read from the BASE branch (`git cat-file blob origin/<base>:<spec>`,
 *      base = `GITHUB_BASE_REF` or `main`), so a PR can never approve its own
 *      new difference: a PR adding a row and a value together is RED until the
 *      row lands on its own. The row must ALSO still be present on the HEAD
 *      (working) tree: a spec-only PR that drops a row while the values still
 *      differ is RED in that PR, not on main after it merges.
 *   4. Value rule, for a DIFFERING field only: when its base row's Витрина /
 *      Академия cell LEADS with a backticked literal (`true`, `false`, `null`,
 *      a number or a bare token), that host's value must equal it. A cell with
 *      no leading literal (a composite value such as the consent row set, or
 *      «on — …») needs the row's presence only — so a composite cell opens
 *      with prose, never with a backticked path.
 *   5. A product-difference field with EQUAL values on both hosts needs no row
 *      and ignores any row present, so adding or removing a difference never
 *      deadlocks: add = spec row first, then the value; remove = hosts equal
 *      first, then drop the row.
 *   6. Presentation, brand, route and envelope values may differ freely.
 *
 * There is no exception file: a difference is either cited by its spec row or
 * it is a defect.
 *
 * Seams (fixtures, `guard-tests/host-config-parity-lint.spec.ts`):
 *   LINT_FIXTURE_ROOT            — the tree whose host configs and manifests are
 *                                  read, at their real repo-relative paths.
 *   HOST_CONFIG_PARITY_BASE_DIR  — a dir mirroring repo paths that replaces the
 *                                  `git cat-file blob origin/<base>:<spec>` read.
 *
 * Prerequisite: the host configs import `@ds/schemas` values, which resolve to
 * its built `dist/` (package exports) — CI builds it in the step before this
 * guard; locally `pnpm --filter @ds/schemas build`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TAG = "[host-config-parity]";
const LINT_DIR = dirname(fileURLToPath(import.meta.url));
const REAL_REPO_ROOT = resolve(LINT_DIR, "..", "..");
const ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : REAL_REPO_ROOT;
const DIFFERENCES_HEADING = "## Differences between storefronts";

type FieldKind =
  | "presentation"
  | "brand"
  | "route"
  | "envelope"
  | "product-difference"
  | "mechanics";

interface HostSource {
  /** Storefront label as the spec tables head their columns. */
  label: "Витрина" | "Академия";
  app: "apps/doctor" | "apps/portal";
  module: string;
  export: string;
  catalog?: { file: string; namespace: string };
}

interface ProductDifference {
  field: string;
  spec: string;
  clauses: readonly string[];
}

interface ConfigPair {
  config: string;
  doctor: HostSource;
  academy: HostSource;
  manifest: { module: string; export: string };
  /** Every non-product-difference field, by dotted path (longest prefix wins). */
  fields: Record<string, Exclude<FieldKind, "product-difference">>;
}

const PAIRS: ConfigPair[] = [
  {
    config: "AuthFlowHostConfig",
    doctor: {
      label: "Витрина",
      app: "apps/doctor",
      module: "apps/doctor/lib/auth-flow.host-config.ts",
      export: "DOCTOR_AUTH_FLOW",
    },
    academy: {
      label: "Академия",
      app: "apps/portal",
      module: "apps/portal/lib/auth-flow.host-config.ts",
      export: "ACADEMY_AUTH_FLOW",
    },
    manifest: {
      module: "packages/auth-flow/src/host-config.ts",
      export: "AUTH_FLOW_PRODUCT_DIFFERENCE_FIELDS",
    },
    fields: {
      api: "envelope",
      routes: "route",
      "landing.afterLogin": "route",
      "landing.specialtyFeed": "route",
      "landing.specialtyEndpoints": "envelope",
      copy: "presentation",
      brand: "brand",
      "botProtection.siteKey": "envelope",
      "register.attribution": "presentation",
      "register.pointsPromise": "presentation",
      // Package-owned mechanics (#2443): no host may state them again.
      channels: "mechanics",
      "routes.allowAuthenticated": "mechanics",
      returnTo: "mechanics",
      verify: "mechanics",
    },
  },
  {
    config: "StorefrontShellConfig",
    doctor: {
      label: "Витрина",
      app: "apps/doctor",
      module: "apps/doctor/lib/shell-config.ts",
      export: "DOCTOR_SHELL",
    },
    academy: {
      label: "Академия",
      app: "apps/portal",
      module: "apps/portal/lib/shell-config.ts",
      export: "academyShellConfig",
      catalog: { file: "apps/portal/messages/ru.json", namespace: "shell" },
    },
    manifest: {
      module: "packages/storefront-shell/src/config.ts",
      export: "SHELL_PRODUCT_DIFFERENCE_FIELDS",
    },
    fields: {
      host: "brand",
      logo: "brand",
      "logo.href": "route",
      topbar: "presentation",
      nav: "route",
      footer: "presentation",
      "footer.documents": "route",
      "footer.cross.href": "route",
      "footer.hiddenOnPaths": "route",
      hiddenOnPaths: "route",
    },
  },
];

const errors: string[] = [];

function show(value: unknown): string {
  return value === undefined ? "(not set)" : JSON.stringify(value);
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.$undefined === true && Object.keys(obj).length === 1)
      return undefined;
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, decode(v)]),
    );
  }
  return value;
}

/** Import one app's host modules in a tsx child under that app's tsconfig. */
function loadHosts(sources: HostSource[]): unknown[] {
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  const app = sources[0]!.app;
  const tsconfig = resolve(ROOT, app, "tsconfig.json");
  const requests = sources.map((s) => ({
    module: resolve(ROOT, s.module),
    export: s.export,
    catalog: s.catalog
      ? { file: resolve(ROOT, s.catalog.file), namespace: s.catalog.namespace }
      : undefined,
  }));
  const result = spawnSync(
    process.execPath,
    [
      tsxCli,
      resolve(LINT_DIR, "lib", "host-config-load.ts"),
      JSON.stringify(requests),
    ],
    {
      cwd: REAL_REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        ...(existsSync(tsconfig) ? { TSX_TSCONFIG_PATH: tsconfig } : {}),
      },
    },
  );
  if (result.status !== 0) {
    process.stderr.write(
      `${TAG} could not import the ${app} host configs (${sources
        .map((s) => `${s.module}:${s.export}`)
        .join(", ")}).\n` +
        `  If the error names a missing \`dist/\`, build the workspace packages the host configs import first ` +
        `(\`pnpm --filter @ds/schemas build\`).\n${result.stderr}`,
    );
    process.exit(1);
  }
  return (JSON.parse(result.stdout) as unknown[]).map(decode);
}

async function loadManifest(pair: ConfigPair): Promise<ProductDifference[]> {
  const path = resolve(ROOT, pair.manifest.module);
  const mod = (await import(pathToFileURL(path).href)) as Record<
    string,
    unknown
  >;
  const manifest = mod[pair.manifest.export];
  if (!Array.isArray(manifest)) {
    process.stderr.write(
      `${TAG} ${pair.manifest.module} does not export a ${pair.manifest.export} array.\n`,
    );
    process.exit(1);
  }
  return manifest as ProductDifference[];
}

/** Every leaf (scalar, array, or `undefined`) of a host config, by dotted path. */
function leaves(value: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      for (const [p, leaf] of leaves(v, prefix ? `${prefix}.${k}` : k))
        out.set(p, leaf);
    }
    if (prefix && Object.keys(value).length === 0) out.set(prefix, value);
    return out;
  }
  out.set(prefix, value);
  return out;
}

function classify(
  path: string,
  table: Record<string, FieldKind>,
): string | null {
  let best: string | null = null;
  for (const key of Object.keys(table)) {
    if (
      (path === key || path.startsWith(`${key}.`)) &&
      (!best || key.length > best.length)
    ) {
      best = key;
    }
  }
  return best;
}

function valueAt(config: unknown, path: string): unknown {
  let cur: unknown = config;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function baseRefName(): string {
  return process.env.GITHUB_BASE_REF || "main";
}

const baseCache = new Map<string, string | null>();
let fetched = false;

/**
 * The spec file as it stands on the BASE branch — never the head tree (point 3
 * of the header). One best-effort `git fetch` of the base branch first, as
 * `ui-parity-lint.ts` does, so a local run right after the row landed never
 * judges against a stale `origin/<base>`; offline, the read falls back to the
 * `origin/<base>` the tree already has.
 */
function readBaseSpec(spec: string): string | null {
  if (baseCache.has(spec)) return baseCache.get(spec)!;
  let text: string | null;
  const baseDir = process.env.HOST_CONFIG_PARITY_BASE_DIR;
  if (baseDir) {
    const file = resolve(baseDir, spec);
    text = existsSync(file) ? readFileSync(file, "utf8") : null;
  } else {
    const base = baseRefName();
    if (!fetched) {
      fetched = true;
      spawnSync(
        "git",
        [
          "fetch",
          "--quiet",
          "origin",
          `+refs/heads/${base}:refs/remotes/origin/${base}`,
        ],
        { cwd: ROOT, encoding: "utf8" },
      );
    }
    const result = spawnSync(
      "git",
      ["cat-file", "blob", `origin/${base}:${spec}`],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    text = result.status === 0 ? result.stdout : null;
  }
  baseCache.set(spec, text);
  return text;
}

/** The spec file as it stands on the head (working) tree; `null` when absent. */
function readHeadSpec(spec: string): string | null {
  const file = resolve(ROOT, spec);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

interface DifferenceRow {
  doctor: string;
  academy: string;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** The «Differences between storefronts» rows of a spec, keyed by field. */
function differenceRows(text: string): Map<string, DifferenceRow> | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === DIFFERENCES_HEADING);
  if (start < 0) return null;
  const table: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2} /.test(line)) break;
    if (line.trim().startsWith("|")) table.push(line);
    else if (table.length) break;
  }
  if (table.length < 2) return null;
  const header = cells(table[0]!);
  const doctorCol = header.findIndex((h) => h.startsWith("Витрина"));
  const academyCol = header.findIndex((h) => h.startsWith("Академия"));
  if (doctorCol < 0 || academyCol < 0) return null;
  const rows = new Map<string, DifferenceRow>();
  for (const line of table.slice(2)) {
    const row = cells(line);
    const key = /`([^`]+)`/.exec(row[0] ?? "")?.[1];
    if (!key) continue;
    rows.set(key, {
      doctor: row[doctorCol] ?? "",
      academy: row[academyCol] ?? "",
    });
  }
  return rows;
}

/** The literal a cell LEADS with, or `none` for a presence-only (composite) cell. */
function leadingLiteral(
  cell: string,
): { none: true } | { none: false; value: unknown; text: string } {
  const m = /^`([^`]+)`/.exec(cell);
  if (!m) return { none: true };
  const text = m[1]!;
  try {
    return { none: false, value: JSON.parse(text), text };
  } catch {
    return { none: false, value: text, text };
  }
}

async function checkPair(
  pair: ConfigPair,
  doctor: unknown,
  academy: unknown,
): Promise<void> {
  const manifest = await loadManifest(pair);
  const table: Record<string, FieldKind> = { ...pair.fields };
  for (const entry of manifest) {
    if (entry.field in table) {
      errors.push(
        `${pair.config}: \`${entry.field}\` is in ${pair.manifest.export} AND classified ` +
          `\`${table[entry.field]}\` by the guard's field table — one field has one kind.`,
      );
    }
    table[entry.field] = "product-difference";
  }

  // (2) classify every leaf key either host sets.
  for (const [host, config] of [
    [pair.doctor, doctor],
    [pair.academy, academy],
  ] as const) {
    for (const path of leaves(config).keys()) {
      const key = classify(path, table);
      const where = `${host.module}:${host.export}`;
      if (!key) {
        errors.push(
          `${pair.config} (${host.label}, ${where}): \`${path}\` is unclassified — add it to the ` +
            `field table in tools/lint/host-config-parity-lint.ts as presentation, brand, route or ` +
            `envelope, or, if the storefronts are meant to differ on it, to ${pair.manifest.export} ` +
            `with a spec row. An unlisted key fails closed.`,
        );
      } else if (table[key] === "mechanics") {
        errors.push(
          `${pair.config} (${host.label}, ${where}): \`${path}\` is auth-flow mechanics — a package ` +
            `constant of ${pair.manifest.module} (#2443), the same on both storefronts by construction. ` +
            `Remove it from the host config.`,
        );
      }
    }
  }

  // (3)–(5) product-difference fields against the base- and head-tree spec rows.
  for (const entry of manifest) {
    const d = valueAt(doctor, entry.field);
    const a = valueAt(academy, entry.field);
    // (5) equal values are not a difference: no row needed, any row ignored.
    if (canonical(d) === canonical(a)) continue;
    const text = readBaseSpec(entry.spec);
    const row = text ? differenceRows(text)?.get(entry.field) : undefined;
    const values =
      `    Витрина  (${pair.doctor.module}:${pair.doctor.export}): ${show(d)}\n` +
      `    Академия (${pair.academy.module}:${pair.academy.export}): ${show(a)}`;
    if (!row) {
      errors.push(
        `${pair.config}: \`${entry.field}\` differs between the storefronts and has no row in the ` +
          `base-branch spec table.\n${values}\n` +
          `    expected: a row keyed \`${entry.field}\` in «${DIFFERENCES_HEADING.slice(3)}» of ` +
          `${entry.spec} on origin/${baseRefName()} (clauses: ${entry.clauses.join(", ")}). ` +
          `A row added in this same PR does not count — land the spec row first.`,
      );
      continue;
    }
    const headText = readHeadSpec(entry.spec);
    if (!(headText ? differenceRows(headText)?.has(entry.field) : false)) {
      errors.push(
        `${pair.config}: \`${entry.field}\` still differs between the storefronts, but the head tree ` +
          `drops its row from ${entry.spec} (origin/${baseRefName()} still cites it).\n${values}\n` +
          `    keep the row while the values differ — make the hosts equal first, then remove the row.`,
      );
    }
    for (const [label, cell, value] of [
      ["Витрина", row.doctor, d],
      ["Академия", row.academy, a],
    ] as const) {
      const lit = leadingLiteral(cell);
      if (lit.none) continue;
      if (canonical(lit.value) !== canonical(value)) {
        errors.push(
          `${pair.config}: \`${entry.field}\` on ${label} is ${show(value)}, but its row in ${entry.spec} ` +
            `on origin/${baseRefName()} states \`${lit.text}\` for ${label}.\n${values}\n` +
            `    row states \`${lit.text}\` — fix the host value, or land the spec change first.`,
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const [doctorValues, academyValues] = [
    loadHosts(PAIRS.map((p) => p.doctor)),
    loadHosts(PAIRS.map((p) => p.academy)),
  ];
  for (const [i, pair] of PAIRS.entries()) {
    await checkPair(pair, doctorValues![i], academyValues![i]);
  }
  if (errors.length) {
    process.stderr.write(
      `${TAG} ${errors.length} storefront host-config violation(s):\n\n` +
        errors.map((e) => `  ✗ ${e}`).join("\n\n") +
        "\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    `${TAG} OK — ${PAIRS.length} host-config pairs: every key classified, every storefront ` +
      `difference cited by its base-branch spec row.\n`,
  );
}

await main();
