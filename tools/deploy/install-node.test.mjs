// Tests of infra/deploy/bin/install-node.sh, the pinned Node runtime of the stage box
// release driver (Issue #2985). The pin is checked against the repository's own Node
// line; the script runs against a fixture root (NODE_ROOT) with a local download
// origin (NODE_DIST=file://…), so its checksum refusal and its idempotency run for
// real. Needs bash, curl, sha256sum and readlink — CI Linux; skipped on Windows.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(here, "../../infra/deploy/bin/install-node.sh");
const repo = resolve(here, "../..");
const text = readFileSync(SCRIPT, "utf8");
const pinned = (name) => text.match(new RegExp(`^${name}=(\\S+)$`, "m"))?.[1];

const toolsPresent =
  process.platform !== "win32" &&
  spawnSync("bash", ["-c", "command -v curl && command -v sha256sum && command -v readlink"], { stdio: "ignore" })
    .status === 0;
const SKIP = !toolsPresent && "needs Linux bash, curl, sha256sum and readlink";

test("2985: the box Node pin is an exact release of the repository's Node line, with its sha256", () => {
  const version = pinned("NODE_VERSION");
  assert.match(version, /^v\d+\.\d+\.\d+$/);
  assert.match(pinned("NODE_SHA256"), /^[0-9a-f]{64}$/);
  const [major, minor] = version.slice(1).split(".").map(Number);
  assert.equal(String(major), readFileSync(join(repo, ".nvmrc"), "utf8").trim(), "the .nvmrc major");
  const engines = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).engines.node;
  const floor = engines.match(new RegExp(`\\^${major}\\.(\\d+)\\.`));
  assert.ok(floor, `package.json engines name a ${major}.x floor: ${engines}`);
  assert.ok(minor >= Number(floor[1]), `${version} satisfies ${engines}`);
});

describe("2985: install-node.sh", { skip: SKIP }, () => {
  const run = (root, dist, args = []) =>
    spawnSync("bash", [SCRIPT, ...args], {
      env: { ...process.env, NODE_ROOT: root, NODE_DIST: dist },
      encoding: "utf8",
    });
  const version = pinned("NODE_VERSION");

  it("refuses a tarball that does not match the pinned sha256 and installs nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ds-install-node-"));
    try {
      mkdirSync(join(dir, "dist", version), { recursive: true });
      writeFileSync(join(dir, "dist", version, `node-${version}-linux-x64.tar.xz`), "not node");
      const r = run(join(dir, "root"), `file://${join(dir, "dist")}`);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /does not match the pinned sha256; nothing installed/);
      assert.equal(existsSync(join(dir, "root/usr/local/bin/node")), false);
      assert.equal(existsSync(join(dir, "root/usr/local/lib/nodejs", version)), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("changes nothing on a box already on the pinned version, and dry-runs otherwise", () => {
    const dir = mkdtempSync(join(tmpdir(), "ds-install-node-"));
    try {
      const root = join(dir, "root");
      const dry = run(root, "file:///nonexistent", ["--dry-run"]);
      assert.equal(dry.status, 0, dry.stderr);
      assert.match(dry.stdout, /would install node/);
      assert.equal(existsSync(join(root, "usr/local/bin/node")), false);

      const bin = join(root, "usr/local/lib/nodejs", version, "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "node"), "#!/bin/sh\n");
      chmodSync(join(bin, "node"), 0o755);
      mkdirSync(join(root, "usr/local/bin"), { recursive: true });
      symlinkSync(join(bin, "node"), join(root, "usr/local/bin/node"));
      const again = run(root, "file:///nonexistent");
      assert.equal(again.status, 0, again.stderr);
      assert.match(again.stdout, /already installed .*nothing to change/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown argument", () => {
    assert.equal(run("/nonexistent", "file:///nonexistent", ["--force"]).status, 2);
  });
});
