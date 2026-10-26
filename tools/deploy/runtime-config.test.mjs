// tools/deploy/runtime-config.test.mjs — Issue #2801.
//
// The regression these lock: the #1175 stale-bind-mount check must read the
// mounted file THROUGH the running container. For a single-file bind mount
// `docker cp <id>:<path>` resolves to the HOST source path, i.e. the freshly
// shipped file, so the comparison always printed `match` and the stale
// container was never restarted. The behavioural test runs the generated bash
// against stubbed `sudo`/`docker` on PATH — no docker needed — where `exec …
// cat` returns the container's stale view and `cp` returns the host file.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import {
  applyRuntimeConfigsOrRestore,
  caddyValidateScript,
  caddyValidateVerdict,
  centrifugoConfigVerdict,
  runtimeConfigBackupScript,
  runtimeConfigComparisonScript,
  runtimeConfigInstallScript,
  runtimeConfigRestoreScript,
  runtimeConfigServicesToRestart,
  runtimeConfigStepVerdict,
  validateRuntimeConfigs,
} from "./prod.mjs";

const SHIPPED = {
  Caddyfile: "caddy-new\n",
  "centrifugo/config.json": '{"new":true}\n',
};

function runComparison({ containerView, failExec = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "runtime-config-"));
  try {
    const bin = join(dir, "bin");
    const compose = join(dir, "compose");
    mkdirSync(bin);
    mkdirSync(join(compose, "centrifugo"), { recursive: true });
    for (const [path, content] of Object.entries(SHIPPED)) {
      writeFileSync(join(compose, path), content);
    }
    const view = join(dir, "view");
    mkdirSync(join(view, "etc", "caddy"), { recursive: true });
    mkdirSync(join(view, "centrifugo"), { recursive: true });
    writeFileSync(join(view, "etc", "caddy", "Caddyfile"), containerView.caddy);
    writeFileSync(
      join(view, "centrifugo", "config.json"),
      containerView.centrifugo,
    );
    for (const mountedPath of failExec)
      writeFileSync(`${view}${mountedPath}.fail`, "");

    writeFileSync(join(bin, "sudo"), '#!/usr/bin/env bash\nexec "$@"\n');
    // `docker cp` mimics the bind-mount behaviour: it yields the HOST file.
    writeFileSync(
      join(bin, "docker"),
      `#!/usr/bin/env bash
host_path() { case "$1" in /etc/caddy/Caddyfile) echo "${compose}/Caddyfile";; /centrifugo/config.json) echo "${compose}/centrifugo/config.json";; esac; }
case "$1" in
  compose) echo "id-$4" ;;
  cp) cat "$(host_path "\${2#*:}")" > "$3" ;;
  exec) [ "$3" = cat ] || exit 1
    # A failing exec still emits the shipped bytes: only its exit status may decide.
    if [ -e "${view}$4.fail" ]; then cat "$(host_path "$4")"; exit 125; fi
    cat "${view}$4" ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(join(bin, "sudo"), 0o755);
    chmodSync(join(bin, "docker"), 0o755);

    const script = runtimeConfigComparisonScript().replace(
      /^cd .*$/m,
      `cd "${compose}"`,
    );
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("comparison reads the mounted file through the container, never docker cp", () => {
  const script = runtimeConfigComparisonScript();
  assert.match(script, /docker exec "\$container_id" cat "\$mounted_path"/);
  assert.doesNotMatch(script, /docker cp/);
});

test("a container still serving the pre-deploy file is reported stale", () => {
  const output = runComparison({
    containerView: {
      caddy: "caddy-old\n",
      centrifugo: SHIPPED["centrifugo/config.json"],
    },
  });
  assert.equal(output, "caddy=mismatch\ncentrifugo=match\n");
  assert.deepEqual(runtimeConfigServicesToRestart(output), ["caddy"]);
});

test("a failing docker exec is reported stale, never match", () => {
  const output = runComparison({
    containerView: {
      caddy: SHIPPED.Caddyfile,
      centrifugo: SHIPPED["centrifugo/config.json"],
    },
    failExec: ["/centrifugo/config.json"],
  });
  assert.equal(output, "caddy=match\ncentrifugo=mismatch\n");
  assert.deepEqual(runtimeConfigServicesToRestart(output), ["centrifugo"]);
});

test("containers serving the shipped files match", () => {
  const output = runComparison({
    containerView: {
      caddy: SHIPPED.Caddyfile,
      centrifugo: SHIPPED["centrifugo/config.json"],
    },
  });
  assert.equal(output, "caddy=match\ncentrifugo=match\n");
  assert.deepEqual(runtimeConfigServicesToRestart(output), []);
});

test("restart set lists every service not reported as match", () => {
  assert.deepEqual(
    runtimeConfigServicesToRestart("caddy=mismatch\ncentrifugo=match"),
    ["caddy"],
  );
  assert.deepEqual(
    runtimeConfigServicesToRestart("caddy=match\r\ncentrifugo=mismatch\r\n"),
    ["centrifugo"],
  );
  assert.deepEqual(runtimeConfigServicesToRestart(""), ["caddy", "centrifugo"]);
});

// --- #3274: keep, validate, restore ----------------------------------------
// A shipped Caddyfile that did not parse took the prod edge down (#3273). The
// release keeps the configs the containers serve outside the shipped tree,
// validates the shipped Caddyfile before any swap, and restores on a failure.

const TARGET = "a".repeat(40);
const OTHER = "b".repeat(40);
const SOURCE = readFileSync(join(import.meta.dirname, "prod.mjs"), "utf8");

/** A fake api-prod: compose dir, backup dir, container views, stub sudo/docker. */
function fakeBox() {
  const dir = mkdtempSync(join(tmpdir(), "runtime-config-3274-"));
  const bin = join(dir, "bin");
  const compose = join(dir, "compose");
  const backup = join(dir, "var", "previous");
  const view = join(dir, "view");
  mkdirSync(bin);
  mkdirSync(join(compose, "centrifugo"), { recursive: true });
  mkdirSync(join(view, "etc", "caddy"), { recursive: true });
  mkdirSync(join(view, "centrifugo"), { recursive: true });
  writeFileSync(join(bin, "sudo"), '#!/usr/bin/env bash\nexec "$@"\n');
  writeFileSync(
    join(bin, "docker"),
    `#!/usr/bin/env bash
case "$1" in
  compose) [ -e "${view}/down-$4" ] || echo "id-$4" ;;
  exec) [ "$3" = cat ] || exit 1; cat "${view}$4" ;;
  run) echo "run $*" >> "${dir}/docker-run.log"
    if [ -e "${view}/caddy-invalid" ]; then echo 'Error: adapting config using caddyfile: unknown directive'; exit 1; fi
    echo 'Valid configuration' ;;
  *) exit 1 ;;
esac
`,
  );
  chmodSync(join(bin, "sudo"), 0o755);
  chmodSync(join(bin, "docker"), 0o755);
  return {
    dir,
    compose,
    backup,
    write(root, files) {
      for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
    },
    serve({ caddy, centrifugo }) {
      writeFileSync(join(view, "etc", "caddy", "Caddyfile"), caddy);
      writeFileSync(join(view, "centrifugo", "config.json"), centrifugo);
    },
    down(service) {
      writeFileSync(join(view, `down-${service}`), "");
    },
    caddyInvalid() {
      writeFileSync(join(view, "caddy-invalid"), "");
    },
    read(root, path) {
      return readFileSync(join(root, path), "utf8");
    },
    run(script) {
      const result = spawnSync("bash", ["-c", script], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
      });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const PREVIOUS = { Caddyfile: "caddy-previous\n", "centrifugo/config.json": '{"previous":true}\n' };
const SHIPPED_NEXT = { Caddyfile: "caddy-next\n", "centrifugo/config.json": '{"next":true}\n' };
const serving = (files) => ({ caddy: files.Caddyfile, centrifugo: files["centrifugo/config.json"] });

test("3274: the backup is taken from what the running containers serve, not from the tree on disk", () => {
  const box = fakeBox();
  try {
    // An earlier failed release left other bytes on disk; the containers still serve PREVIOUS.
    box.write(box.compose, SHIPPED_NEXT);
    box.serve(serving(PREVIOUS));
    const out = box.run(runtimeConfigBackupScript(TARGET, { composeDir: box.compose, backupDir: box.backup }));
    assert.match(out, /^caddy=running$/m);
    assert.match(out, /^centrifugo=running$/m);
    assert.deepEqual(runtimeConfigStepVerdict(out, "backup"), { ok: true, detail: `taken ${TARGET}` });
    assert.equal(box.read(box.backup, "Caddyfile"), PREVIOUS.Caddyfile);
    assert.equal(box.read(box.backup, "centrifugo/config.json"), PREVIOUS["centrifugo/config.json"]);
    assert.equal(box.read(box.backup, "for"), `${TARGET}\n`);
  } finally {
    box.cleanup();
  }
});

test("3274: a re-entered run of the same target keeps its backup; a new target retakes it", () => {
  const box = fakeBox();
  try {
    const opts = { composeDir: box.compose, backupDir: box.backup };
    box.write(box.compose, PREVIOUS);
    box.serve(serving(PREVIOUS));
    box.run(runtimeConfigBackupScript(TARGET, opts));
    // The first entry shipped and applied the target's configs, then died later.
    box.write(box.compose, SHIPPED_NEXT);
    box.serve(serving(SHIPPED_NEXT));
    const again = box.run(runtimeConfigBackupScript(TARGET, opts));
    assert.deepEqual(runtimeConfigStepVerdict(again, "backup"), { ok: true, detail: `kept ${TARGET}` });
    assert.equal(box.read(box.backup, "Caddyfile"), PREVIOUS.Caddyfile, "never clobbered by shipped bytes");
    // The next release keeps what now runs.
    const next = box.run(runtimeConfigBackupScript(OTHER, opts));
    assert.deepEqual(runtimeConfigStepVerdict(next, "backup"), { ok: true, detail: `taken ${OTHER}` });
    assert.equal(box.read(box.backup, "Caddyfile"), SHIPPED_NEXT.Caddyfile);
  } finally {
    box.cleanup();
  }
});

test("3274: a rollback to a SHA keeps its own backup, never the one that SHA's forward release took", () => {
  const box = fakeBox();
  try {
    const opts = { composeDir: box.compose, backupDir: box.backup };
    // The forward release of TARGET kept what ran before it …
    box.write(box.compose, PREVIOUS);
    box.serve(serving(PREVIOUS));
    box.run(runtimeConfigBackupScript(TARGET, opts));
    // … a later release runs now; rolling back to TARGET keeps what runs NOW.
    box.serve(serving(SHIPPED_NEXT));
    const out = box.run(runtimeConfigBackupScript(TARGET, { ...opts, rollback: true }));
    assert.deepEqual(runtimeConfigStepVerdict(out, "backup"), {
      ok: true,
      detail: `taken rollback-${TARGET}`,
    });
    assert.equal(box.read(box.backup, "Caddyfile"), SHIPPED_NEXT.Caddyfile);
    const again = box.run(runtimeConfigBackupScript(TARGET, { ...opts, rollback: true }));
    assert.deepEqual(runtimeConfigStepVerdict(again, "backup"), {
      ok: true,
      detail: `kept rollback-${TARGET}`,
    });
  } finally {
    box.cleanup();
  }
});

test("3274: a container that cannot be read falls back to its file on disk, and says so", () => {
  const box = fakeBox();
  try {
    box.write(box.compose, PREVIOUS);
    box.serve({ caddy: "unused\n", centrifugo: PREVIOUS["centrifugo/config.json"] });
    box.down("caddy");
    const out = box.run(runtimeConfigBackupScript(TARGET, { composeDir: box.compose, backupDir: box.backup }));
    assert.match(out, /^caddy=disk$/m);
    assert.match(out, /^centrifugo=running$/m);
    assert.equal(box.read(box.backup, "Caddyfile"), PREVIOUS.Caddyfile);
  } finally {
    box.cleanup();
  }
});

test("3274: the backup refuses anything but a full SHA", () => {
  assert.throws(() => runtimeConfigBackupScript("abc123"));
  assert.throws(() => runtimeConfigBackupScript(null));
});

test("3274: the restore puts the backup back into the compose dir; no backup is no restore", () => {
  const box = fakeBox();
  try {
    const opts = { composeDir: box.compose, backupDir: box.backup };
    assert.deepEqual(runtimeConfigStepVerdict(box.run(runtimeConfigRestoreScript(opts)), "restore"), {
      ok: false,
      detail: "NO-BACKUP",
    });
    box.write(box.compose, PREVIOUS);
    box.serve(serving(PREVIOUS));
    box.run(runtimeConfigBackupScript(TARGET, opts));
    box.write(box.compose, SHIPPED_NEXT);
    const out = box.run(runtimeConfigRestoreScript(opts));
    assert.deepEqual(runtimeConfigStepVerdict(out, "restore"), {
      ok: true,
      detail: `restored (backup taken for ${TARGET})`,
    });
    assert.equal(box.read(box.compose, "Caddyfile"), PREVIOUS.Caddyfile);
    assert.equal(box.read(box.compose, "centrifugo/config.json"), PREVIOUS["centrifugo/config.json"]);
  } finally {
    box.cleanup();
  }
});

test("3274: caddy validate runs on the caddy image the compose dir pins, with no published port", () => {
  const box = fakeBox();
  try {
    box.write(box.compose, {
      ...SHIPPED_NEXT,
      "compose.yml": "services:\n  caddy:\n    image: caddy:2.11.4-alpine\n",
    });
    const out = box.run(caddyValidateScript({ composeDir: box.compose }));
    assert.deepEqual(caddyValidateVerdict(out), { ok: true, image: "caddy:2.11.4-alpine" });
    const run = box.read(box.dir, "docker-run.log");
    assert.match(run, /caddy:2\.11\.4-alpine caddy validate --adapter caddyfile --config \/etc\/caddy\/Caddyfile/);
    assert.match(run, /Caddyfile:\/etc\/caddy\/Caddyfile:ro/);
    assert.doesNotMatch(run, / -p | --publish/);
    box.caddyInvalid();
    const bad = box.run(caddyValidateScript({ composeDir: box.compose }));
    assert.equal(caddyValidateVerdict(bad).ok, false);
    assert.match(bad, /unknown directive/, "the validate log is shown");
  } finally {
    box.cleanup();
  }
});

test("3274: only an explicit VALID verdict passes caddy validate", () => {
  assert.equal(caddyValidateVerdict("caddy-validate=NO-IMAGE").ok, false);
  assert.equal(caddyValidateVerdict("caddy-validate=INVALID caddy:2").ok, false);
  assert.equal(caddyValidateVerdict("").ok, false);
  assert.equal(caddyValidateVerdict("Valid configuration").ok, false);
});

test("3274: the centrifugo config must parse as a JSON object", () => {
  assert.equal(centrifugoConfigVerdict('{"a":1}').ok, true);
  assert.equal(centrifugoConfigVerdict('{"a":').ok, false);
  assert.equal(centrifugoConfigVerdict("[]").ok, false);
  assert.equal(centrifugoConfigVerdict("null").ok, false);
  const shipped = readFileSync(
    join(import.meta.dirname, "..", "..", "infra/deploy/compose/api-prod/centrifugo/config.json"),
    "utf8",
  );
  assert.equal(centrifugoConfigVerdict(shipped).ok, true, "the committed config parses");
});

test("3274: an invalid edge config restores the previous configs on disk and names the restore", async () => {
  const restored = [];
  const restore = async () => {
    restored.push("restore");
    return `runtime-config-restore=restored (backup taken for ${TARGET})`;
  };
  const valid = await validateRuntimeConfigs({
    centrifugoConfig: "{}",
    validate: async () => "caddy-validate=VALID caddy:2.11.4-alpine",
    restore,
    log: () => {},
  });
  assert.deepEqual(valid, { ok: true, image: "caddy:2.11.4-alpine" });
  assert.deepEqual(restored, [], "a valid config restores nothing");

  const caddy = await validateRuntimeConfigs({
    centrifugoConfig: "{}",
    validate: async () => "caddy-validate=INVALID caddy:2.11.4-alpine",
    restore,
    log: () => {},
  });
  assert.equal(caddy.ok, false);
  assert.match(caddy.reason, /Caddyfile INVALID/);
  assert.match(caddy.restore, /put back on disk/);
  assert.deepEqual(restored, ["restore"]);

  let validated = false;
  const centrifugo = await validateRuntimeConfigs({
    centrifugoConfig: "{",
    validate: async () => {
      validated = true;
      return "caddy-validate=VALID caddy:2";
    },
    restore: async () => "runtime-config-restore=NO-BACKUP",
    log: () => {},
  });
  assert.equal(centrifugo.ok, false);
  assert.match(centrifugo.reason, /centrifugo\/config\.json does not parse/);
  assert.match(centrifugo.restore, /NOT put back on disk \(NO-BACKUP\)/);
  assert.equal(validated, false);
});

test("3274: a failed apply restores the previous configs, restarts both services and names the result", async () => {
  const calls = [];
  let restoredYet = false;
  await assert.rejects(
    applyRuntimeConfigsOrRestore({
      compare: async () => {
        calls.push("compare");
        return restoredYet ? "caddy=match\ncentrifugo=match" : "caddy=mismatch\ncentrifugo=match";
      },
      restart: async (script) => {
        calls.push(script.trim().split("\n").at(-1));
        if (!restoredYet) throw new Error("caddy exited 1");
      },
      restore: async () => {
        calls.push("restore");
        restoredYet = true;
        return `runtime-config-restore=restored (backup taken for ${TARGET})`;
      },
      log: () => {},
    }),
    (err) => {
      assert.match(
        err.message,
        /^caddy exited 1; the previous configs were restored and caddy \+ centrifugo restarted onto them/,
      );
      return true;
    },
  );
  assert.deepEqual(calls, [
    "compare",
    "sudo docker compose restart caddy",
    "restore",
    "sudo docker compose restart caddy centrifugo",
    "compare",
  ]);

  await assert.rejects(
    applyRuntimeConfigsOrRestore({
      compare: async () => "caddy=mismatch\ncentrifugo=mismatch",
      restart: async () => {},
      restore: async () => "runtime-config-restore=NO-BACKUP",
      log: () => {},
    }),
    /did not mount the shipped file\(s\): caddy, centrifugo; the previous configs were NOT restored \(NO-BACKUP\)/,
  );

  const ok = await applyRuntimeConfigsOrRestore({
    compare: async () => "caddy=match\ncentrifugo=match",
    restart: async () => assert.fail("nothing to restart"),
    restore: async () => assert.fail("nothing to restore"),
    log: () => {},
  });
  assert.deepEqual(ok, { restarted: [] });
});

test("3274: the rollback's install script writes the target's configs byte-exact", () => {
  const box = fakeBox();
  try {
    box.write(box.compose, SHIPPED_NEXT);
    const target = { Caddyfile: "caddy 'quoted' $HOME `x`\n\n", "centrifugo/config.json": '{"t":"ü"}' };
    box.run(runtimeConfigInstallScript(target, { composeDir: box.compose }));
    assert.equal(box.read(box.compose, "Caddyfile"), target.Caddyfile);
    assert.equal(box.read(box.compose, "centrifugo/config.json"), target["centrifugo/config.json"]);
    assert.throws(() => runtimeConfigInstallScript({ Caddyfile: "x" }));
  } finally {
    box.cleanup();
  }
});

/** Index of `needle` in `body`, asserting it is there. */
function indexIn(body, needle) {
  const index = body.indexOf(needle);
  assert.ok(index > 0, needle);
  return index;
}

test("3274: the release keeps the configs before the ship and validates them after the boot verify, before IdP and migrate", () => {
  const body = SOURCE.slice(
    SOURCE.indexOf("async function deploy("),
    SOURCE.indexOf("function cutReleaseAtDeployedSha("),
  );
  const at = (needle) => indexIn(body, needle);
  assert.ok(at("await backupRuntimeConfigs(sha);") < at("await shipTree(sha, API_PROD);"));
  const validate = at("await assertRuntimeConfigsValid(targetRuntimeConfigs(sha)");
  assert.ok(at("await verifyImagesBoot(sha, services);") < validate);
  assert.ok(validate < at("await provisionIdp(sha);"));
  assert.ok(at("await provisionIdp(sha);") < at('boxStep(API_PROD, sha, "migrate"'));
  assert.ok(at('boxStep(API_PROD, sha, "migrate"') < at("await applyRuntimeConfigsOrDie({ rollbackHint: true });"));
  assert.match(body, /swapped: "Nothing was swapped"/);
});

test("3274: the rollback writes and validates the target's configs before its up -d, and applies them after it", () => {
  const body = SOURCE.slice(SOURCE.indexOf("async function rollback("), SOURCE.indexOf("// --- entry"));
  const at = (needle) => indexIn(body, needle);
  const order = [
    "releaseCheckScript(RELEASE_ENV, own)",
    "targetConfigs = targetRuntimeConfigs(sha);",
    "await backupRuntimeConfigs(sha, { rollback: true });",
    "runtimeConfigInstallScript(targetConfigs)",
    'await assertRuntimeConfigsValid(targetConfigs, { swapped: "Nothing was rolled back" });',
    "DATA_PROD, releaseSupersedeScript(RELEASE_ENV, undefined, own)",
    '{ label: "rollback up" }',
    "await applyRuntimeConfigsOrDie();",
    "await verifyRunningSha(sha, services);",
  ].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("3274: both rollback paths read the target's configs from the target commit", () => {
  const helper = SOURCE.slice(SOURCE.indexOf("function targetRuntimeConfigs(")).slice(0, 800);
  assert.match(helper, /if \(LOCAL_TREE\) return \[file, readFileSync\(join\(LOCAL_TREE/);
  assert.match(helper, /spawnSync\("git", \["show", `\$\{sha\}:\$\{path\}`\]/);
});
