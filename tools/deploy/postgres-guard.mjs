import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

export const DATA_PATH = "infra/deploy/compose/data-prod/";
export const SOURCE_LABEL = "org.doctor-school.postgres-source";
const fail = (message) => {
  throw new Error(
    `PostgreSQL guard: ${message}; ordinary deployment refused (migration: #2101)`,
  );
};
const requireFact = (condition, message) => {
  if (!condition) fail(message);
};

export function postgresSourceHash(files) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(files)
          .sort()
          .map((p) => [p, createHash("sha256").update(files[p]).digest("hex")]),
      ),
    )
    .digest("hex");
}

export function postgresContract(files) {
  const c = parse(files["compose.yml"]);
  requireFact(
    c?.name && c.services?.postgres && c.services?.pgbackrest,
    "missing compose contract",
  );
  const server = c.services.postgres;
  const backup = c.services.pgbackrest;
  requireFact(
    typeof files["postgres/postgresql.conf"] === "string",
    "missing server configuration",
  );
  requireFact(
    !/^\s*(?:config_file|include|include_if_exists|include_dir)\s*(?:=|\s)/im.test(
      files["postgres/postgresql.conf"],
    ),
    "server path/include override requires a separately reviewed configuration contract",
  );
  const declaredMajor = (text) => {
    const lines = String(text)
      .split(/\r?\n/)
      .filter((l) => /^FROM\s/i.test(l));
    requireFact(lines.length === 1, "unknown or multi-stage PostgreSQL build");
    const m = lines[0].match(
      /^FROM\s+(?:pgvector\/pgvector:pg|postgres:)(\d+)(?:[.\w@:-]*)\s*$/i,
    );
    requireFact(m, "unknown PostgreSQL base major");
    return Number(m[1]);
  };
  const major = declaredMajor(files["postgres/Dockerfile"]);
  requireFact(
    declaredMajor(files["pgbackrest/Dockerfile"]) === major,
    "sidecar declared major mismatch",
  );
  const paths = [
    ...String(files["pgbackrest/pgbackrest.conf"]).matchAll(
      /^pg1-path\s*=\s*(\S+)\s*$/gm,
    ),
  ];
  requireFact(paths.length === 1, "unknown backup data path");
  const pgdata = server.environment?.PGDATA || paths[0][1];
  const expectedPaths = {
    data_directory: pgdata,
    hba_file: `${pgdata}/pg_hba.conf`,
    ident_file: `${pgdata}/pg_ident.conf`,
    unix_socket_directories: "/var/run/postgresql",
  };
  for (const [key, value] of Object.entries(expectedPaths)) {
    const lines = files["postgres/postgresql.conf"]
      .split(/\r?\n/)
      .filter((line) => new RegExp(`^\\s*${key}\\s*(?:=|\\s)`, "i").test(line));
    requireFact(
      (key === "data_directory" && lines.length === 0) ||
        (lines.length === 1 &&
          lines[0].match(/^[^=]+=\s*'([^']*)'\s*(?:#.*)?$/)?.[1] === value),
      `unknown effective ${key}`,
    );
  }
  requireFact(
    String(files["pgbackrest/pgbackrest.conf"])
      .match(/^\[(?!global(?:[:\]])).*\]$/gm)
      ?.join() === "[ds]",
    "unknown backup stanza contract",
  );
  const socketFor = (service) =>
    (service.volumes || []).filter(
      (v) => typeof v === "string" && v.split(":")[1] === "/var/run/postgresql",
    );
  const serverSockets = socketFor(server);
  const backupSockets = socketFor(backup);
  requireFact(
    serverSockets.length === 1 &&
      backupSockets.length === 1 &&
      serverSockets[0] === backupSockets[0],
    "server/sidecar socket mount mismatch",
  );
  requireFact(
    pgdata === paths[0][1] && /^\/[\w/.-]+$/.test(pgdata),
    "PGDATA/backup path mismatch",
  );
  const mountFor = (service) => {
    const mounts = (service.volumes || [])
      .filter((v) => typeof v === "string")
      .map((v) => v.split(":"))
      .filter(([, path]) => path === pgdata || pgdata.startsWith(path + "/"));
    requireFact(mounts.length === 1, "missing or ambiguous data mount");
    const [key, target, mode] = mounts[0];
    requireFact(
      Object.hasOwn(c.volumes || {}, key),
      "data must use a declared named volume",
    );
    const definition = c.volumes[key];
    requireFact(
      !definition?.external,
      "external data-volume contract is unsupported",
    );
    return {
      name: definition?.name || `${c.name}_${key}`,
      target,
      rw: mode !== "ro",
    };
  };
  // Ordinary activation supports only this fully inspected mount topology.
  // Reject unknown Compose forms instead of silently filtering overlays out.
  const mounts = {};
  for (const [role, service] of [
    ["postgres", server],
    ["pgbackrest", backup],
  ]) {
    const allowed = [
      `pgdata:${pgdata}${role === "pgbackrest" ? ":ro" : ""}`,
      "pgsocket:/var/run/postgresql",
      "pgbackrest_log:/var/log/pgbackrest",
      "./pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro",
      ...(role === "postgres"
        ? [
            "./postgres/init.sql:/docker-entrypoint-initdb.d/10-init.sql:ro",
            "./postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro",
          ]
        : []),
    ];
    requireFact(
      !service.extends &&
        !service.tmpfs &&
        !service.volumes_from &&
        !service.configs &&
        !service.secrets &&
        Array.isArray(service.volumes) &&
        service.volumes.length === allowed.length &&
        allowed.every(
          (v) => service.volumes.filter((actual) => actual === v).length === 1,
        ),
      `${role} unsupported mount topology`,
    );
    mounts[role] = allowed.map((v) => {
      const [source, target, mode] = v.split(":");
      const bind = source.startsWith("./");
      const definition = c.volumes?.[source];
      requireFact(
        bind ||
          (Object.hasOwn(c.volumes || {}, source) &&
            (!definition ||
              Object.keys(definition).every((k) => k === "name"))),
        "unsupported named mount definition",
      );
      return {
        type: bind ? "bind" : "volume",
        source: bind
          ? source.slice(2)
          : definition?.name || `${c.name}_${source}`,
        target,
        rw: mode !== "ro",
      };
    });
  }
  const mount = mountFor(server);
  const sidecarMount = mountFor(backup);
  requireFact(
    mount.rw &&
      !sidecarMount.rw &&
      mount.name === sidecarMount.name &&
      mount.target === sidecarMount.target,
    "sidecar must share the data volume read-only",
  );
  for (const [name, service] of [
    ["postgres", server],
    ["pgbackrest", backup],
  ]) {
    requireFact(
      JSON.stringify(service.env_file) ===
        JSON.stringify(["/etc/ds-platform/data.env"]),
      "unknown PostgreSQL env-file contract",
    );
    requireFact(
      service.build?.context === `./${name}` &&
        (service.build.dockerfile || "Dockerfile") === "Dockerfile" &&
        Object.keys(service.build).every((k) =>
          ["context", "dockerfile"].includes(k),
        ),
      "unsupported build contract",
    );
    requireFact(
      !service.entrypoint && !service.profiles && !service.pull_policy,
      "unsupported PostgreSQL service override",
    );
    requireFact(
      /^[a-z0-9][a-z0-9./:_-]+$/.test(service.image),
      "unknown image reference",
    );
  }
  requireFact(
    JSON.stringify(server.command) ===
      JSON.stringify([
        "postgres",
        "-c",
        "config_file=/etc/postgresql/postgresql.conf",
      ]),
    "unknown server startup command",
  );
  requireFact(!backup.command, "unknown sidecar startup command");
  return {
    major,
    pgdata,
    mount,
    sidecarMount,
    mounts,
    images: { postgres: server.image, pgbackrest: backup.image },
    environment: {
      postgres: server.environment || {},
      pgbackrest: backup.environment || {},
    },
  };
}

export function readPostgresTarget(sha, cwd = process.cwd()) {
  const git = (args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) fail("cannot read committed target source");
    return r.stdout;
  };
  sha = git(["rev-parse", "--verify", `${sha}^{commit}`]).trim();
  const paths = git(["ls-tree", "-r", "--name-only", sha, "--", DATA_PATH])
    .trim()
    .split(/\r?\n/)
    .map((p) => p.slice(DATA_PATH.length))
    .filter(
      (p) =>
        p === "compose.yml" ||
        p.startsWith("postgres/") ||
        p.startsWith("pgbackrest/"),
    );
  requireFact(
    paths.length > 3 && paths.every((p) => /^[\w./-]+$/.test(p)),
    "invalid target source inventory",
  );
  const files = Object.fromEntries(
    paths.map((p) => [p, git(["show", `${sha}:${DATA_PATH}${p}`])]),
  );
  return {
    sha,
    target: postgresContract(files),
    sourceHash: postgresSourceHash(files),
    files,
  };
}

export function assertPostgresEvidence({
  target,
  sourceHash,
  live,
  certificate,
  expected,
}) {
  requireFact(target && live?.source && live?.sidecar, "missing live evidence");
  for (const [role, actual] of [
    ["postgres", live.source],
    ["pgbackrest", live.sidecar],
  ]) {
    const wanted = target.mounts?.[role];
    requireFact(
      Array.isArray(wanted) &&
        Array.isArray(actual?.mounts) &&
        actual.mounts.length === wanted.length &&
        wanted.every(
          (m) =>
            actual.mounts.filter((a) =>
              Object.keys(m).every((k) => a[k] === m[k]),
            ).length === 1,
        ),
      `${role} effective mount topology mismatch`,
    );
  }
  const s = live.source;
  requireFact(
    s.running && live.sidecar.running,
    "server/sidecar stopped or interrupted",
  );
  requireFact(
    Number.isInteger(s.major) && s.major === target.major,
    "major transition is never an ordinary deployment",
  );
  requireFact(/^\d{15,20}$/.test(s.systemId || ""), "unknown cluster identity");
  if (live.recordedSystemId !== undefined)
    requireFact(
      live.recordedSystemId === s.systemId,
      "persisted cluster identity changed",
    );
  requireFact(
    s.pgdata === target.pgdata && s.pgVersion === String(s.major),
    "missing/wrong PGDATA or uninitialized data directory",
  );
  requireFact(
    live.activationPgdata === s.pgdata && live.activationMajor === s.major,
    "pending env-file overrides PostgreSQL major or data path",
  );
  for (const [actual, wanted] of [
    [s.mount, target.mount],
    [live.sidecar.mount, target.sidecarMount],
  ]) {
    requireFact(
      actual && Object.keys(wanted).every((k) => actual[k] === wanted[k]),
      "data mount identity mismatch",
    );
  }
  requireFact(
    live.sidecar.systemId === s.systemId &&
      live.sidecar.pgVersion === s.pgVersion &&
      live.sidecar.pgdata === s.pgdata,
    "sidecar cluster identity/path mismatch",
  );
  requireFact(
    live.backupSystemId === s.systemId && live.backupPath === s.pgdata,
    "backup identity/path mismatch (possible replacement cluster)",
  );
  const identity = {
    systemId: s.systemId,
    major: s.major,
    pgdata: s.pgdata,
    mount: s.mount,
  };
  if (expected)
    requireFact(
      JSON.stringify(expected) === JSON.stringify(identity),
      "source identity changed since preflight",
    );
  const changed =
    sourceHash !== live.sourceHash ||
    ["postgres", "pgbackrest"].some(
      (k) => live.targetImages?.[k]?.id !== live.images?.[k]?.id,
    );
  if (changed) {
    requireFact(
      certificate?.schema === 1 && certificate.sourceHash === sourceHash,
      "missing/stale artifact certification; run postgres-artifact-prepare.mjs",
    );
    for (const key of ["uid", "gid", "pgbackrestVersion"]) {
      const value = certificate.images?.postgres?.[key];
      requireFact(
        value !== undefined && value === certificate.images?.pgbackrest?.[key],
        "certificate server/sidecar ownership or pgBackRest mismatch",
      );
    }
  }
  for (const role of ["postgres", "pgbackrest"]) {
    const image = live.targetImages?.[role];
    requireFact(
      /^sha256:[a-f0-9]{64}$/.test(image?.id || "") &&
        image.major === s.major &&
        image.pgdata === s.pgdata,
      "unknown/mismatched target image major or PGDATA",
    );
    if (changed) {
      const certified = certificate.images?.[role];
      requireFact(
        certified?.id === image.id &&
          certified.major === image.major &&
          certified.pgdata === image.pgdata &&
          image.sourceHash === sourceHash &&
          Number(certified.version?.match(/^PostgreSQL\s+(\d+)\./)?.[1]) ===
            image.major,
        "artifact certificate does not match inspected target image",
      );
    }
  }
  return identity;
}

export async function guardedPostgresStep(options) {
  const identity = assertPostgresEvidence(options);
  await options.mutate();
  return identity;
}

export function postgresProbeScript({
  target,
  files,
  sourceHash,
  preferRecordedImages = false,
}) {
  const request = Buffer.from(
    JSON.stringify({
      target,
      sourceHash,
      preferRecordedImages,
      paths: Object.keys(files).sort(),
    }),
  ).toString("base64");
  const python = readFileSync(
    new URL("./postgres-artifact-probe.py", import.meta.url),
    "utf8",
  );
  return `python3 - '${request}' <<'DS_POSTGRES_PROBE'\n${python}\nDS_POSTGRES_PROBE\n`;
}

export function certifiedTarget(target, certificate) {
  if (!certificate) return target;
  const images = {};
  for (const role of ["postgres", "pgbackrest"]) {
    const id = certificate.images?.[role]?.id;
    requireFact(
      /^sha256:[a-f0-9]{64}$/.test(id || ""),
      "certificate has no immutable image ID",
    );
    images[role] = id;
  }
  return { ...target, images };
}

export function postgresImageOverride(live) {
  const services = {};
  for (const role of ["postgres", "pgbackrest"]) {
    const image = live.targetImages[role].id;
    requireFact(
      /^sha256:[a-f0-9]{64}$/.test(image),
      "invalid immutable deployment image",
    );
    services[role] = { image };
  }
  return JSON.stringify({ services });
}

export function postgresStateScript(live, sourceHash = live.sourceHash) {
  requireFact(
    /^[a-f0-9]{64}$/.test(sourceHash) &&
      /^\d{15,20}$/.test(live.source.systemId),
    "invalid durable source record",
  );
  const state = JSON.stringify({
    schema: 1,
    sourceHash,
    systemId: live.source.systemId,
    images: Object.fromEntries(
      ["postgres", "pgbackrest"].map((role) => [role, live.images[role].id]),
    ),
  });
  return `umask 077\nprintf '%s\\n' '${state}' > "$HOME/ds-platform-postgres-state.json.next"\nmv "$HOME/ds-platform-postgres-state.json.next" "$HOME/ds-platform-postgres-state.json"\n`;
}
