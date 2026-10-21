// tools/staging/slot-local.test.mjs — the box-local mode of the slot tool (Issue #2985;
// tech spec 2026-10-16-release-pipeline-off-workstation-en.md §3 item 2, §5): the
// stage release driver runs `slot.mjs up main --local --images-file <f>` on the box.
// The plan must be the operator's, step for step; only the transport and the source
// of the digests differ.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { IMAGE_REGISTRY } from "../deploy/lib/registry.mjs";
import { GOLDEN_SUBJECT_ENV_VARS } from "./idp.mjs";
import { SELF_TREE, SlotError, parseArgs, parseBasicAuthPass, readImagesFile, runSlotCommand } from "./slot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";
const BASE = "stage.doctor.school";
const digestOf = (hex) => `sha256:${hex.repeat(64)}`;
const IMAGES = Object.freeze({
  api: `${IMAGE_REGISTRY}/api@${digestOf("a")}`,
  "api-migrate": `${IMAGE_REGISTRY}/api-migrate@${digestOf("b")}`,
  portal: `${IMAGE_REGISTRY}/portal@${digestOf("c")}`,
  admin: `${IMAGE_REGISTRY}/admin@${digestOf("d")}`,
  doctor: `${IMAGE_REGISTRY}/doctor@${digestOf("e")}`,
});
const SUBJECTS = Object.fromEntries(GOLDEN_SUBJECT_ENV_VARS.map((name, i) => [name, `sub-${i + 1}`]));

test("2985: `--local --images-file` parses for `up main` only, and only as a pair", () => {
  assert.deepEqual(parseArgs(["up", "main", "--ref", SHA, "--local", "--images-file", "-"]), {
    command: "up",
    slot: "main",
    sha: SHA,
    local: true,
    imagesFile: "-",
  });
  assert.deepEqual(parseArgs(["up", "main", "--local", "--images-file", "m.json", "--ref", SHA, "--retry-failed"]), {
    command: "up",
    slot: "main",
    sha: SHA,
    retryFailed: true,
    local: true,
    imagesFile: "m.json",
  });
  assert.throws(() => parseArgs(["up", "main", "--ref", SHA, "--local"]), /go together/);
  assert.throws(() => parseArgs(["up", "main", "--ref", SHA, "--images-file", "m.json"]), /go together/);
  assert.throws(() => parseArgs(["up", "main", "--ref", SHA, "--local", "--images-file"]), /requires a path/);
  assert.throws(
    () => parseArgs(["up", "pr-7", "--ref", SHA, "--local", "--images-file", "m.json"]),
    /only `up main`/,
  );
  assert.throws(
    () => parseArgs(["sync", "main", "--ref", SHA, "--local", "--images-file", "m.json"]),
    /only `up main`/,
  );
});

/** Every effect call of one `up main`, with the whole step it was handed. */
async function plannedCalls(options) {
  const calls = [];
  const record = (kind) => async (...args) => {
    // The audit line's wall-clock stamp is the one value two runs cannot share.
    const stable = JSON.stringify(args).replace(/\d{4}-\d\d-\d\dT[0-9:.]+Z/g, "<now>");
    calls.push([kind, JSON.parse(stable)]);
    if (kind === "idp" && args[0].op === "golden-identities") return SUBJECTS;
    return undefined;
  };
  const effects = Object.fromEntries(
    ["sql", "sh", "write", "append", "idp", "ship", "verifyImages", "verifyRunning", "health", "prune"].map(
      (kind) => [kind, record(kind)],
    ),
  );
  effects.probe = async (command) => {
    calls.push(["probe", command]);
    return { ok: false, stdout: "", stderr: "" };
  };
  effects.log = () => {};
  const line = await runSlotCommand({
    options: { ...options, actor: "deploy" },
    images: IMAGES,
    liveSlots: {},
    baseDomain: BASE,
    effects,
    databaseExists: () => true,
  });
  return { calls, line };
}

test("2985: the local converge plans exactly the operator's steps, in order", async () => {
  const operator = await plannedCalls(parseArgs(["up", "main", "--ref", SHA]));
  const local = await plannedCalls(
    parseArgs(["up", "main", "--ref", SHA, "--local", "--images-file", "-"]),
  );
  assert.ok(operator.calls.length > 10, "a real plan ran");
  assert.ok(operator.calls.some(([kind]) => kind === "ship"));
  assert.deepEqual(local.calls, operator.calls);
  assert.equal(local.line, operator.line);
});

const manifest = (over = {}) => JSON.stringify({ sha: SHA, ref: "main", images: { ...IMAGES }, ...over });
const readWith = (text) => readImagesFile({ slot: "main", sha: SHA, path: "m.json", readText: () => text });

test("2985: the stdin manifest is the images-<sha>.json of the SHA, validated strictly", () => {
  assert.deepEqual(readWith(manifest()), { ref: "main", images: { ...IMAGES } });
  assert.equal(readWith(manifest({ ref: "hotfix/12-fix-x" })).ref, "hotfix/12-fix-x");

  assert.throws(() => readWith(manifest({ sha: "f".repeat(40) })), /not 0123456789abcdef0123456789abcdef01234567/);
  assert.throws(
    () => readWith(manifest({ images: { ...IMAGES, api: `${IMAGE_REGISTRY}/api@sha512:${"a".repeat(64)}` } })),
    /not a digest reference/,
  );
  assert.throws(
    () => readWith(manifest({ images: { ...IMAGES, api: `${IMAGE_REGISTRY}/api@sha256:${"a".repeat(63)}` } })),
    /not a digest reference/,
  );
  assert.throws(
    () => readWith(manifest({ images: { ...IMAGES, worker: `${IMAGE_REGISTRY}/worker@${digestOf("f")}` } })),
    /unknown image/,
  );
  assert.throws(() => readWith(manifest({ ref: "pr/7" })), /accepts only/);
  assert.throws(() => readWith(manifest({ extra: 1 })), /not exactly sha, ref, images/);
  assert.throws(() => readWith("not json"), SlotError);
  assert.throws(() => readWith("[]"), /not a JSON object/);
});

// #3114: the driver unit runs as `deploy` with the root-only manifest as its stdin.
// Opening `/dev/stdin` re-opens that file through /proc/self/fd/0 and re-checks its
// permissions (EACCES); `-` reads the already-open fd 0 and opens no path.
test("3114: `--images-file -` reads the inherited fd 0, never a path", () => {
  const sources = [];
  const read = (path) =>
    readImagesFile({
      slot: "main",
      sha: SHA,
      path,
      readText: (source) => {
        sources.push(source);
        return manifest();
      },
    });
  assert.deepEqual(read("-"), { ref: "main", images: { ...IMAGES } });
  assert.deepEqual(read("m.json"), { ref: "main", images: { ...IMAGES } });
  assert.deepEqual(sources, [0, "m.json"]);
  assert.throws(
    () => readImagesFile({ slot: "main", sha: SHA, path: "-", readText: () => "not json" }),
    /the image manifest on stdin is not readable JSON/,
  );
});

test("3114: the default reader takes `-` from the process's real stdin", () => {
  const script =
    `import { readImagesFile } from ${JSON.stringify(new URL("./slot.mjs", import.meta.url).href)};` +
    `process.stdout.write(JSON.stringify(readImagesFile({ slot: "main", sha: ${JSON.stringify(SHA)}, path: "-" })));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    input: manifest(),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { ref: "main", images: { ...IMAGES } });
});

test("2985: a local run ships the tree it runs from", () => {
  assert.equal(SELF_TREE, resolve(here, "../.."));
});

// The tool needs no node_modules: a bare `git archive` of the tree runs it (the box
// gets exactly that tree from codeload).
test("2985: slot.mjs runs from a bare tree without node_modules", () => {
  const dir = mkdtempSync(join(tmpdir(), "ds-slot-bare-"));
  try {
    for (const path of ["tools/staging", "tools/deploy", "package.json"]) {
      cpSync(join(SELF_TREE, path), join(dir, path), {
        recursive: true,
        filter: (src) => !src.includes("node_modules"),
      });
    }
    assert.equal(existsSync(join(dir, "node_modules")), false);
    const run = spawnSync(process.execPath, [join(dir, "tools/staging/slot.mjs")], { encoding: "utf8" });
    // No command = the usage line, from a module graph that loaded completely.
    assert.equal(run.status, 1);
    assert.match(run.stderr, /usage: ds-slot up\|sync/);
    assert.doesNotMatch(run.stderr, /Cannot find (module|package)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #3117: the box file is two lines, `user=stage` / `password=<plaintext>` — the
// operator path takes the `password=` line with sed; a `--local` converge must too.
test("3117: the basic-auth file yields only its password= value", () => {
  for (const text of [
    "user=stage\npassword=s3cret=with-equals\n",
    "user=stage\r\npassword=s3cret=with-equals\r\n",
    "password=s3cret=with-equals\nuser=stage",
  ]) {
    assert.equal(parseBasicAuthPass(text, "/etc/x.txt"), "s3cret=with-equals");
  }
});

test("3117: a basic-auth file without a non-empty password= line is refused by name", () => {
  for (const text of ["", "user=stage\n", "user=stage\npassword=\n", "user=stage\npassword=   \n"]) {
    assert.throws(
      () => parseBasicAuthPass(text, "/etc/x.txt"),
      (error) => error instanceof SlotError && /\/etc\/x\.txt/.test(error.message) && /password=/.test(error.message),
    );
  }
});
