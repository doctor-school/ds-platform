// tools/deploy/lib/schema-drift.mjs — the drift of a prod `schema` answer against the
// checked-out tree (Issue #3646; spec
// apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md §5
// «Prod read verbs.» → «Local commands.»). Pure: the caller reads the files.
//
//   (a) migrations — each `apps/api/drizzle/meta/_journal.json` entry, its `when`
//       against the applied `created_at` and its file's sha256 against the applied
//       `hash` (the migrator hashes the whole file text, drizzle-orm/migrator.js):
//       pending, applied but not in the journal, or hash mismatch.
//   (b) catalogue — against the newest `apps/api/drizzle/meta/*_snapshot.json`:
//       missing, extra or changed tables, columns (type, not-null, default), indexes
//       and constraints by name, enums by values, after the fixed normalisation of
//       type and default spelling below.

import { createHash } from "node:crypto";

/** The migrator's own bookkeeping schema (`drizzle.__drizzle_migrations`): never drift. */
export const MIGRATOR_SCHEMA = "drizzle";

const SNAPSHOT_RE = /^(\d+)_snapshot\.json$/;

/** The newest `NNNN_snapshot.json` of a `drizzle/meta` listing, or null. */
export function newestSnapshot(names) {
  let best = null;
  for (const name of names) {
    const m = SNAPSHOT_RE.exec(name);
    if (m && (best === null || Number(m[1]) > best.n))
      best = { n: Number(m[1]), name };
  }
  return best?.name ?? null;
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * (a) Migrations. `readSql(tag)` returns the file text of `<tag>.sql`, or null when
 * the file is missing (then this throws: an unreadable tree is exit 2, not drift).
 * @returns {string[]} one line per drift
 */
export function migrationDrift(journal, readSql, applied) {
  if (!journal || !Array.isArray(journal.entries))
    throw new Error("the journal has no entries");
  if (!Array.isArray(applied))
    throw new Error("the answer has no migrations list");
  const byWhen = new Map(applied.map((row) => [String(row.created_at), row]));
  const lines = [];
  const known = new Set();
  for (const entry of journal.entries) {
    const when = String(entry.when);
    known.add(when);
    const text = readSql(entry.tag);
    if (text === null)
      throw new Error(
        `the migration file of journal entry ${entry.tag} is missing`,
      );
    const row = byWhen.get(when);
    if (!row) lines.push(`migration pending: ${entry.tag} (when ${when})`);
    else if (row.hash !== sha256(text))
      lines.push(`migration hash mismatch: ${entry.tag} (when ${when})`);
  }
  for (const row of applied) {
    if (!known.has(String(row.created_at))) {
      lines.push(
        `migration applied, not in the journal: id ${row.id} (created_at ${row.created_at})`,
      );
    }
  }
  return lines;
}

const ALIASES = new Map([
  ["int", "integer"],
  ["int4", "integer"],
  ["serial", "integer"],
  ["serial4", "integer"],
  ["int2", "smallint"],
  ["smallserial", "smallint"],
  ["serial2", "smallint"],
  ["int8", "bigint"],
  ["bigserial", "bigint"],
  ["serial8", "bigint"],
  ["bool", "boolean"],
  ["float8", "double precision"],
  ["float4", "real"],
  ["decimal", "numeric"],
]);
const SERIAL = new Set([
  "serial",
  "serial4",
  "smallserial",
  "serial2",
  "bigserial",
  "serial8",
]);

/** The fixed spelling of a column type: drizzle-kit's and `format_type`'s alike. */
export function normaliseType(type) {
  let t = String(type)
    .toLowerCase()
    .replaceAll('"', "")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/\s+\(/g, "(").replace(/^public\./, "");
  const array = /((?:\[\])*)$/.exec(t)[1];
  t = t.slice(0, t.length - array.length);
  let m;
  if ((m = /^timestamptz(\(\d+\))?$/.exec(t)))
    t = `timestamp${m[1] ?? ""} with time zone`;
  else if ((m = /^timestamp(\(\d+\))?$/.exec(t)))
    t = `timestamp${m[1] ?? ""} without time zone`;
  else if ((m = /^timetz(\(\d+\))?$/.exec(t)))
    t = `time${m[1] ?? ""} with time zone`;
  else if ((m = /^time(\(\d+\))?$/.exec(t)))
    t = `time${m[1] ?? ""} without time zone`;
  else if ((m = /^varchar(\(\d+\))?$/.exec(t)))
    t = `character varying${m[1] ?? ""}`;
  else if ((m = /^char(\(\d+\))?$/.exec(t))) t = `character${m[1] ?? ""}`;
  else if (ALIASES.has(t)) t = ALIASES.get(t);
  return t + array;
}

const CAST_RE =
  /::"?(?:character varying|timestamp with(?:out)? time zone|time with(?:out)? time zone|double precision|[a-z_][a-z0-9_.]*)"?(?:\(\d+(?:,\s*\d+)?\))?(?:\[\])*/gi;

/** The fixed spelling of a column default: casts and wrapping parentheses dropped. */
export function normaliseDefault(value) {
  if (value === undefined || value === null) return null;
  let d = String(value).trim().replace(CAST_RE, "");
  while (/^\(.*\)$/.test(d) && balanced(d.slice(1, -1)))
    d = d.slice(1, -1).trim();
  return d;
}

function balanced(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth += 1;
    else if (ch === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

/** The snapshot's expected columns, indexes and constraints of one table. */
function snapshotTable(table) {
  const name = table.name;
  const columns = new Map();
  for (const col of Object.values(table.columns ?? {})) {
    const typeName =
      col.typeSchema && col.typeSchema !== "public"
        ? `${col.typeSchema}.${col.type}`
        : col.type;
    let def = normaliseDefault(col.default);
    if (SERIAL.has(String(col.type).toLowerCase())) def = "nextval";
    if (col.identity || col.generated) def = null;
    columns.set(col.name, {
      type: normaliseType(typeName),
      notNull: Boolean(col.notNull),
      default: def,
      skipDefault: Boolean(col.identity || col.generated),
    });
  }
  const constraints = new Map();
  const composite = Object.values(table.compositePrimaryKeys ?? {});
  for (const pk of composite) constraints.set(pk.name, "primary key");
  if (
    composite.length === 0 &&
    Object.values(table.columns ?? {}).some((c) => c.primaryKey)
  ) {
    constraints.set(`${name}_pkey`, "primary key");
  }
  for (const fk of Object.values(table.foreignKeys ?? {}))
    constraints.set(fk.name, "foreign key");
  for (const u of Object.values(table.uniqueConstraints ?? {}))
    constraints.set(u.name, "unique");
  for (const col of Object.values(table.columns ?? {}))
    if (col.isUnique && col.uniqueName)
      constraints.set(col.uniqueName, "unique");
  for (const c of Object.values(table.checkConstraints ?? {}))
    constraints.set(c.name, "check");
  const indexes = new Map();
  for (const i of Object.values(table.indexes ?? {}))
    indexes.set(i.name, { unique: Boolean(i.isUnique) });
  return { columns, constraints, indexes };
}

/** One prod catalogue table, in the same shape; constraint-backing indexes left out. */
function prodTable(table) {
  const columns = new Map();
  for (const col of table.columns ?? []) {
    columns.set(col.name, {
      type: normaliseType(col.type),
      notNull: Boolean(col.notNull),
      default:
        col.default == null
          ? null
          : /^nextval\(/.test(String(col.default))
            ? "nextval"
            : normaliseDefault(col.default),
    });
  }
  const constraints = new Map();
  for (const k of table.constraints ?? [])
    if (k.kind !== "not null") constraints.set(k.name, k.kind);
  const indexes = new Map();
  for (const i of table.indexes ?? []) {
    if (constraints.has(i.name)) continue;
    indexes.set(i.name, {
      unique: /^CREATE UNIQUE INDEX /i.test(String(i.definition)),
    });
  }
  return { columns, constraints, indexes };
}

function show(v) {
  return v === null ? "none" : JSON.stringify(v);
}

/**
 * (b) Catalogue. `snapshot` is a drizzle-kit `*_snapshot.json`, `catalogue` the
 * answer's `catalogue`.
 * @returns {string[]} one line per drift
 */
export function catalogueDrift(snapshot, catalogue) {
  if (!snapshot || typeof snapshot.tables !== "object")
    throw new Error("the snapshot has no tables");
  if (!catalogue || !Array.isArray(catalogue.tables))
    throw new Error("the answer has no catalogue tables");
  const lines = [];
  const want = new Map(
    Object.values(snapshot.tables).map((t) => [
      `${t.schema || "public"}.${t.name}`,
      snapshotTable(t),
    ]),
  );
  const have = new Map(
    catalogue.tables
      .filter((t) => t.schema !== MIGRATOR_SCHEMA)
      .map((t) => [`${t.schema}.${t.name}`, prodTable(t)]),
  );
  for (const key of [...want.keys()].sort())
    if (!have.has(key)) lines.push(`table missing: ${key}`);
  for (const key of [...have.keys()].sort())
    if (!want.has(key)) lines.push(`table extra: ${key}`);
  for (const key of [...want.keys()].sort()) {
    const w = want.get(key);
    const h = have.get(key);
    if (!h) continue;
    for (const [col, wc] of w.columns) {
      const hc = h.columns.get(col);
      if (!hc) {
        lines.push(`column missing: ${key}.${col}`);
        continue;
      }
      if (wc.type !== hc.type)
        lines.push(
          `column type changed: ${key}.${col} (tree ${wc.type}, prod ${hc.type})`,
        );
      if (wc.notNull !== hc.notNull)
        lines.push(
          `column not-null changed: ${key}.${col} (tree ${wc.notNull}, prod ${hc.notNull})`,
        );
      if (!wc.skipDefault && wc.default !== hc.default) {
        lines.push(
          `column default changed: ${key}.${col} (tree ${show(wc.default)}, prod ${show(hc.default)})`,
        );
      }
    }
    for (const col of h.columns.keys())
      if (!w.columns.has(col)) lines.push(`column extra: ${key}.${col}`);
    for (const [name, kind] of w.constraints) {
      const hk = h.constraints.get(name);
      if (hk === undefined)
        lines.push(`constraint missing: ${key} ${name} (${kind})`);
      else if (hk !== kind)
        lines.push(
          `constraint changed: ${key} ${name} (tree ${kind}, prod ${hk})`,
        );
    }
    for (const [name, kind] of h.constraints)
      if (!w.constraints.has(name))
        lines.push(`constraint extra: ${key} ${name} (${kind})`);
    for (const [name, wi] of w.indexes) {
      const hi = h.indexes.get(name);
      if (!hi) lines.push(`index missing: ${key} ${name}`);
      else if (hi.unique !== wi.unique)
        lines.push(
          `index changed: ${key} ${name} (tree unique ${wi.unique}, prod unique ${hi.unique})`,
        );
    }
    for (const name of h.indexes.keys())
      if (!w.indexes.has(name)) lines.push(`index extra: ${key} ${name}`);
  }
  const wantEnums = new Map(
    Object.values(snapshot.enums ?? {}).map((e) => [
      `${e.schema || "public"}.${e.name}`,
      e.values,
    ]),
  );
  const haveEnums = new Map(
    (catalogue.enums ?? []).map((e) => [`${e.schema}.${e.name}`, e.values]),
  );
  for (const [key, values] of [...wantEnums].sort()) {
    if (!haveEnums.has(key)) lines.push(`enum missing: ${key}`);
    else if (JSON.stringify(haveEnums.get(key)) !== JSON.stringify(values)) {
      lines.push(
        `enum values changed: ${key} (tree ${values.join(",")}, prod ${haveEnums.get(key).join(",")})`,
      );
    }
  }
  for (const key of [...haveEnums.keys()].sort())
    if (!wantEnums.has(key)) lines.push(`enum extra: ${key}`);
  return lines;
}
