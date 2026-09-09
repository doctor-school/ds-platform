#!/usr/bin/env node
// Synthetic SQL-cluster drill only. Never accepts production endpoints or data.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function namespace(run) {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(run ?? ""))
    throw new Error("invalid run name");
  return `ds-pg18-2135-${run}`;
}

export function auditedRunner({ audit, execute }) {
  return async (command, input = "") => {
    await audit({ at: new Date().toISOString(), command, input });
    return execute(command, input);
  };
}

export async function assertAbsent(resources, inspect) {
  for (const resource of resources) {
    if ((await inspect(resource)).trim())
      throw new Error(`resource already exists: ${resource}`);
  }
}

export function databasePlan(names) {
  if (!names.includes("postgres")) throw new Error("postgres database missing");
  if (new Set(names).size !== names.length)
    throw new Error("duplicate database");
  return names.map((name, index) => {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name))
      throw new Error("unsupported database identifier");
    return { name, archive: `${index}.dump`, create: name !== "postgres" };
  });
}

export function bootstrapRestoreScript() {
  // PG18 preserves GRANTED BY. The original bootstrap superuser must remain
  // bootstrap (OID 10); a different initdb user cannot recreate that authority.
  return `test "$(grep -cx 'CREATE ROLE source_admin;' /scratch/globals.sql)" -eq 1
sed '/^CREATE ROLE source_admin;$/d' /scratch/globals.sql > /scratch/reconciled.sql
exec psql -X -v ON_ERROR_STOP=1 -h "$1" -U source_admin -d postgres -f /scratch/reconciled.sql`;
}

export async function stopOwnedSession(ids, stop) {
  if (ids.length) await stop(ids);
}

const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const hash = (s) => createHash("sha256").update(s).digest("hex");
const root = fileURLToPath(new URL("../../", import.meta.url));
const sqlDir = new URL("../../infra/rehearsal/pg18/", import.meta.url);

async function main() {
  const [host, runId, auditPath, evidencePath] = process.argv.slice(2);
  const prefix = namespace(runId);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(host ?? "") ||
    !isAbsolute(auditPath ?? "") ||
    !isAbsolute(evidencePath ?? "") ||
    process.argv.length !== 6
  ) {
    throw new Error(
      "usage: node tools/deploy/pg18-rehearsal.mjs SSH_ALIAS RUN_ID ABS_AUDIT_JSONL ABS_EVIDENCE_JSON",
    );
  }
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (git("status", "--porcelain"))
    throw new Error("rehearsal requires clean committed worktree");
  const evidence = {
    scope: "synthetic SQL cluster only",
    commit: git("rev-parse", "HEAD"),
    prefix,
    pending: [
      "real application migrations and flows",
      "Zitadel login/token",
      "GlitchTip ingest/read",
      "representative RF restore",
      "production deployment guard",
      "production cutover proposal",
    ],
    stages: [],
    images: {},
    status: "running",
  };
  const createdContainerIds = [];
  const save = () =>
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  const run = auditedRunner({
    audit: (row) =>
      appendFileSync(
        auditPath,
        JSON.stringify({ ...row, host, commit: evidence.commit }) + "\n",
      ),
    execute: (args, input) =>
      execFileSync(
        "ssh",
        ["-o", "BatchMode=yes", host, args.map(quote).join(" ")],
        {
          input,
          encoding: "utf8",
          timeout: 900000,
          maxBuffer: 16 * 1024 * 1024,
        },
      ),
  });
  const docker = (...args) => run(["sudo", "-n", "docker", ...args]);
  const label = [
    "--label",
    "school.doctor.rehearsal=2135",
    "--label",
    `school.doctor.run=${prefix}`,
  ];
  const limited = ["--memory", "768m", "--cpus", "1", "--pids-limit", "128"];
  const stage = async (name, action) => {
    console.log(`[${name}] started`);
    const start = Date.now();
    const result = await action();
    evidence.stages.push({
      name,
      seconds: (Date.now() - start) / 1000,
      result,
    });
    save();
    console.log(`[${name}] passed`);
    return result;
  };
  const volume = (name) => `${prefix}-${name}`;
  const container = (name) => `${prefix}-${name}`;
  const dataPath = (major) =>
    major === 17 ? "/var/lib/postgresql/data" : "/var/lib/postgresql/18/docker";
  const mountPath = (major) =>
    major === 17 ? "/var/lib/postgresql/data" : "/var/lib/postgresql";
  const env = (major) => [
    "-e",
    `PGDATA=${dataPath(major)}`,
    "-e",
    "PGBACKREST_STANZA=drill",
    "-e",
    `PGBACKREST_PG1_PATH=${dataPath(major)}`,
    "-e",
    "PGBACKREST_PG1_USER=source_admin",
    "-e",
    "PGBACKREST_REPO1_PATH=/pgbackrest",
    "-e",
    "PGBACKREST_REPO1_RETENTION_FULL=99",
    "-e",
    "PGBACKREST_LOG_LEVEL_CONSOLE=error",
    "-e",
    "PGBACKREST_START_FAST=y",
  ];
  const image = (major) => evidence.images[major].id;
  const mounts = (name, major, repo) => [
    "-v",
    `${volume(name)}:${mountPath(major)}`,
    "-v",
    `${volume(repo)}:/pgbackrest`,
  ];
  const sql = (name, db, statement, user = "source_admin") =>
    docker(
      "exec",
      "-i",
      container(name),
      "psql",
      "-h",
      "127.0.0.1",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      user,
      "-d",
      db,
      "-c",
      statement,
    );
  const waitReady = async (name, user = "source_admin") => {
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        if (
          (
            await sql(name, "postgres", "SELECT NOT pg_is_in_recovery()", user)
          ).trim() === "t"
        )
          return;
      } catch {
        /* bounded readiness */
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`database readiness timed out: ${name}`);
  };
  const createVolume = (name) =>
    docker("volume", "create", ...label, volume(name));
  const start = async (
    name,
    major,
    repo,
    { restore = false, user = "source_admin" } = {},
  ) => {
    await createVolume(`${name}-socket`);
    const command = restore
      ? ["postgres", "-c", "archive_mode=off"]
      : [
          "bash",
          "-ceu",
          'mkdir -p /pgbackrest; chown postgres:postgres /pgbackrest; exec docker-entrypoint.sh postgres -c archive_mode=on -c "archive_command=pgbackrest --stanza=drill archive-push %p" -c shared_buffers=64MB -c max_wal_size=128MB',
        ];
    const createdId = await docker(
      "run",
      "-d",
      "--name",
      container(name),
      ...label,
      ...limited,
      "--network",
      prefix,
      ...mounts(name, major, repo),
      "-v",
      `${volume(`${name}-socket`)}:/var/run/postgresql`,
      ...env(major),
      "-e",
      `POSTGRES_USER=${user}`,
      "-e",
      "POSTGRES_DB=postgres",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      `POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=en_US.utf8 ${major === 18 ? "--data-checksums" : ""}`,
      "--entrypoint",
      restore ? "docker-entrypoint.sh" : "",
      image(major),
      ...command,
    );
    createdContainerIds.push(createdId.trim());
    await waitReady(name, user);
    const observed = (
      await sql(name, "postgres", "SHOW data_directory", user)
    ).trim();
    if (observed !== dataPath(major)) throw new Error("unexpected PGDATA");
    const version = (
      await docker(
        "exec",
        container(name),
        "cat",
        `${dataPath(major)}/PG_VERSION`,
      )
    ).trim();
    if (version !== String(major)) throw new Error("unexpected PG_VERSION");
  };
  // A real sidecar shares only read-only PGDATA, socket and its own repository.
  // The same immutable image guarantees client/server pgBackRest and UID parity.
  const backup = (name, ...args) => {
    const major = name.endsWith("17") ? 17 : 18;
    return docker(
      "run",
      "--rm",
      ...label,
      ...limited,
      "--network",
      "none",
      "--user",
      "postgres",
      "-v",
      `${volume(name)}:${mountPath(major)}:ro`,
      "-v",
      `${volume(`${name}-socket`)}:/var/run/postgresql`,
      "-v",
      `${volume(`repo${major}`)}:/pgbackrest`,
      ...env(major),
      "--entrypoint",
      "pgbackrest",
      image(major),
      "--stanza=drill",
      ...args,
    );
  };
  const databases = async (name) =>
    databasePlan(
      (
        await sql(
          name,
          "postgres",
          "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname",
        )
      )
        .trim()
        .split("\n"),
    );
  const summary = async (name) => {
    const result = {};
    for (const db of await databases(name)) {
      const script = readFileSync(new URL("integrity.sql", sqlDir), "utf8");
      result[db.name] = hash(await sql(name, db.name, script));
    }
    result.roles = hash(
      await sql(
        name,
        "postgres",
        "SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname",
      ),
    );
    result.memberships = hash(
      await sql(
        name,
        "postgres",
        "SELECT roleid::regrole,member::regrole,grantor::regrole,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY roleid::regrole::text,member::regrole::text",
      ),
    );
    result.databases = hash(
      await sql(
        name,
        "postgres",
        "SELECT datname,datdba::regrole,encoding,datcollate,datctype,datlocprovider,datacl,shobj_description(oid,'pg_database') FROM pg_database WHERE NOT datistemplate ORDER BY datname",
      ),
    );
    result.databaseSettings = hash(
      await sql(
        name,
        "postgres",
        "SELECT d.datname,COALESCE(r.rolname,'ALL'),s.setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase LEFT JOIN pg_roles r ON r.oid=s.setrole ORDER BY d.datname,r.rolname",
      ),
    );
    return result;
  };
  const checkEqual = (a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
      throw new Error("cluster integrity mismatch");
  };
  const pitr = async (source, major, target, repo) => {
    await backup(source, "stanza-create");
    await backup(source, "check");
    await backup(source, "--type=full", "backup");
    await backup(source, "--type=incr", "backup");
    for (const db of await databases(source))
      await sql(source, db.name, "INSERT INTO drill.markers VALUES ('before')");
    const before = await summary(source);
    const restorePoint = `drill_${major}`;
    const lsn = (
      await sql(
        source,
        "postgres",
        `SELECT pg_create_restore_point('${restorePoint}')`,
      )
    ).trim();
    for (const db of await databases(source))
      await sql(source, db.name, "INSERT INTO drill.markers VALUES ('after')");
    await sql(source, "postgres", "SELECT pg_switch_wal()");
    await backup(source, "check");
    await createVolume(target);
    await docker(
      "run",
      "--rm",
      ...label,
      ...limited,
      "--network",
      "none",
      ...mounts(target, major, repo),
      ...env(major),
      "--entrypoint",
      "bash",
      image(major),
      "-ceu",
      `mkdir -p ${dataPath(major)}; chown postgres:postgres ${dataPath(major)}; exec gosu postgres pgbackrest --stanza=drill --type=name --target=${restorePoint} --target-action=promote restore`,
    );
    await start(target, major, repo, { restore: true });
    checkEqual(before, await summary(target));
    for (const db of await databases(target)) {
      const markers = (
        await sql(
          target,
          db.name,
          "SELECT string_agg(marker, ',' ORDER BY marker) FROM drill.markers",
        )
      ).trim();
      if (markers !== "before")
        throw new Error(`PITR marker failure: ${db.name}`);
    }
    return {
      lsn,
      restorePoint,
      integrity: before,
      backups: JSON.parse(await backup(source, "--output=json", "info")),
      recovered: JSON.parse(
        (
          await sql(
            target,
            "postgres",
            "SELECT json_build_object('systemId',system_identifier::text,'timeline',(SELECT timeline_id FROM pg_control_checkpoint())) FROM pg_control_system()",
          )
        ).trim(),
      ),
    };
  };
  try {
    await stage("absence-and-capacity", async () => {
      await assertAbsent(["container", "volume", "network"], (kind) =>
        docker(
          kind,
          "ls",
          "--filter",
          `name=${prefix}`,
          "--format",
          kind === "container" ? "{{.Names}}" : "{{.Name}}",
        ),
      );
      return {
        docker: (
          await docker("version", "--format", "{{.Server.Version}}")
        ).trim(),
        disk: await run([
          "sudo",
          "-n",
          "df",
          "-Pk",
          (await docker("info", "--format", "{{.DockerRootDir}}")).trim(),
        ]),
      };
    });
    await stage("candidate-images", async () => {
      for (const major of [17, 18]) {
        const base = `pgvector/pgvector:0.8.6-pg${major}-bookworm`;
        await docker("pull", base);
        const inspect = JSON.parse(await docker("image", "inspect", base))[0];
        const digest = inspect.RepoDigests[0];
        const tag = `${prefix}:pg${major}`;
        const dockerfile = `FROM ${digest}\nRUN apt-get update && apt-get install -y --no-install-recommends postgresql-${major}-partman pgbackrest ca-certificates && rm -rf /var/lib/apt/lists/*\n`;
        await run(
          [
            "sudo",
            "-n",
            "docker",
            "build",
            "--label",
            "school.doctor.rehearsal=2135",
            "-t",
            tag,
            "-",
          ],
          dockerfile,
        );
        const built = JSON.parse(await docker("image", "inspect", tag))[0];
        const packages = await docker(
          "run",
          "--rm",
          ...limited,
          "--network",
          "none",
          "--entrypoint",
          "dpkg-query",
          built.Id,
          "-W",
          "postgresql*",
          "pgbackrest",
        );
        evidence.images[major] = {
          base: digest,
          id: built.Id,
          architecture: built.Architecture,
          packages,
          declaredVolumes: built.Config.Volumes,
          environment: built.Config.Env,
        };
        save();
      }
      return "Exact local image IDs retained; promotion requires exporting/publishing these same artifacts.";
    });
    // Docker's unique container name is an atomic lease even if two callers
    // pass the initial absence probe concurrently. It is retained with the run.
    await docker(
      "create",
      "--name",
      `${prefix}-lease`,
      ...label,
      ...limited,
      "--network",
      "none",
      image(17),
      "true",
    );
    await docker("network", "create", "--internal", ...label, prefix);
    for (const name of [
      "source17",
      "repo17",
      "candidate18",
      "repo18",
      "scratch",
    ])
      await createVolume(name);
    await stage("synthetic-fixture", async () => {
      await start("source17", 17, "repo17");
      await sql(
        "source17",
        "postgres",
        "CREATE ROLE fixture_owner LOGIN; CREATE ROLE fixture_reader; GRANT fixture_reader TO fixture_owner;",
      );
      for (const db of ["ds_prod", "zitadel", "glitchtip"])
        await sql(
          "source17",
          "postgres",
          `CREATE DATABASE ${db} OWNER fixture_owner`,
        );
      for (const db of await databases("source17"))
        await sql(
          "source17",
          db.name,
          readFileSync(new URL("fixture.sql", sqlDir), "utf8"),
        );
      for (const db of await databases("source17"))
        await sql(
          "source17",
          "postgres",
          `ALTER DATABASE ${db.name} OWNER TO fixture_owner; COMMENT ON DATABASE ${db.name} IS 'synthetic preservation fixture'; REVOKE CONNECT ON DATABASE ${db.name} FROM PUBLIC; GRANT CONNECT ON DATABASE ${db.name} TO fixture_reader; ALTER DATABASE ${db.name} SET statement_timeout='19s'; ALTER ROLE fixture_owner IN DATABASE ${db.name} SET lock_timeout='7s';`,
        );
      return {
        databases: (await databases("source17")).map((db) => db.name),
        integrity: await summary("source17"),
      };
    });
    await stage("pg17-full-incremental-wal-pitr", () =>
      pitr("source17", 17, "restored17", "repo17"),
    );
    await stage("logical-17-to-18", async () => {
      const before = await summary("restored17");
      await start("candidate18", 18, "repo18");
      const client = async (args) =>
        docker(
          "run",
          "--rm",
          ...label,
          ...limited,
          "--network",
          prefix,
          "-v",
          `${volume("scratch")}:/scratch`,
          "--entrypoint",
          args[0],
          image(18),
          ...args.slice(1),
        );
      await client([
        "pg_dumpall",
        "-h",
        container("restored17"),
        "-U",
        "source_admin",
        "--globals-only",
        "--no-role-passwords",
        "-f",
        "/scratch/globals.sql",
      ]);
      await client([
        "bash",
        "-ceu",
        bootstrapRestoreScript(),
        "bootstrap-restore",
        container("candidate18"),
      ]);
      for (const db of await databases("restored17")) {
        await client([
          "pg_dump",
          "-h",
          container("restored17"),
          "-U",
          "source_admin",
          "-Fc",
          "-d",
          db.name,
          "-f",
          `/scratch/${db.archive}`,
        ]);
        if (!db.create) {
          // Preserve COMMENT, ACL and DATABASE PROPERTIES entries under -C;
          // suppress exactly the already-initialized postgres CREATE entry.
          await client([
            "bash",
            "-ceu",
            `pg_restore --create --list /scratch/${db.archive} > /scratch/toc
test "$(grep -Ec '^[0-9]+; [0-9]+ [0-9]+ DATABASE - postgres ' /scratch/toc)" -eq 1
grep -E ' (DATABASE - postgres |COMMENT - DATABASE postgres |ACL - DATABASE postgres |DATABASE PROPERTIES - postgres )' /scratch/toc > /scratch/database-toc
pg_restore --create --schema-only --use-list /scratch/database-toc --file /scratch/database.sql /scratch/${db.archive}
test "$(grep -Ec '^CREATE DATABASE postgres WITH .*;$' /scratch/database.sql)" -eq 1
sed '/^CREATE DATABASE postgres WITH .*;$/d' /scratch/database.sql > /scratch/database-reconciled.sql
exec psql -X -v ON_ERROR_STOP=1 -h "$1" -U source_admin -d postgres -f /scratch/database-reconciled.sql`,
            "database-bootstrap",
            container("candidate18"),
          ]);
        }
        await client([
          "pg_restore",
          "--exit-on-error",
          "-h",
          container("candidate18"),
          "-U",
          "source_admin",
          "-d",
          "postgres",
          ...(db.create ? ["--create"] : []),
          `/scratch/${db.archive}`,
        ]);
      }
      checkEqual(before, await summary("candidate18"));
      checkEqual(before, await summary("restored17"));
      await sql("candidate18", "postgres", "ANALYZE");
      return {
        integrity: before,
        phaseA: "retained PG17 restored source unchanged",
        checksums: (
          await sql("candidate18", "postgres", "SHOW data_checksums")
        ).trim(),
      };
    });
    // A separate marker table makes this second PITR independent of the first.
    for (const db of await databases("candidate18"))
      await sql(
        "candidate18",
        db.name,
        "ALTER TABLE drill.markers RENAME TO pg17_markers; CREATE TABLE drill.markers(marker text PRIMARY KEY)",
      );
    await stage("pg18-full-incremental-wal-pitr", () =>
      pitr("candidate18", 18, "restored18", "repo18"),
    );
    await stage("phase-b-pg18-forward-recovery", async () => {
      // The candidate contains BOTH acknowledged markers; the historical PITR
      // target intentionally predates the second. Recover its latest backup
      // into another PG18 volume, never reconnect the stale PG17 volume.
      const acknowledged = await summary("candidate18");
      await backup("candidate18", "--type=incr", "backup");
      await createVolume("forward18");
      await docker(
        "run",
        "--rm",
        ...label,
        ...limited,
        "--network",
        "none",
        ...mounts("forward18", 18, "repo18"),
        ...env(18),
        "--entrypoint",
        "bash",
        image(18),
        "-ceu",
        `mkdir -p ${dataPath(18)}; chown postgres:postgres ${dataPath(18)}; exec gosu postgres pgbackrest --stanza=drill --type=immediate --target-action=promote restore`,
      );
      await start("forward18", 18, "repo18", { restore: true });
      checkEqual(acknowledged, await summary("forward18"));
      for (const db of await databases("forward18")) {
        if (
          (
            await sql(
              "forward18",
              db.name,
              "SELECT count(*) FROM drill.markers WHERE marker IN ('before','after')",
            )
          ).trim() !== "2"
        )
          throw new Error("acknowledged write lost");
      }
      return {
        integrity: acknowledged,
        recovery:
          "fresh PG18 forward restore includes every acknowledged synthetic marker",
        downgrade17: "not exercised; unavailable",
      };
    });
    await stage("retained-pg17", async () => ({
      integrity: await summary("source17"),
      backups: JSON.parse(await backup("source17", "--output=json", "info")),
    }));
    await stage("phase-a-old-cluster-restart", async () => {
      const before = await summary("restored17");
      await docker("stop", container("restored17"));
      await docker("start", container("restored17"));
      await waitReady("restored17");
      checkEqual(before, await summary("restored17"));
      return {
        integrity: before,
        boundary: "database-only old endpoint restart; no application cutover",
      };
    });
    await stage("task-storage", async () => {
      const sizes = {};
      for (const [name, major, repo] of [
        ["source17", 17, "repo17"],
        ["restored17", 17, "repo17"],
        ["candidate18", 18, "repo18"],
        ["restored18", 18, "repo18"],
        ["forward18", 18, "repo18"],
      ]) {
        sizes[name] = (
          await docker("exec", container(name), "du", "-sk", dataPath(major))
        ).trim();
        sizes[repo] = (
          await docker("exec", container(name), "du", "-sk", "/pgbackrest")
        ).trim();
      }
      return sizes;
    });
    evidence.status = "passed-core-only";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error.message;
    throw error;
  } finally {
    // Retain volumes/images for diagnosis, but no background task processes.
    await stopOwnedSession(createdContainerIds, (ids) =>
      docker("stop", ...ids),
    );
    save();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
