#!/usr/bin/env node
// Synthetic SQL-cluster drill only. Never accepts production endpoints or data.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const hash = (s) => createHash("sha256").update(s).digest("hex");
const root = fileURLToPath(new URL("../../", import.meta.url));
const sqlDir = new URL("../../infra/rehearsal/pg18/", import.meta.url);

async function main() {
  const [host, runId, auditPath, evidencePath] = process.argv.slice(2);
  const prefix = namespace(runId);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(host ?? "") ||
    !auditPath ||
    !evidencePath ||
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
    const command = restore
      ? ["postgres", "-c", "archive_mode=off"]
      : [
          "bash",
          "-ceu",
          'mkdir -p /pgbackrest; chown postgres:postgres /pgbackrest; exec docker-entrypoint.sh postgres -c archive_mode=on -c "archive_command=pgbackrest --stanza=drill archive-push %p" -c shared_buffers=64MB -c max_wal_size=128MB',
        ];
    await docker(
      "run",
      "-d",
      "--name",
      container(name),
      ...label,
      ...limited,
      "--network",
      prefix,
      ...mounts(name, major, repo),
      ...env(major),
      "-e",
      `POSTGRES_USER=${user}`,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      `POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=en_US.utf8 ${major === 18 ? "--data-checksums" : ""}`,
      "--entrypoint",
      restore ? "docker-entrypoint.sh" : "",
      image(major),
      ...command,
    );
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
  const backup = (name, ...args) =>
    docker(
      "exec",
      "--user",
      "postgres",
      container(name),
      "pgbackrest",
      "--stanza=drill",
      ...args,
    );
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
        "SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin FROM pg_roles WHERE rolname !~ '^pg_' AND rolname <> 'target_admin' ORDER BY rolname",
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
        disk: await run(["sudo", "-n", "df", "-Pk", "/var/lib/docker"]),
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
      await start("candidate18", 18, "repo18", { user: "target_admin" });
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
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        container("candidate18"),
        "-U",
        "target_admin",
        "-d",
        "postgres",
        "-f",
        "/scratch/globals.sql",
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
    await stage("retained-pg17", async () => ({
      integrity: await summary("source17"),
      backups: JSON.parse(await backup("source17", "--output=json", "info")),
    }));
    evidence.status = "passed-core-only";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error.message;
    throw error;
  } finally {
    // No automatic deletion. Failed resources remain available for diagnosis.
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
