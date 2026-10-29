// tools/deploy/postgres-hash-migration.test.mjs — Issue #3419.
//
// The PostgreSQL source hash v2 covers only the image/cluster inputs of the data-prod
// compose (runtime-only service keys removed), so a log bound no longer moves it. A box
// that still holds a v1 record is migrated through POSTGRES_HASH_MIGRATIONS without a
// certificate only when the record is a table entry whose certified tree has the
// target's v2; every other v1 record keeps the certificate requirement.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  POSTGRES_HASH_MIGRATIONS,
  assertPostgresEvidence,
  postgresContract,
  postgresSourceHash,
  postgresSourceHashV1,
  postgresStateRecord,
  readPostgresTarget,
} from "./postgres-guard.mjs";
import { checkpointJournalLines, preparePostgresDeployment } from "./prod.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const PROBE = join(import.meta.dirname, "postgres-artifact-probe.py");
// Committed bytes, as in postgres-source-pin.test.mjs (an autocrlf checkout differs).
const head = readPostgresTarget("HEAD", REPO_ROOT);
const [entry] = POSTGRES_HASH_MIGRATIONS;

const editCompose = (files, edit) => {
  const compose = JSON.parse(files["compose.yml"]);
  edit(compose);
  return { ...files, "compose.yml": JSON.stringify(compose, null, 2) + "\n" };
};

/** The live evidence of an unchanged box, recording `record` (hashVersion absent = v1). */
function evidence(target, record) {
  const image = {
    id: "sha256:" + "a".repeat(64),
    major: 17,
    pgdata: target.pgdata,
  };
  const source = {
    major: 17,
    systemId: "7544271560000000001",
    pgdata: target.pgdata,
    pgVersion: "17",
    mount: target.mount,
    running: true,
    mounts: globalThis.structuredClone(target.mounts.postgres),
  };
  return {
    source,
    sidecar: {
      ...globalThis.structuredClone(source),
      mount: target.sidecarMount,
      mounts: globalThis.structuredClone(target.mounts.pgbackrest),
    },
    backupSystemId: source.systemId,
    backupPath: source.pgdata,
    activationPgdata: source.pgdata,
    activationMajor: source.major,
    images: { postgres: image, pgbackrest: { ...image } },
    targetImages: { postgres: { ...image }, pgbackrest: { ...image } },
    ...record,
  };
}

test("3419: each migration entry is the certified tree of its commit (v1 and v2 recomputed from git)", () => {
  assert.ok(POSTGRES_HASH_MIGRATIONS.length > 0);
  for (const { commit, v1, v2 } of POSTGRES_HASH_MIGRATIONS) {
    const tree = readPostgresTarget(commit, REPO_ROOT);
    assert.equal(postgresSourceHashV1(tree.files), v1, `v1 of ${commit}`);
    assert.equal(tree.sourceHash, v2, `v2 of ${commit}`);
  }
  // The live release (release-2026.10.27-2) runs 09c152b26: its box record is this v1.
  assert.equal(entry.commit, "09c152b26ae7d67f9715ee5e7cbebc1015430c08");
  assert.equal(
    entry.v1,
    "e8656c8b6259847701dfae069a011ab878329bfc5b8adaa7724cd477318c0da4",
  );
});

test("3419: v2 ignores the runtime-only service keys and nothing else", () => {
  const base = postgresSourceHash(head.files);
  for (const key of ["logging", "restart", "depends_on", "ports"]) {
    for (const service of ["postgres", "redis", "pgbackrest"]) {
      const moved = editCompose(head.files, (c) => {
        c.services[service][key] = { changed: true };
      });
      assert.equal(postgresSourceHash(moved), base, `${service}.${key}`);
    }
  }
  // healthcheck: only its timing is runtime; its command runs inside the container
  // with the data volume mounted, so `test` stays an input.
  for (const key of [
    "interval",
    "timeout",
    "retries",
    "start_period",
    "start_interval",
  ]) {
    for (const service of ["postgres", "redis"]) {
      const moved = editCompose(head.files, (c) => {
        c.services[service].healthcheck[key] = key === "retries" ? 99 : "99s";
      });
      assert.equal(
        postgresSourceHash(moved),
        base,
        `${service}.healthcheck.${key}`,
      );
    }
  }
  for (const service of ["postgres", "redis"]) {
    assert.notEqual(
      postgresSourceHash(
        editCompose(head.files, (c) => {
          c.services[service].healthcheck.test = ["CMD", "true"];
        }),
      ),
      base,
      `${service}.healthcheck.test`,
    );
  }
  for (const edit of [
    (c) => (c.services.postgres.image = "ds-postgres:other"),
    (c) => (c.services.postgres.environment.POSTGRES_DB = "other"),
    (c) => c.services.pgbackrest.volumes.reverse(),
    (c) => (c.services.redis.command = ["redis-server"]),
    (c) => (c.services.postgres.unknown_key = 1),
    (c) => (c.volumes.pgdata = { name: "other" }),
    (c) => (c.name = "other"),
  ]) {
    assert.notEqual(
      postgresSourceHash(editCompose(head.files, edit)),
      base,
      String(edit),
    );
  }
  for (const path of [
    "postgres/Dockerfile",
    "postgres/postgresql.conf",
    "pgbackrest/pgbackrest.conf",
  ]) {
    assert.notEqual(
      postgresSourceHash({ ...head.files, [path]: head.files[path] + "\n" }),
      base,
      path,
    );
  }
  // Key order and whitespace of the compose JSON are not inputs.
  assert.equal(
    postgresSourceHash({
      ...head.files,
      "compose.yml": JSON.stringify(JSON.parse(head.files["compose.yml"])),
    }),
    base,
  );
  assert.throws(
    () =>
      postgresSourceHash(
        editCompose(head.files, (c) => (c.services.redis.x = 1.5)),
      ),
    /non-integer number/,
  );
});

test("3419: the committed tree (logging re-landed) has the live tree's v2", () => {
  assert.equal(head.sourceHash, entry.v2);
  assert.notEqual(
    postgresSourceHashV1(head.files),
    entry.v1,
    "the bound moved v1, as in #3418",
  );
});

test("3419: a live v1 record of the migration table + the logging tree → unchanged, no certificate", () => {
  const live = evidence(head.target, { sourceHash: entry.v1 });
  assert.equal(
    assertPostgresEvidence({ ...head, live }).systemId,
    live.source.systemId,
  );
});

test("3419: a v1 record not in the table (tampered previous tree) → certificate required", () => {
  const live = evidence(head.target, { sourceHash: "f".repeat(64) });
  assert.throws(
    () => assertPostgresEvidence({ ...head, live }),
    /missing\/stale artifact certification/,
  );
  // A v1 record never counts as a v2 one, even with the target's own hash.
  const spoofed = evidence(head.target, { sourceHash: head.sourceHash });
  assert.throws(
    () => assertPostgresEvidence({ ...head, live: spoofed }),
    /certification/,
  );
});

test("3419: a table v1 record + an image/cluster change → certificate required", () => {
  const files = {
    ...head.files,
    "postgres/Dockerfile": head.files["postgres/Dockerfile"] + "RUN true\n",
  };
  const changed = {
    target: postgresContract(files),
    sourceHash: postgresSourceHash(files),
  };
  const live = evidence(changed.target, { sourceHash: entry.v1 });
  assert.throws(
    () => assertPostgresEvidence({ ...changed, live }),
    /certification/,
  );
  const moved = evidence(head.target, { sourceHash: entry.v1 });
  moved.targetImages.postgres.id = "sha256:" + "b".repeat(64);
  assert.throws(
    () => assertPostgresEvidence({ ...head, live: moved }),
    /certification/,
  );
});

test("3419: a v2 record + a logging-only change → unchanged", () => {
  const files = editCompose(head.files, (c) => {
    c.services.postgres.logging.options["max-size"] = "20m";
  });
  const target = {
    target: postgresContract(files),
    sourceHash: postgresSourceHash(files),
  };
  const live = evidence(target.target, {
    sourceHash: head.sourceHash,
    hashVersion: 2,
  });
  assertPostgresEvidence({ ...target, live });
});

for (const path of ["postgres/Dockerfile", "postgres/postgresql.conf"]) {
  test(`3419: a v2 record + a ${path} change → certificate required, and a v2 certificate passes`, () => {
    const files = { ...head.files, [path]: head.files[path] + "\n# changed\n" };
    const plan = {
      target: postgresContract(files),
      sourceHash: postgresSourceHash(files),
    };
    const live = evidence(plan.target, {
      sourceHash: head.sourceHash,
      hashVersion: 2,
    });
    assert.throws(
      () => assertPostgresEvidence({ ...plan, live }),
      /certification/,
    );
    const certificate = { schema: 1, sourceHash: plan.sourceHash, images: {} };
    for (const role of ["postgres", "pgbackrest"]) {
      live.targetImages[role] = {
        ...live.images[role],
        id: "sha256:" + "d".repeat(64),
        sourceHash: plan.sourceHash,
      };
      certificate.images[role] = {
        ...live.targetImages[role],
        version: "PostgreSQL 17.11",
        uid: 999,
        gid: 999,
        pgbackrestVersion: "pgBackRest 2.55.1",
      };
    }
    assertPostgresEvidence({ ...plan, live, certificate });
    // The label check holds under v2: an image labelled with the v1 hash is refused.
    live.targetImages.postgres.sourceHash = postgresSourceHashV1(files);
    assert.throws(
      () => assertPostgresEvidence({ ...plan, live, certificate }),
      /does not match/,
    );
  });
}

test("3419: the checkpoint record keeps a v1 record v1 (the live verb's shape) and writes v2 when told", () => {
  const v1 = evidence(head.target, { sourceHash: entry.v1 });
  const before = JSON.parse(postgresStateRecord(v1));
  assert.deepEqual(Object.keys(before).sort(), [
    "images",
    "schema",
    "sourceHash",
    "systemId",
  ]);
  assert.equal(before.sourceHash, entry.v1);
  const after = JSON.parse(postgresStateRecord(v1, head.sourceHash));
  assert.equal(after.hashVersion, 2);
  assert.equal(after.sourceHash, head.sourceHash);
  const v2 = evidence(head.target, {
    sourceHash: head.sourceHash,
    hashVersion: 2,
  });
  assert.deepEqual(JSON.parse(postgresStateRecord(v2)), after);
});

// #3419: the box prefers its recorded images only for a request hash equal to its
// record; any other request makes it inspect the mutable compose tags, which can be gone.
const TAG_FAILURE =
  "PostgreSQL evidence unavailable: PostgreSQL evidence command failed: sudo";
const box = (record, { tags = true } = {}) => {
  const requests = [];
  return {
    requests,
    call: async (words, { input }) => {
      assert.deepEqual(words, ["postgres-probe"]);
      const request = JSON.parse(input);
      requests.push(request);
      const live = evidence(head.target, record);
      if (request.sourceHash !== record.sourceHash) {
        if (!tags) throw new Error(TAG_FAILURE);
        live.targetImages.postgres.id = "sha256:" + "c".repeat(64);
      }
      return JSON.stringify(live);
    },
  };
};
const prepare = (client, extra = {}) =>
  preparePostgresDeployment("HEAD", {
    client,
    readTarget: () => head,
    ...extra,
  });
const asked = (client) => client.requests.map((r) => r.sourceHash);

test("3419: a v1 box is asked first with the table's v1, so it never reads the compose tags", async () => {
  const client = box({ sourceHash: entry.v1 }, { tags: false });
  await prepare(client);
  assert.deepEqual(asked(client), [entry.v1]);
  // Only the fields the live (09c152b) entrypoint accepts are sent.
  assert.deepEqual(Object.keys(client.requests[0]).sort(), [
    "paths",
    "preferRecordedImages",
    "sourceHash",
    "target",
  ]);
});

test("3419: a v2 box is re-read with the target v2 (tags present or gone)", async () => {
  for (const tags of [true, false]) {
    const client = box(
      { sourceHash: head.sourceHash, hashVersion: 2 },
      { tags },
    );
    await prepare(client);
    assert.deepEqual(
      asked(client),
      [entry.v1, head.sourceHash],
      `tags ${tags}`,
    );
  }
});

// #3466: no prod ssh — the release journal is the only place the box's record is read.
const journal = async (t, client) => {
  const log = t.mock.method(console, "log", () => {});
  await prepare(client);
  return log.mock.calls
    .map((c) => c.arguments.join(" "))
    .filter((l) => l.includes("postgres record"));
};

test("3466: preparation prints a v1 box's record once, naming the hash it was asked with", async (t) => {
  assert.deepEqual(await journal(t, box({ sourceHash: entry.v1 })), [
    "  ↳ ds-data-prod: postgres record v1 (no hashVersion), asked with the table's v1 record",
  ]);
});

test("3466: preparation prints a v2 box's record hashVersion once", async (t) => {
  assert.deepEqual(
    await journal(t, box({ sourceHash: head.sourceHash, hashVersion: 2 })),
    [
      "  ↳ ds-data-prod: postgres record hashVersion 2, asked with the target v2",
    ],
  );
});

test("3466: the post-up checkpoint echoes the box's record line and its log bounds only", () => {
  for (const [record, expected] of [
    ["record: hashVersion 2", "  ↳ ds-data-prod: record: hashVersion 2"],
    [
      "record: v1 (no hashVersion)",
      "  ↳ ds-data-prod: record: v1 (no hashVersion)",
    ],
  ]) {
    assert.deepEqual(
      checkpointJournalLines(`PostgreSQL checkpoint written
${record}
log bound: /pg log=json-file
`),
      [expected, "  ↳ ds-data-prod: log bound: /pg log=json-file"],
    );
  }
  assert.deepEqual(checkpointJournalLines(undefined), []);
});

test("3419: a v1 record not in the table is still refused, read once", async () => {
  const client = box({ sourceHash: "f".repeat(64) });
  await assert.rejects(prepare(client), /certification/);
  assert.deepEqual(asked(client), [entry.v1]);
});

test("3419: a failed probe names every hash it was asked with", async () => {
  const client = box({ sourceHash: "f".repeat(64) }, { tags: false });
  await assert.rejects(prepare(client), (error) => {
    for (const hash of [entry.v1, head.sourceHash])
      assert.match(error.message, new RegExp(hash.slice(0, 12)));
    assert.match(error.message, /command failed: sudo/);
    return true;
  });
  assert.deepEqual(asked(client), [entry.v1, head.sourceHash]);
});

test("3419: a certificate run never prefers the recorded images, so it reads once with the target v2", async () => {
  const client = box({ sourceHash: entry.v1 });
  const id = { id: "sha256:" + "d".repeat(64) };
  await prepare(client, {
    certificate: {
      schema: 1,
      sourceHash: head.sourceHash,
      images: { postgres: id, pgbackrest: id },
    },
  }).catch(() => {}); // the stub's images are not the certified ones; only the reads count
  assert.deepEqual(asked(client), [head.sourceHash]);
});

const python = ["python3", "python"].find(
  (bin) =>
    spawnSync(bin, ["-c", "import sys; assert sys.version_info >= (3, 8)"])
      .status === 0,
);

test(
  "3419: the box probe computes v2 as Node does (no-state-file case)",
  { skip: !python && "needs python3" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "ds-pg-hash-"));
    try {
      const variants = [
        head.files,
        editCompose(head.files, (c) => {
          c.services.postgres.environment.NOTE =
            'é "quoted" \\ tab\t line\n \u0001 ✓';
          c.services.postgres.healthcheck.retries = 9;
          c.services.redis.healthcheck.test = ["CMD", "true"];
        }),
      ];
      for (const files of variants) {
        for (const [path, body] of Object.entries(files)) {
          mkdirSync(dirname(join(dir, path)), { recursive: true });
          writeFileSync(join(dir, path), body);
        }
        const paths = Object.keys(files).sort();
        const r = spawnSync(
          python,
          [
            "-I",
            "-B",
            "-c",
            "import importlib.util, json, pathlib, sys\n" +
              "spec = importlib.util.spec_from_file_location('probe', sys.argv[1])\n" +
              "probe = importlib.util.module_from_spec(spec); spec.loader.exec_module(probe)\n" +
              "print(probe.source_hash_v2(pathlib.Path(sys.argv[2]), json.loads(sys.argv[3])))",
            PROBE,
            dir,
            JSON.stringify(paths),
          ],
          { encoding: "utf8" },
        );
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout.trim(), postgresSourceHash(files));
      }
      assert.equal(
        readFileSync(join(dir, "compose.yml"), "utf8"),
        variants[1]["compose.yml"],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
