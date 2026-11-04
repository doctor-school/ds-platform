// Issue #3646: the drift of a prod `schema` answer against the tree (spec §5 «Local commands.»).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  catalogueDrift,
  migrationDrift,
  newestSnapshot,
  normaliseDefault,
  normaliseType,
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
