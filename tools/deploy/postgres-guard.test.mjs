import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  postgresContract,
  assertPostgresEvidence,
  guardedPostgresStep,
  postgresGuardRefusal,
  readPostgresTarget,
} from "./postgres-guard.mjs";
import {
  UNEXPECTED_FAILURE_REASON,
  preparePostgresDeployment,
  releaseFailureNote,
  uncaughtFailure,
} from "./prod.mjs";
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
      source: {
        ...source,
        mounts: globalThis.structuredClone(target.mounts.postgres),
      },
      sidecar: {
        ...globalThis.structuredClone(source),
        mounts: globalThis.structuredClone(target.mounts.pgbackrest),
        mount: { ...source.mount, rw: false },
      },
      backupSystemId: source.systemId,
      backupPath: source.pgdata,
      activationPgdata: source.pgdata,
      activationMajor: source.major,
      images: { postgres: image, pgbackrest: { ...image } },
      hashVersion: 2,
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
        '"pgsocket:/var/run/postgresql"',
        '"redisdata:/var/run/postgresql"',
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
    client: {
      call: async (words) => {
        assert.deepEqual(words, ["postgres-probe"]);
        reads++;
        return JSON.stringify(f.live);
      },
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

test("3447: the deployment seam returns the mutation's output — the checkpoint's log bound lines reach the driver", async () => {
  const f = fixture();
  const guard = await preparePostgresDeployment("test", {
    readTarget: () => ({ ...f, files }),
    client: { call: async () => JSON.stringify(f.live) },
  });
  const checkpoint =
    "log bound: ds-data-prod-postgres-1 log=json-file max-size=10m max-file=3\n";
  assert.equal(await guard.run(async () => checkpoint), checkpoint);
  const expected = assertPostgresEvidence(f);
  assert.equal(
    await guardedPostgresStep({ ...f, expected, mutate: () => checkpoint }),
    checkpoint,
  );
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

for (const role of ["postgres", "pgbackrest"]) {
  for (const kind of [
    "alternate config",
    "nested data",
    "long mount",
    "tmpfs overlay",
    "inherited mounts",
  ]) {
    test(`EARS-11: ${role} ${kind} topology refuses before activation`, () => {
      const compose = JSON.parse(files["compose.yml"]);
      const service = compose.services[role];
      if (kind === "alternate config")
        service.volumes = service.volumes.map((v) =>
          v.replace(
            "./pgbackrest/pgbackrest.conf:",
            "./pgbackrest/alternate.conf:",
          ),
        );
      if (kind === "nested data")
        service.volumes.push("redisdata:/var/lib/postgresql/data/base");
      if (kind === "long mount")
        service.volumes.push({
          type: "volume",
          source: "redisdata",
          target: "/var/lib/postgresql/data/base",
        });
      if (kind === "tmpfs overlay")
        service.tmpfs = ["/var/lib/postgresql/data/base"];
      if (kind === "inherited mounts") service.volumes_from = ["other"];
      assert.throws(
        () =>
          postgresContract({
            ...files,
            "compose.yml": JSON.stringify(compose),
          }),
        /mount/,
      );
    });
  }
}
test("EARS-12: alternate server configuration bind refuses", () => {
  assert.throws(
    () =>
      postgresContract({
        ...files,
        "compose.yml": files["compose.yml"].replace(
          "./postgres/postgresql.conf:",
          "./postgres/alternate.conf:",
        ),
      }),
    /mount/,
  );
});
for (const role of ["source", "sidecar"]) {
  test(`EARS-13: ${role} effective nested mount refuses before mutation`, async () => {
    const f = fixture();
    f.live[role].mounts = [
      ...(f.live[role].mounts || []),
      {
        type: "volume",
        source: "redisdata",
        target: f.target.pgdata + "/base",
        rw: true,
      },
    ];
    await assert.rejects(
      guardedPostgresStep({
        ...f,
        mutate: () => assert.fail("unsafe mutation"),
      }),
      /mount/,
    );
  });
}

for (const role of ["source", "sidecar"]) {
  for (const kind of ["config source", "missing mount", "writable config"]) {
    test(`EARS-13: ${role} effective ${kind} refuses before mutation`, async () => {
      const f = fixture();
      const mounts = f.live[role].mounts;
      const config = mounts.find(
        (m) => m.target === "/etc/pgbackrest/pgbackrest.conf",
      );
      if (kind === "config source") config.source = "pgbackrest/alternate.conf";
      if (kind === "missing mount") mounts.pop();
      if (kind === "writable config") config.rw = true;
      await assert.rejects(
        guardedPostgresStep({
          ...f,
          mutate: () => assert.fail("unsafe mutation"),
        }),
        /mount/,
      );
    });
  }
}

test("3157: a compose contract that is not JSON refuses — the bare-tree release has no YAML parser", () => {
  assert.throws(
    () => postgresContract({ ...files, "compose.yml": "name: ds-data-prod\n" }),
    /compose contract is not JSON/,
  );
});

// #4067: what the catch-all of prod.mjs leaves as the release's public failure note.
const noteOf = (error) => {
  const { message, authored } = uncaughtFailure(error);
  return releaseFailureNote("postgres-verify", message, { authored });
};

test("4067: a guard refusal reaches the failure note as its authored text", async () => {
  const f = fixture();
  f.live.backupSystemId = "7544271560000000009";
  const error = await preparePostgresDeployment("test", {
    readTarget: () => ({ ...f, files }),
    client: { call: async () => JSON.stringify(f.live) },
  }).catch((e) => e);
  assert.match(
    error.message,
    /^PostgreSQL guard: .+; ordinary deployment refused \(migration: #2101\)$/,
  );
  assert.equal(postgresGuardRefusal(error), error.message);
  assert.deepEqual(noteOf(error), {
    phase: "postgres-verify",
    reason:
      error.message.length > 160
        ? `${error.message.slice(0, 159)}…`
        : error.message,
  });
  assert.notEqual(noteOf(error).reason, UNEXPECTED_FAILURE_REASON);
});

test("4067: a probe failure, a forged or wrapped guard text and any other error stay unexpected", async () => {
  const f = fixture();
  const probeError = await preparePostgresDeployment("test", {
    readTarget: () => ({ ...f, files }),
    client: {
      call: async () => {
        throw new Error(
          "PostgreSQL evidence unavailable: PostgreSQL evidence command failed: sudo PASSWORD=x",
        );
      },
    },
  }).catch((e) => e);
  assert.match(probeError.message, /PostgreSQL evidence unavailable/);
  f.live.backupSystemId = "7544271560000000009";
  const refusal = await preparePostgresDeployment("test", {
    readTarget: () => ({ ...f, files }),
    client: { call: async () => JSON.stringify(f.live) },
  }).catch((e) => e);
  const edited = await preparePostgresDeployment("test", {
    readTarget: () => ({ ...f, files }),
    client: { call: async () => JSON.stringify(f.live) },
  }).catch((e) => e);
  edited.message += " postgres://u:p@h/db";
  for (const error of [
    probeError,
    // the same text, not raised by the guard
    new Error(refusal.message),
    // a refusal wrapped with foreign text
    new Error(`checkpoint failed: ${refusal.message} PASSWORD=x`, {
      cause: refusal,
    }),
    // a refusal whose text changed after it was raised
    edited,
    new TypeError("fetch failed"),
    "a thrown string",
  ]) {
    assert.equal(postgresGuardRefusal(error), null);
    assert.deepEqual(noteOf(error), {
      phase: "postgres-verify",
      reason: UNEXPECTED_FAILURE_REASON,
    });
  }
});

test("4067: every guard refusal message is authored in the guard's source", () => {
  const file = "postgres-guard.mjs";
  const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  // a fixed string, or a template interpolating only the literal `key` / `role` of its loop
  const authored = (node) =>
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    (ts.isTemplateExpression(node) &&
      node.templateSpans.every(
        (span) =>
          ts.isIdentifier(span.expression) &&
          ["key", "role"].includes(span.expression.text),
      ));
  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["fail", "requireFact"].includes(node.expression.text)
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  // the one interpolating call site is `fail`'s own forward inside `requireFact`
  const refusals = calls.filter(
    (c) =>
      !(
        c.expression.text === "fail" && c.arguments[0]?.getText() === "message"
      ),
  );
  assert.ok(refusals.length >= 45, `found ${refusals.length} guard refusals`);
  for (const call of refusals) {
    const message = call.arguments.at(-1);
    assert.ok(
      message && authored(message),
      `${call.getText().slice(0, 80)}… refuses with a message that is not a fixed authored string`,
    );
  }
});
