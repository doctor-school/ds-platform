// Issue #3646: the drift of a prod `schema` answer against the tree (spec §5 «Local commands.»).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  catalogueDrift,
  handWrittenIndexes,
  migrationDrift,
  newestSnapshot,
  normaliseDefault,
  normaliseType,
  pgIdentifier,
  sha256,
} from "./schema-drift.mjs";

test("3646: the newest snapshot is the highest-numbered NNNN_snapshot.json", () => {
  assert.equal(
    newestSnapshot([
      "_journal.json",
      "0009_snapshot.json",
      "0010_snapshot.json",
      "0002_snapshot.json",
    ]),
    "0010_snapshot.json",
  );
  assert.equal(newestSnapshot(["_journal.json"]), null);
});

test("3646: type spelling — drizzle-kit and format_type normalise alike", () => {
  for (const [a, b] of [
    ["varchar(255)", "character varying(255)"],
    ["timestamp with time zone", "timestamp with time zone"],
    ["timestamptz", "timestamp with time zone"],
    ["timestamp (3) with time zone", "timestamp(3) with time zone"],
    ["timestamp", "timestamp without time zone"],
    ["serial", "integer"],
    ["bigserial", "bigint"],
    ["int4", "integer"],
    ["bool", "boolean"],
    ["text[]", "text[]"],
    ["public.citext", "citext"],
    ['"Mixed"', "mixed"],
  ]) {
    assert.equal(normaliseType(a), normaliseType(b), `${a} ~ ${b}`);
  }
  assert.notEqual(normaliseType("varchar(255)"), normaliseType("varchar(64)"));
});

test("3646: default spelling — casts and wrapping parentheses dropped", () => {
  assert.equal(
    normaliseDefault("'processing'::idempotency_execution_state"),
    "'processing'",
  );
  assert.equal(normaliseDefault("'{}'::jsonb"), "'{}'");
  assert.equal(normaliseDefault("''::character varying"), "''");
  assert.equal(normaliseDefault("'{}'::text[]"), "'{}'");
  assert.equal(normaliseDefault("(now())"), "now()");
  assert.equal(normaliseDefault(1), "1");
  assert.equal(normaliseDefault(false), "false");
  assert.equal(normaliseDefault(undefined), null);
  assert.equal(normaliseDefault("(a) + (b)"), "(a) + (b)");
});

test("3646: migrations — pending, applied but not in the journal, hash mismatch", () => {
  const files = {
    "0000_a": "CREATE TABLE a();",
    "0001_b": "CREATE TABLE b();",
    "0002_c": "CREATE TABLE c();",
  };
  const journal = {
    entries: [
      { tag: "0000_a", when: 100 },
      { tag: "0001_b", when: 200 },
      { tag: "0002_c", when: 300 },
    ],
  };
  const readSql = (tag) => files[tag] ?? null;
  const clean = [
    { id: 1, hash: sha256(files["0000_a"]), created_at: "100" },
    { id: 2, hash: sha256(files["0001_b"]), created_at: 200 },
    { id: 3, hash: sha256(files["0002_c"]), created_at: "300" },
  ];
  assert.deepEqual(migrationDrift(journal, readSql, clean), []);
  const drift = migrationDrift(journal, readSql, [
    clean[0],
    { id: 2, hash: "0".repeat(64), created_at: "200" },
    { id: 9, hash: "x", created_at: "999" },
  ]);
  assert.deepEqual(drift, [
    "migration hash mismatch: 0001_b (when 200)",
    "migration pending: 0002_c (when 300)",
    "migration applied, not in the journal: id 9 (created_at 999)",
  ]);
  assert.throws(
    () =>
      migrationDrift({ entries: [{ tag: "0009_x", when: 1 }] }, readSql, []),
    /0009_x is missing/,
  );
});

const SNAPSHOT = {
  tables: {
    "public.users": {
      name: "users",
      schema: "",
      columns: {
        id: {
          name: "id",
          type: "uuid",
          primaryKey: true,
          notNull: true,
          default: "gen_random_uuid()",
        },
        email: {
          name: "email",
          type: "varchar(255)",
          primaryKey: false,
          notNull: true,
        },
        state: {
          name: "state",
          type: "record_status",
          typeSchema: "public",
          primaryKey: false,
          notNull: true,
          default: "'active'",
        },
        meta: {
          name: "meta",
          type: "jsonb",
          primaryKey: false,
          notNull: true,
          default: "'{}'::jsonb",
        },
        n: { name: "n", type: "serial", primaryKey: false, notNull: true },
      },
      indexes: { users_email_idx: { name: "users_email_idx", isUnique: true } },
      foreignKeys: {},
      compositePrimaryKeys: {},
      uniqueConstraints: {},
      checkConstraints: {
        users_email_check: { name: "users_email_check", value: "email <> ''" },
      },
    },
  },
  enums: {
    "public.record_status": {
      name: "record_status",
      schema: "public",
      values: ["active", "retired"],
    },
  },
};

const prod = () => ({
  tables: [
    {
      schema: "public",
      name: "users",
      columns: [
        {
          name: "id",
          type: "uuid",
          notNull: true,
          default: "gen_random_uuid()",
          identity: null,
          generated: null,
        },
        {
          name: "email",
          type: "character varying(255)",
          notNull: true,
          default: null,
          identity: null,
          generated: null,
        },
        {
          name: "state",
          type: "record_status",
          notNull: true,
          default: "'active'::record_status",
          identity: null,
          generated: null,
        },
        {
          name: "meta",
          type: "jsonb",
          notNull: true,
          default: "'{}'::jsonb",
          identity: null,
          generated: null,
        },
        {
          name: "n",
          type: "integer",
          notNull: true,
          default: "nextval('users_n_seq'::regclass)",
          identity: null,
          generated: null,
        },
      ],
      indexes: [
        {
          name: "users_pkey",
          definition:
            "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)",
        },
        {
          name: "users_email_idx",
          definition:
            "CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email)",
        },
      ],
      constraints: [
        {
          name: "users_email_check",
          kind: "check",
          definition: "CHECK (((email)::text <> ''::text))",
        },
        {
          name: "users_email_not_null",
          kind: "not null",
          definition: "NOT NULL email",
        },
        {
          name: "users_pkey",
          kind: "primary key",
          definition: "PRIMARY KEY (id)",
        },
      ],
    },
    {
      schema: "drizzle",
      name: "__drizzle_migrations",
      columns: [],
      indexes: [],
      constraints: [],
    },
  ],
  enums: [
    { schema: "public", name: "record_status", values: ["active", "retired"] },
  ],
  sequences: [{ schema: "public", name: "users_n_seq" }],
});

test("3646: catalogue — a prod catalogue equal to the snapshot is no drift", () => {
  assert.deepEqual(catalogueDrift(SNAPSHOT, prod()), []);
});

test("3646: catalogue — missing, extra and changed tables, columns, indexes, constraints, enums", () => {
  const p = prod();
  const users = p.tables[0];
  users.columns[1].type = "text";
  users.columns[1].notNull = false;
  users.columns[2].default = "'retired'::record_status";
  users.columns.splice(3, 1);
  users.columns.push({
    name: "extra",
    type: "text",
    notNull: false,
    default: null,
  });
  users.indexes[1].definition =
    "CREATE INDEX users_email_idx ON public.users USING btree (email)";
  users.indexes.push({
    name: "users_stray_idx",
    definition: "CREATE INDEX users_stray_idx ON public.users (n)",
  });
  users.constraints.shift();
  users.constraints.push({
    name: "users_fk",
    kind: "foreign key",
    definition: "FOREIGN KEY (n) REFERENCES x(id)",
  });
  p.tables.push({
    schema: "public",
    name: "stray",
    columns: [],
    indexes: [],
    constraints: [],
  });
  p.enums[0].values = ["active"];
  p.enums.push({ schema: "public", name: "stray_enum", values: ["a"] });
  assert.deepEqual(catalogueDrift(SNAPSHOT, p), [
    "table extra: public.stray",
    "column type changed: public.users.email (tree character varying(255), prod text)",
    "column not-null changed: public.users.email (tree true, prod false)",
    "column default changed: public.users.state (tree \"'active'\", prod \"'retired'\")",
    "column missing: public.users.meta",
    "column extra: public.users.extra",
    "constraint missing: public.users users_email_check (check)",
    "constraint extra: public.users users_fk (foreign key)",
    "index changed: public.users users_email_idx (tree unique true, prod unique false)",
    "index extra: public.users users_stray_idx",
    "enum values changed: public.record_status (tree active,retired, prod active)",
    "enum extra: public.stray_enum",
  ]);
  assert.deepEqual(catalogueDrift(SNAPSHOT, { tables: [], enums: [] }), [
    "table missing: public.users",
    "enum missing: public.record_status",
  ]);
});

// Issue #3683: the clean prod schema of 2026-11-04 (prod-observe run 41828590216),
// reduced to the objects of its three false-positive classes plus ordinary tables;
// `snapshot` holds the same tables of `0055_snapshot.json`.
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("./__fixtures__/prod-schema-2026-11-04.json", import.meta.url),
    ),
    "utf8",
  ),
);
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const treeSql = (tag) => {
  const p = join(REPO, "apps/api/drizzle", `${tag}.sql`);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};
const TREE_JOURNAL = JSON.parse(
  readFileSync(join(REPO, "apps/api/drizzle/meta/_journal.json"), "utf8"),
);
const fixtureAnswer = () => JSON.parse(JSON.stringify(FIXTURE.answer));
const fixtureDrift = (answer = fixtureAnswer()) =>
  catalogueDrift(FIXTURE.snapshot, answer.catalogue, {
    handWrittenIndexes: handWrittenIndexes(TREE_JOURNAL, treeSql),
  });

test("3683: the clean prod schema of 2026-11-04 compares to no drift", () => {
  assert.deepEqual(fixtureDrift(), []);
});

test("3683: pg_partman — the partman schema and the partitions of a snapshot parent are not drift", () => {
  const tables = FIXTURE.answer.catalogue.tables;
  const without = (pred) =>
    catalogueDrift(
      FIXTURE.snapshot,
      { ...FIXTURE.answer.catalogue, tables: tables.filter(pred) },
      { handWrittenIndexes: handWrittenIndexes(TREE_JOURNAL, treeSql) },
    );
  // Today's answer carries no partition field: the parent is recognised by its
  // partitioned (`ON ONLY`) indexes and the children by its name prefix and columns.
  assert.ok(tables.every((t) => !("partitionOf" in t)));
  assert.ok(tables.some((t) => t.name === "audit_ledger_y2026_m01"));
  assert.ok(tables.some((t) => t.schema === "partman"));
  // With the box field, the field decides.
  const a = fixtureAnswer();
  for (const t of a.catalogue.tables)
    t.partitionOf = /^audit_ledger_/.test(t.name)
      ? "public.audit_ledger"
      : null;
  assert.deepEqual(fixtureDrift(a), []);
  const b = fixtureAnswer();
  for (const t of b.catalogue.tables) t.partitionOf = null;
  assert.deepEqual(fixtureDrift(b), [
    "table extra: public.audit_ledger_default",
    "table extra: public.audit_ledger_y2026_m01",
  ]);
  // A partition of a parent the snapshot lacks is still drift.
  assert.deepEqual(
    without((t) => t.name !== "audit_ledger" || t.schema !== "public"),
    [
      "table missing: public.audit_ledger",
      "table extra: public.audit_ledger_default",
      "table extra: public.audit_ledger_y2026_m01",
    ],
  );
});

test("3683: constraint and index names compare after Postgres' 63-byte truncation", () => {
  assert.equal(pgIdentifier("a".repeat(70)), "a".repeat(63));
  assert.equal(pgIdentifier("short"), "short");
  // A multi-byte character is never split: 62 ASCII + one 2-byte letter = 64 bytes.
  assert.equal(pgIdentifier(`${"a".repeat(62)}я`), "a".repeat(62));
  const fk = Object.values(
    FIXTURE.snapshot.tables["public.direction_specialties"].foreignKeys,
  ).map((k) => k.name);
  assert.ok(fk.some((n) => Buffer.byteLength(n) > 63));
  // A truncated name that differs from the snapshot's prefix is still drift.
  const a = fixtureAnswer();
  const t = a.catalogue.tables.find((x) => x.name === "direction_specialties");
  const k = t.constraints.find((x) => x.name.length === 63);
  const stored = k.name;
  k.name = `${stored.slice(0, 62)}x`;
  assert.deepEqual(fixtureDrift(a), [
    `constraint missing: public.direction_specialties ${stored} (foreign key)`,
    `constraint extra: public.direction_specialties ${k.name} (foreign key)`,
  ]);
});

test("3683: hand-written indexes — created in migration SQL, renamed and dropped in journal order", () => {
  const files = {
    "0000_a":
      'CREATE INDEX "t_a_trgm_idx" ON "t" USING gin ("a" gin_trgm_ops);--> statement-breakpoint\n' +
      'CREATE UNIQUE INDEX IF NOT EXISTS "t_b_idx" ON "t" ("b");\n' +
      '-- CREATE INDEX "t_commented_idx" ON "t" ("c");\n',
    "0001_b":
      'ALTER INDEX "t_a_trgm_idx" RENAME TO "u_a_trgm_idx";--> statement-breakpoint\n' +
      'DROP INDEX IF EXISTS "t_b_idx";\n',
  };
  const journal = {
    entries: [
      { tag: "0000_a", when: 1 },
      { tag: "0001_b", when: 2 },
    ],
  };
  assert.deepEqual(
    [...handWrittenIndexes(journal, (tag) => files[tag] ?? null)],
    ["u_a_trgm_idx"],
  );
  const tree = handWrittenIndexes(TREE_JOURNAL, treeSql);
  for (const name of [
    "directions_slug_trgm_idx",
    "experts_patronymic_trgm_idx",
    "organisations_title_trgm_idx",
  ])
    assert.ok(tree.has(name), name);
  assert.ok(!tree.has("partners_slug_trgm_idx"), "renamed away in 0054");
  assert.ok(!tree.has("event_experts_legacy_speaker_key"), "dropped in 0036");
});

test("3683: real drift on the clean prod schema still shows — an extra table, a missing column, an unknown index", () => {
  const a = fixtureAnswer();
  a.catalogue.tables.push({
    schema: "public",
    name: "audit_ledger_shadow",
    columns: [],
    indexes: [],
    constraints: [],
  });
  const dir = a.catalogue.tables.find((t) => t.name === "directions");
  dir.columns = dir.columns.filter((c) => c.name !== "title");
  dir.indexes.push({
    name: "directions_stray_trgm_idx",
    definition:
      "CREATE INDEX directions_stray_trgm_idx ON public.directions USING gin (slug gin_trgm_ops)",
  });
  assert.deepEqual(fixtureDrift(a), [
    "table extra: public.audit_ledger_shadow",
    "column missing: public.directions.title",
    "index extra: public.directions directions_stray_trgm_idx",
  ]);
});
