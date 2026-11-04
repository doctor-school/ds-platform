import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createDrizzle } from "@ds/db";
import { nativePg } from "./native-pg.js";
import { ownedDatabasePair, withoutVector } from "./vector-archive.js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing native archive fixture ${name}`);
  return value;
};
const sourceUrl = required("E2E_API_PROBE_DATABASE_URL");
const targetUrl = required("E2E_API_PROBE_NOVECTOR_DATABASE_URL");
const names = ownedDatabasePair(sourceUrl, targetUrl);
const artifacts = resolve(required("E2E_API_PROBE_ARTIFACT_DIR"));
const requestedPrivate = required("E2E_API_PROBE_PRIVATE_DIR");
if (!isAbsolute(requestedPrivate))
  throw new Error("PG private directory must be absolute");
const privateDir = resolve(
  realpathSync(dirname(requestedPrivate)),
  requestedPrivate.split(/[\\/]/).at(-1)!,
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
for (const parent of [artifacts, root]) {
  const path = relative(parent, privateDir);
  if (!path || (!path.startsWith(`..${sep}`) && !isAbsolute(path)))
    throw new Error(
      "PG private archives must stay outside uploaded reports and the worktree",
    );
}
mkdirSync(artifacts, { recursive: true });
const { appendFileSync } = await import("node:fs");
const log = (event: Record<string, unknown>) => {
  const line =
    JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n";
  appendFileSync(resolve(artifacts, "stand-ops-3688.log"), line);
  if (process.env.E2E_API_PROBE_OPS_LOG)
    appendFileSync(process.env.E2E_API_PROBE_OPS_LOG, line);
};
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const admin = createDrizzle(adminUrl.toString()).pool;
const source = createDrizzle(sourceUrl).pool;
const target = createDrizzle(targetUrl).pool;
const fingerprintSql = `SELECT json_build_object(
  'migrations', (SELECT json_agg(t ORDER BY t.id) FROM drizzle.__drizzle_migrations t),
  'columns', (SELECT json_agg(to_jsonb(t) - ARRAY['table_catalog', 'udt_catalog', 'domain_catalog', 'ordinal_position', 'dtd_identifier'] ORDER BY t.table_schema, t.table_name, t.ordinal_position)
    FROM information_schema.columns t WHERE table_schema IN ('public', 'drizzle')),
  'tables', (SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public')
) AS facts`;
let createdPrivate = false;
try {
  log({
    command: "SELECT target database absence before native copy",
    target: names.target,
  });
  const existing = await admin.query(
    "SELECT datname FROM pg_database WHERE datname = $1",
    [names.target],
  );
  if (existing.rowCount !== 0)
    throw new Error(
      "Missing-vector target already exists; refusing reuse or overwrite",
    );
  log({
    command:
      "SELECT source identity, vector, migrated schema and empty worker queues",
    source: names.source,
  });
  const state =
    await source.query(`SELECT current_database() AS name, to_regtype('vector')::text AS vector,
    (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations,
    (SELECT count(*)::int FROM media_cleanup_jobs) AS cleanup,
    (SELECT count(*)::int FROM idempotency_keys) AS uploads`);
  if (
    state.rows[0].name !== names.source ||
    state.rows[0].vector !== "vector" ||
    state.rows[0].migrations < 1 ||
    state.rows[0].cleanup !== 0 ||
    state.rows[0].uploads !== 0
  )
    throw new Error(
      "Source is not the canonical migrated and empty-work owned DB",
    );
  const sourceFacts = (await source.query(fingerprintSql)).rows[0].facts;
  nativePg(
    [
      "bash",
      "-c",
      "test -r <(printf support) && pg_dump --version && pg_restore --version",
    ],
    log,
  );
  mkdirSync(privateDir);
  createdPrivate = true;
  writeFileSync(resolve(privateDir, "owner.json"), JSON.stringify(names));
  const archive = nativePg(
    ["pg_dump", "-U", "ds", "-d", names.source, "--format=custom"],
    log,
  );
  writeFileSync(resolve(privateDir, "source.dump"), archive);
  const toc = nativePg(["pg_restore", "--list"], log, archive).toString("utf8");
  const selected = withoutVector(toc);
  writeFileSync(resolve(privateDir, "full.toc"), toc);
  writeFileSync(resolve(privateDir, "selected.toc"), selected.list);
  log({
    command: "CREATE DATABASE exact absent owned negative target",
    target: names.target,
  });
  await admin.query(`CREATE DATABASE ${names.target} OWNER ds`);
  const empty = await target.query(
    "SELECT current_database() AS name, (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%') AS objects",
  );
  if (empty.rows[0].name !== names.target || empty.rows[0].objects !== 0)
    throw new Error("Target must be the new empty owned database");
  // Bash reads only the first line; the remaining binary stdin is the native archive.
  const script = `IFS= read -r toc; pg_restore --exit-on-error --single-transaction -U ds -d ${names.target} --use-list <(printf '%s' "$toc" | base64 -d)`;
  nativePg(
    ["bash", "-c", script],
    log,
    Buffer.concat([
      Buffer.from(Buffer.from(selected.list).toString("base64") + "\n"),
      archive,
    ]),
  );
  log({
    command:
      "SELECT restored schema/migration equivalence, table row counts and vector absence",
    target: names.target,
  });
  const restoredFacts = (await target.query(fingerprintSql)).rows[0].facts;
  if (JSON.stringify(sourceFacts) !== JSON.stringify(restoredFacts))
    throw new Error("Restored schema or migration history differs");
  const counts: Record<string, number> = {};
  for (const table of sourceFacts.tables as string[]) {
    const identifier = '"' + table.replaceAll('"', '""') + '"';
    const before = (
      await source.query(
        `SELECT count(*)::int AS count FROM public.${identifier}`,
      )
    ).rows[0].count;
    const after = (
      await target.query(
        `SELECT count(*)::int AS count FROM public.${identifier}`,
      )
    ).rows[0].count;
    if (before !== after)
      throw new Error(`Restored row count differs: ${table}`);
    counts[table] = after;
  }
  if (
    (await target.query("SELECT to_regtype('vector') AS vector")).rows[0]
      .vector !== null
  )
    throw new Error("Restored negative DB still has vector");
  writeFileSync(
    resolve(artifacts, "missing-vector-copy.json"),
    JSON.stringify(
      {
        ...names,
        nativeRestoreExit: 0,
        omitted: selected.omitted,
        schemaAndMigrationsEqual: true,
        migrationCount: state.rows[0].migrations,
        schemaAndMigrationsSha256: createHash("sha256")
          .update(JSON.stringify(sourceFacts))
          .digest("hex"),
        archiveSha256: createHash("sha256").update(archive).digest("hex"),
        fullTocSha256: createHash("sha256").update(toc).digest("hex"),
        selectedTocSha256: createHash("sha256")
          .update(selected.list)
          .digest("hex"),
        nonVectorEntriesUnchanged: true,
        tableCounts: counts,
        vector: null,
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.all([admin.end(), source.end(), target.end()]);
  if (
    createdPrivate &&
    readFileSync(resolve(privateDir, "owner.json"), "utf8") ===
      JSON.stringify(names)
  ) {
    rmSync(privateDir, { recursive: true });
    log({
      command: "removed exact owned private archive/TOC directory",
      privateDir,
    });
  }
}
