// #4089: the Actions path of a changed data-prod image input — the archive identity the
// release loads into ds-data-prod, and which certification run a release may deliver.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  POSTGRES_ARTIFACT_WORKFLOW,
  assertArchiveMatchesCertificate,
  imageArchiveConfigIds,
  postgresArtifactName,
  postgresInputChanged,
  readTarMember,
  selectPostgresArtifact,
} from "./postgres-artifact-release.mjs";

const HASH = "a".repeat(64);
const PG = `sha256:${"1".repeat(64)}`;
const BR = `sha256:${"2".repeat(64)}`;
const REPO = "doctor-school/ds-platform";

/** A ustar archive of `entries` ([name, string | Buffer]), as `docker image save` writes one. */
function tar(entries) {
  const blocks = [];
  for (const [name, body] of entries) {
    const data = Buffer.from(body);
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(
      `${data.length.toString(8).padStart(11, "0")}\0`,
      124,
      12,
      "ascii",
    );
    header.write("00000000000\0", 136, 12, "ascii");
    header.write("        ", 148, 8, "ascii");
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let sum = 0;
    for (const b of header) sum += b;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(
      header,
      data,
      Buffer.alloc((512 - (data.length % 512)) % 512, 0),
    );
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

const withArchive = (entries, fn) => {
  const dir = mkdtempSync(join(tmpdir(), "pg-artifact-"));
  try {
    const path = join(dir, "images.tar");
    writeFileSync(path, tar(entries));
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const certificate = {
  schema: 1,
  sourceHash: HASH,
  images: { postgres: { id: PG }, pgbackrest: { id: BR } },
};

test("4089: the archive's image ids are the config digests of its manifest.json, either layout", () => {
  const manifest = JSON.stringify([
    { Config: `blobs/sha256/${"1".repeat(64)}`, RepoTags: null, Layers: [] },
    { Config: `${"2".repeat(64)}.json`, RepoTags: null, Layers: [] },
  ]);
  withArchive(
    [
      [`blobs/sha256/${"9".repeat(64)}`, Buffer.alloc(1300, 7)],
      ["manifest.json", manifest],
    ],
    (path) => {
      assert.deepEqual(imageArchiveConfigIds(path), [PG, BR]);
      assert.equal(readTarMember(path, "absent.json"), null);
      assert.equal(readTarMember(path, "manifest.json").toString(), manifest);
    },
  );
});

test("4089: an archive with no manifest.json or no config digest is refused", () => {
  withArchive([["index.json", "{}"]], (path) =>
    assert.throws(() => imageArchiveConfigIds(path), /no manifest\.json/),
  );
  withArchive([["manifest.json", JSON.stringify([{ Config: "x" }])]], (path) =>
    assert.throws(() => imageArchiveConfigIds(path), /no config digest/),
  );
  withArchive([["manifest.json", "[]"]], (path) =>
    assert.throws(() => imageArchiveConfigIds(path), /lists no image/),
  );
});

test("4089: the archive must hold exactly the certified images", () => {
  assert.doesNotThrow(() =>
    assertArchiveMatchesCertificate([BR, PG], certificate),
  );
  assert.throws(
    () => assertArchiveMatchesCertificate([PG], certificate),
    /the image archive holds/,
  );
  assert.throws(
    () =>
      assertArchiveMatchesCertificate(
        [PG, BR, `sha256:${"3".repeat(64)}`],
        certificate,
      ),
    /the image archive holds/,
  );
  assert.throws(
    () =>
      assertArchiveMatchesCertificate([PG, BR], {
        images: { postgres: { id: PG } },
      }),
    /no immutable image id/,
  );
});

test("4089: only a changed data source hash needs an artifact; an unknown hash is a refusal", () => {
  assert.equal(
    postgresInputChanged({ targetHash: HASH, liveHash: HASH }),
    false,
  );
  assert.equal(
    postgresInputChanged({ targetHash: HASH, liveHash: "b".repeat(64) }),
    true,
  );
  assert.throws(
    () => postgresInputChanged({ targetHash: HASH, liveHash: undefined }),
    /unknown/,
  );
  assert.throws(() => postgresArtifactName("abc"), /not a data source hash/);
});

const run = (over = {}) => ({
  id: 10,
  path: POSTGRES_ARTIFACT_WORKFLOW,
  event: "push",
  head_branch: "main",
  head_sha: "c".repeat(40),
  head_repository: { full_name: REPO },
  status: "completed",
  conclusion: "success",
  ...over,
});
const artifact = (runId, over = {}) => ({
  id: runId * 100,
  name: postgresArtifactName(HASH),
  expired: false,
  created_at: `2026-11-1${runId % 10}T00:00:00Z`,
  workflow_run: { id: runId },
  ...over,
});

test("4089: a release delivers the newest successful main or hotfix certification of its source hash", () => {
  const chosen = selectPostgresArtifact({
    sourceHash: HASH,
    repo: REPO,
    artifacts: [
      artifact(11),
      artifact(12),
      artifact(13, { name: postgresArtifactName("d".repeat(64)) }),
    ],
    runs: [
      run({ id: 11 }),
      run({
        id: 12,
        event: "workflow_dispatch",
        head_branch: "hotfix/4057-pgbackrest",
      }),
      run({ id: 13 }),
    ],
  });
  assert.equal(chosen.runId, 12);
  assert.equal(chosen.artifactId, 1200);
});

test("4089: a pull_request, foreign, failed, expired or off-branch certification is never delivered", () => {
  const cases = [
    [run({ event: "pull_request" }), /a pull_request run/],
    [
      run({ head_repository: { full_name: "someone/fork" } }),
      /another repository/,
    ],
    [run({ conclusion: "failure" }), /its run is failure/],
    [
      run({ status: "in_progress", conclusion: null }),
      /its run is in_progress/,
    ],
    [run({ head_branch: "tooling/4089-x" }), /branch tooling\/4089-x/],
    [run({ head_branch: "hotfix/nope" }), /branch hotfix\/nope/],
    [
      run({ path: ".github/workflows/runtime-images.yml" }),
      /comes from \.github\/workflows\/runtime-images\.yml/,
    ],
  ];
  for (const [bad, why] of cases) {
    assert.throws(
      () =>
        selectPostgresArtifact({
          sourceHash: HASH,
          repo: REPO,
          artifacts: [artifact(10)],
          runs: [bad],
        }),
      why,
    );
  }
  assert.throws(
    () =>
      selectPostgresArtifact({
        sourceHash: HASH,
        repo: REPO,
        artifacts: [artifact(10, { expired: true })],
        runs: [run()],
      }),
    /it expired/,
  );
  assert.throws(
    () =>
      selectPostgresArtifact({
        sourceHash: HASH,
        repo: REPO,
        artifacts: [],
        runs: [],
      }),
    /no certified PostgreSQL artifact .*gh workflow run postgres-artifact\.yml/,
  );
});

test("4089: postgres-artifact.yml certifies on a runner with no secret and keeps the evidence it hands the release", () => {
  const workflow = readFileSync(
    new URL(`../../${POSTGRES_ARTIFACT_WORKFLOW}`, import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    workflow,
    /secrets\./,
    "the certification needs no secret",
  );
  assert.doesNotMatch(workflow, /environment:/);
  assert.match(
    workflow,
    /postgres-artifact-prepare\.mjs --local --ref "\$SHA"/,
  );
  for (const file of [
    "certificate.json",
    "images.tar",
    "audit.jsonl",
    "prepare.log",
  ])
    assert.match(workflow, new RegExp(file.replace(".", "\\.")));
  assert.match(
    workflow,
    /name: postgres-artifact-\$\{\{ steps\.hash\.outputs\.source-hash \}\}/,
  );
});

test("4089: preparation runs on an ssh build host or, in Actions, on the runner's own Docker", async () => {
  const { parsePrepareArgs, prepareSpawn } =
    await import("./postgres-artifact-prepare.mjs");
  const common = [
    "--ref",
    "c".repeat(40),
    "--output",
    "c.json",
    "--audit-log",
    "a.jsonl",
    "--export",
    "i.tar",
  ];
  assert.deepEqual(parsePrepareArgs(["--local", ...common]), {
    host: null,
    ref: "c".repeat(40),
    output: "c.json",
    auditLog: "a.jsonl",
    export: "i.tar",
  });
  assert.equal(
    parsePrepareArgs(["--host", "ds-stage-1", ...common]).host,
    "ds-stage-1",
  );
  assert.throws(
    () => parsePrepareArgs(["--host", "ds-stage-1", "--local", ...common]),
    /exactly one of --host <alias> or --local/,
  );
  assert.throws(
    () => parsePrepareArgs(common),
    /exactly one of --host <alias> or --local/,
  );
  assert.throws(
    () => parsePrepareArgs(["--host", "a;b", ...common]),
    /SSH host alias/,
  );
  assert.throws(
    () => parsePrepareArgs(["--local", ...common, "--extra", "x"]),
    /Unknown\/duplicate/,
  );
  assert.deepEqual(
    prepareSpawn("sudo docker system df", { host: null, sshArgs: [] }),
    ["bash", ["-c", "sudo docker system df"]],
  );
  assert.deepEqual(
    prepareSpawn("sudo docker system df", {
      host: "ds-stage-1",
      sshArgs: ["-o", "BatchMode=yes", "ds-stage-1"],
    }),
    ["ssh", ["-o", "BatchMode=yes", "ds-stage-1", "sudo docker system df"]],
  );
});

test("4089: postgres-load is a data verb the release may call but the capabilities probe does not require", async () => {
  const {
    POSTGRES_ARTIFACT_VERBS,
    dataVerbCommand,
    servesDataVerbs,
    DATA_VERBS,
  } = await import("./lib/data-prod.mjs");
  assert.deepEqual(POSTGRES_ARTIFACT_VERBS, ["postgres-load"]);
  assert.equal(
    dataVerbCommand(`postgres-load ${"c".repeat(40)}`, "forced"),
    `postgres-load ${"c".repeat(40)}`,
  );
  assert.equal(
    servesDataVerbs(JSON.stringify({ role: "data", verbs: DATA_VERBS })),
    true,
  );
});

test("4089: a box-local release reads the delivered artifact of its own SHA, loads it into ds-data-prod, and refuses a mismatched archive", async () => {
  const { deliveredPostgresArtifact, loadPostgresArtifact } =
    await import("./prod.mjs");
  const sha = "c".repeat(40);
  const dir = mkdtempSync(join(tmpdir(), "pg-delivered-"));
  try {
    assert.equal(
      deliveredPostgresArtifact(sha, { dir }),
      null,
      "no delivery: the guard decides without a certificate",
    );
    const own = join(dir, sha);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(own);
    writeFileSync(join(own, "certificate.json"), JSON.stringify(certificate));
    assert.throws(
      () => deliveredPostgresArtifact(sha, { dir }),
      /no images\.tar|ENOENT/,
    );
    const manifest = (ids) =>
      JSON.stringify(
        ids.map((id) => ({ Config: `blobs/sha256/${id.slice(7)}` })),
      );
    writeFileSync(
      join(own, "images.tar"),
      tar([["manifest.json", manifest([PG])]]),
    );
    assert.throws(
      () => deliveredPostgresArtifact(sha, { dir }),
      /the image archive holds/,
    );
    writeFileSync(
      join(own, "images.tar"),
      tar([["manifest.json", manifest([PG, BR])]]),
    );
    const delivered = deliveredPostgresArtifact(sha, { dir });
    assert.deepEqual(delivered.certificate, certificate);
    assert.equal(delivered.imagesFile, join(own, "images.tar"));
    const calls = [];
    const client = {
      call: async (words, options) => (
        calls.push([words, options]),
        "Loaded image ID: x"
      ),
    };
    const lines = [];
    await loadPostgresArtifact(sha, delivered, {
      client,
      log: (l) => lines.push(l),
    });
    assert.deepEqual(calls, [
      [["postgres-load", sha], { inputFile: join(own, "images.tar") }],
    ]);
    assert.match(
      lines.join("\n"),
      /certified PostgreSQL images 111111111111 \/ 222222222222.*Loaded image ID: x/s,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
