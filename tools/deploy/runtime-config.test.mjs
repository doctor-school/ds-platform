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
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import {
  runtimeConfigComparisonScript,
  runtimeConfigServicesToRestart,
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
