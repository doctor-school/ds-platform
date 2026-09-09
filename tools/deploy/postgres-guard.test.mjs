import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  postgresContract,
  assertPostgresEvidence,
  guardedPostgresStep,
  readPostgresTarget,
} from "./postgres-guard.mjs";
import { preparePostgresDeployment } from "./prod.mjs";
import {
  artifactBuildPlan,
  certifyImage,
  assertArtifactPair,
} from "./postgres-artifact-prepare.mjs";

const root = new URL("../../infra/deploy/compose/data-prod/", import.meta.url);
const files = Object.fromEntries(
  [
    "compose.yml",
    "postgres/Dockerfile",
    "postgres/postgresql.conf",
    "pgbackrest/Dockerfile",
    "pgbackrest/pgbackrest.conf",
  ].map((p) => [p, readFileSync(new URL(p, root), "utf8")]),
);
function fixture() {
  const target = postgresContract(files);
  const image = {
    id: "sha256:" + "a".repeat(64),
    major: 17,
    pgdata: "/var/lib/postgresql/data",
  };
  const source = {
    major: 17,
    systemId: "7544271560000000001",
    pgdata: image.pgdata,
    pgVersion: "17",
    mount: { name: "ds-data-prod_pgdata", target: image.pgdata, rw: true },
    running: true,
  };
  return {
    target,
    live: {
      source,
      sidecar: {
        ...globalThis.structuredClone(source),
        mount: { ...source.mount, rw: false },
      },
      backupSystemId: source.systemId,
      backupPath: source.pgdata,
      activationPgdata: source.pgdata,
      activationMajor: source.major,
      images: { postgres: image, pgbackrest: { ...image } },
      sourceHash: "b".repeat(64),
      targetImages: { postgres: image, pgbackrest: { ...image } },
    },
    sourceHash: "b".repeat(64),
  };
}

test("EARS-1: accepts the actual same-major production contract", () => {
  const f = fixture();
  assert.equal(assertPostgresEvidence(f).systemId, f.live.source.systemId);
});

test("EARS-8: artifact source is pinned to an immutable commit before building", () => {
  assert.match(readPostgresTarget("HEAD").sha, /^[a-f0-9]{40}$/);
});

test("EARS-9: target backup socket and stanza cannot silently diverge", () => {
  assert.throws(() =>
    postgresContract({
      ...files,
      "compose.yml": files["compose.yml"].replace(
        "pgsocket:/var/run/postgresql # shared",
        "redisdata:/var/run/postgresql # shared",
      ),
    }),
  );
  assert.throws(() =>
    postgresContract({
      ...files,
      "pgbackrest/pgbackrest.conf": files["pgbackrest/pgbackrest.conf"].replace(
        "[ds]",
        "[other]",
      ),
    }),
  );
});

test("EARS-10: effective server path cannot be redirected by target config", () => {
  for (const directive of [
    "data_directory = '/empty/alternate-cluster'",
    "include = 'other.conf'",
    "include_if_exists 'other.conf'",
    "include_dir = 'conf.d'",
    "hba_file = '/other/hba.conf'",
    "ident_file = '/other/ident.conf'",
  ]) {
    assert.throws(() =>
      postgresContract({
        ...files,
        "postgres/postgresql.conf":
          files["postgres/postgresql.conf"] + "\n" + directive,
      }),
    );
  }
});

test("EARS-6: canonical deployment seam rechecks before executing a mutation", async () => {
  const f = fixture();
  let reads = 0;
  const guard = await preparePostgresDeployment("test", {
    readTarget: () => ({ ...f, files }),
    capture: async () => {
      reads++;
      return JSON.stringify(f.live);
    },
  });
  let mutations = 0;
  await guard.run(() => mutations++);
  assert.equal(mutations, 1);
  f.live.backupSystemId = "7544271560000000009";
  await assert.rejects(guard.run(() => mutations++));
  assert.equal(mutations, 1);
  assert.equal(reads, 3);
});

test("EARS-7: preparation certifies real inspected binary, provenance and UID", () => {
  const f = fixture();
  const plan = artifactBuildPlan(f)[0];
  const inspected = {
    Id: f.live.images.postgres.id,
    Config: {
      Env: ["PG_MAJOR=17", "PGDATA=/var/lib/postgresql/data"],
      Labels: { "org.doctor-school.postgres-source": f.sourceHash },
    },
  };
  const data = {
    inspected,
    versionOutput: "postgres (PostgreSQL) 17.11 (Debian)",
    uidOutput: "999\n",
    gidOutput: "999\n",
    pgbackrestVersionOutput: "pgBackRest 2.55.1",
    plan,
    sourceHash: f.sourceHash,
  };
  assert.equal(certifyImage(data).major, 17);
  const image = certifyImage(data);
  assertArtifactPair({ postgres: image, pgbackrest: image });
  assert.throws(() =>
    assertArtifactPair({
      postgres: image,
      pgbackrest: { ...image, pgbackrestVersion: "pgBackRest 2.54.2" },
    }),
  );
  assert.throws(() =>
    assertArtifactPair({
      postgres: image,
      pgbackrest: { ...image, gid: 1000 },
    }),
  );
  assert.throws(() =>
    certifyImage({ ...data, versionOutput: "postgres (PostgreSQL) 18.1" }),
  );
  assert.throws(() => certifyImage({ ...data, sourceHash: "e".repeat(64) }));
  assert.throws(() => artifactBuildPlan({ ...f, sourceHash: "bad;command" }));
  assert.equal(plan.context, "infra/deploy/compose/data-prod/postgres");
});

for (const [name, change] of [
  [
    "PG18 image over PG17",
    (f) => {
      f.live.targetImages.postgres.major = 18;
    },
  ],
  [
    "missing PGDATA",
    (f) => {
      f.live.source.pgdata = "";
    },
  ],
  [
    "uninitialized data",
    (f) => {
      f.live.source.pgVersion = "";
    },
  ],
  [
    "wrong mount",
    (f) => {
      f.live.source.mount.name = "empty-new-volume";
    },
  ],
  [
    "sidecar mismatch",
    (f) => {
      f.live.sidecar.systemId = "7544271560000000002";
    },
  ],
  [
    "backup path mismatch",
    (f) => {
      f.live.backupPath = "/other";
    },
  ],
  [
    "replacement empty cluster",
    (f) => {
      f.live.backupSystemId = "7544271560000000002";
    },
  ],
  [
    "interrupted stopped cluster",
    (f) => {
      f.live.source.running = false;
    },
  ],
  [
    "unknown image",
    (f) => {
      delete f.live.targetImages.postgres;
    },
  ],
  [
    "uncertified changed source",
    (f) => {
      f.sourceHash = "c".repeat(64);
    },
  ],
  [
    "persisted identity changed",
    (f) => {
      f.live.recordedSystemId = "7544271560000000009";
    },
  ],
  [
    "pending env-file PGDATA replacement",
    (f) => {
      f.live.activationPgdata = "/empty";
    },
  ],
]) {
  test(`EARS-2: ${name} refuses before mutation`, async () => {
    const f = fixture();
    change(f);
    let mutated = false;
    await assert.rejects(
      guardedPostgresStep({
        ...f,
        mutate: () => {
          mutated = true;
        },
      }),
    );
    assert.equal(mutated, false);
  });
}

test("EARS-3: identity drift refuses re-entry without another mutation", async () => {
  const f = fixture();
  const expected = assertPostgresEvidence(f);
  f.live.source.systemId = "7544271560000000003";
  f.live.sidecar.systemId = f.live.source.systemId;
  f.live.backupSystemId = f.live.source.systemId;
  await assert.rejects(
    guardedPostgresStep({
      ...f,
      expected,
      mutate: () => assert.fail("mutation after drift"),
    }),
  );
});

test("EARS-4: repeated valid same-major steps preserve source identity", async () => {
  const f = fixture();
  let calls = 0;
  const expected = assertPostgresEvidence(f);
  await guardedPostgresStep({ ...f, expected, mutate: () => calls++ });
  await guardedPostgresStep({ ...f, expected, mutate: () => calls++ });
  assert.equal(calls, 2);
});

test("EARS-5: accepts generated same-major artifacts bound to exact source and image", () => {
  const f = fixture();
  f.sourceHash = "c".repeat(64);
  f.certificate = { schema: 1, sourceHash: f.sourceHash, images: {} };
  for (const role of ["postgres", "pgbackrest"]) {
    f.live.targetImages[role] = {
      ...f.live.images[role],
      id: "sha256:" + "d".repeat(64),
      sourceHash: f.sourceHash,
    };
    f.certificate.images[role] = {
      ...f.live.targetImages[role],
      version: "PostgreSQL 17.11",
      uid: 999,
      gid: 999,
      pgbackrestVersion: "pgBackRest 2.55.1",
    };
  }
  assertPostgresEvidence(f);
  for (const mutate of [
    (x) => {
      x.certificate.sourceHash = "e".repeat(64);
    },
    (x) => {
      x.certificate.images.postgres.id = "sha256:" + "e".repeat(64);
    },
    (x) => {
      x.live.targetImages.pgbackrest.sourceHash = "e".repeat(64);
    },
    (x) => {
      x.certificate.images.postgres.version = "PostgreSQL 18.1";
    },
    (x) => {
      x.certificate.images.postgres.gid = 1000;
    },
  ]) {
    const invalid = globalThis.structuredClone(f);
    mutate(invalid);
    assert.throws(() => assertPostgresEvidence(invalid));
  }
});
