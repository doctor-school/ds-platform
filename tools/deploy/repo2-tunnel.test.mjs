// tools/deploy/repo2-tunnel.test.mjs — Issue #4287.
//
// repo2 (IDrive e2) is reached from ds-data-prod through an SSH local forward to the
// relay host (infra/deploy/compose/data-prod/repo2-tunnel/). What this locks:
// - the forward is reachable on its own compose network only: no published port, no
//   host networking, and that network shared with the pgbackrest sidecar alone, the
//   one container that talks to an offsite repo (#4298: PostgreSQL archives to repo1
//   only). The relay's key line admits the VPC router's NAT address, which every VPC
//   machine shares, so a host-exposed listener would open IDrive to all of them;
// - pgBackRest keeps IDrive's endpoint name (the tunnel carries it as its network
//   alias): no repo2-storage-host, no weakened TLS check;
// - postgres and pgbackrest never depend on the tunnel, so its failure leaves repo1;
//   postgres is on no network of the tunnel's;
// - the relay's host key is the committed one, checked strictly;
// - the names the box scripts reach the tunnel by are compose.yml's;
// - a compose command that names no service leaves the tunnel out (its own profile), so
//   a box without the tunnel key (a rebuilt one, RECOVERY.md §4) can still raise the
//   project; the box paths that start it name it, which activates the profile;
// - a relay that refuses the key sees a capped exponential backoff from the NAT address
//   every VPC machine shares, not a fixed 10 s retry.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_PROD = resolve(here, "../../infra/deploy/compose/data-prod");
const TUNNEL_SH = join(DATA_PROD, "repo2-tunnel/tunnel.sh");
const compose = JSON.parse(readFileSync(join(DATA_PROD, "compose.yml"), "utf8"));
const tunnel = compose.services["repo2-tunnel"];
const IDRIVE = "s3.ap-southeast-2.idrivee2.com";
const RELAY = "94.198.221.20";
const RELAY_KEY = `${RELAY} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILgLRSqm6x0LWOxK0Mmk8u52PMucOc0m08wzwnFuT4fF`;

test("4287: the tunnel publishes no port and is on no host network", () => {
  assert.ok(tunnel, "compose.yml defines repo2-tunnel");
  for (const key of ["ports", "expose", "network_mode", "extra_hosts"])
    assert.equal(tunnel[key], undefined, `repo2-tunnel sets ${key}`);
  assert.deepEqual(Object.keys(tunnel.networks), ["repo2-tunnel"], "the tunnel's own network only");
  const net = compose.networks["repo2-tunnel"];
  assert.ok(net && !net.external && !net.driver && !net.name, "a project bridge network compose creates");
});

test("4287: the tunnel network is shared with the pgbackrest sidecar alone, and carries IDrive's name", () => {
  const on = Object.entries(compose.services)
    .filter(([, s]) => {
      const n = s.networks;
      return Array.isArray(n) ? n.includes("repo2-tunnel") : n && "repo2-tunnel" in n;
    })
    .map(([name]) => name)
    .sort();
  assert.deepEqual(on, ["pgbackrest", "repo2-tunnel"]);
  assert.deepEqual(compose.services.pgbackrest.networks, ["default", "repo2-tunnel"]);
  assert.equal(compose.services.postgres.networks, undefined, "postgres stays on the default network alone");
  for (const name of ["postgres", "pgbackrest"])
    assert.equal(compose.services[name].depends_on?.["repo2-tunnel"], undefined, `${name} never waits on the tunnel`);
  assert.deepEqual(tunnel.networks["repo2-tunnel"].aliases, [IDRIVE]);
  for (const [name, s] of Object.entries(compose.services))
    if (name !== "repo2-tunnel") assert.equal(s.network_mode, undefined, name);
});

test("4287: the tunnel mounts its key read-only from the box, never creating the path", () => {
  const key = tunnel.volumes.find((v) => v.target === "/run/repo2-tunnel");
  assert.deepEqual(key, {
    type: "bind",
    source: "/etc/ds-platform/repo2-tunnel",
    target: "/run/repo2-tunnel",
    read_only: true,
    bind: { create_host_path: false },
  });
  assert.ok(tunnel.volumes.every((v) => v.read_only === true), "every mount read-only");
  assert.equal(tunnel.restart, "unless-stopped");
  assert.equal(tunnel.init, true, "signals reach the reconnect loop");
  assert.equal(tunnel.image, compose.services.pgbackrest.image, "the certified pgbackrest image (its ssh client)");
});

test("4287: the forward goes to IDrive by name over the pinned relay host key, strictly", () => {
  assert.equal(readFileSync(join(DATA_PROD, "repo2-tunnel/known_hosts"), "utf8"), `${RELAY_KEY}\n`);
  const sh = readFileSync(join(DATA_PROD, "repo2-tunnel/tunnel.sh"), "utf8");
  assert.match(sh, new RegExp(`^target=${IDRIVE.replaceAll(".", "\\.")}:443$`, "m"));
  assert.match(sh, new RegExp(`^relay=deploy@${RELAY.replaceAll(".", "\\.")}$`, "m"));
  for (const option of [
    "-N",
    "-F /dev/null",
    "-o StrictHostKeyChecking=yes",
    '-o "UserKnownHostsFile=$conf/known_hosts"',
    "-o GlobalKnownHostsFile=/dev/null",
    "-o ExitOnForwardFailure=yes",
    "-o ServerAliveInterval=15",
    "-o BatchMode=yes",
    '-L "0.0.0.0:443:$target"',
  ])
    assert.ok(sh.includes(option), option);
  assert.doesNotMatch(sh, /accept-new|StrictHostKeyChecking=no/);
  assert.match(readFileSync(join(DATA_PROD, "pgbackrest/Dockerfile"), "utf8"), /^\s+openssh-client \\$/m);
});

test("4287: pgBackRest keeps IDrive's endpoint name and the TLS check", () => {
  const conf = readFileSync(join(DATA_PROD, "pgbackrest/pgbackrest.conf"), "utf8");
  assert.doesNotMatch(conf, /^(#repo2: )?repo2-storage-(host|port|verify-tls)=/m);
  assert.match(
    readFileSync(resolve(here, "../../infra/deploy/data.env.example"), "utf8"),
    new RegExp(`^PGBACKREST_REPO2_S3_ENDPOINT=${IDRIVE.replaceAll(".", "\\.")}$`, "m"),
  );
});

test("4287: ds-recovery reaches the tunnel by compose.yml's names", () => {
  const recovery = readFileSync(resolve(here, "../../infra/deploy/bin/ds-recovery"), "utf8");
  const value = (name) => recovery.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1];
  assert.equal(value("REPO2_TUNNEL_HOST"), IDRIVE);
  assert.equal(value("REPO2_TUNNEL_CONTAINER"), `${compose.name}-repo2-tunnel-1`);
  assert.equal(value("REPO2_TUNNEL_NETWORK"), `${compose.name}_repo2-tunnel`);
});

test("4287: only a compose command that names the tunnel starts it (its own profile)", () => {
  assert.deepEqual(tunnel.profiles, ["repo2-tunnel"]);
  for (const [name, s] of Object.entries(compose.services))
    if (name !== "repo2-tunnel") assert.equal(s.profiles, undefined, `${name} starts with an unnamed compose up`);
  // data-up and the data-secret unit both run DATA_UP_TUNNEL: it names the service,
  // which is what activates the profile.
  const entrypoint = readFileSync(resolve(here, "../../infra/deploy/bin/ds-deploy-entrypoint"), "utf8");
  const up = entrypoint.match(/^DATA_UP_TUNNEL="(.*)"$/m)?.[1] ?? "DATA_UP_TUNNEL missing";
  assert.match(up, / up -d --no-build --pull never --no-deps repo2-tunnel \|\| /);
  assert.doesNotMatch(up, /--profile/);
});

// tunnel.sh runs under the image's /bin/sh (dash) with stubs for ssh, date and sleep on
// PATH: each ssh "session" advances a fake clock by its scripted length, and the 11th
// sleep ends the loop.
const POSIX_SH = spawnSync("sh", ["-c", "command -v kill"], { stdio: "ignore" }).status === 0;
test(
  "4287: the tunnel reconnects after 10 s doubling to 300 s, and from 10 s again after a session that held 60 s",
  { skip: !POSIX_SH && "needs a POSIX sh" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "repo2-tunnel-"));
    try {
      const stub = (name, body) => {
        writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(dir, name), 0o755);
      };
      // Session lengths in seconds: seven refused at once, one that held, then the
      // 59 s / 60 s boundary.
      writeFileSync(join(dir, "sessions"), [5, 5, 5, 5, 5, 5, 5, 120, 5, 59, 60].join("\n") + "\n");
      writeFileSync(join(dir, "clock"), "1000\n");
      stub(
        "ssh",
        [
          'n=$(( $(cat "$STUB/ssh.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB/ssh.n"',
          'printf "%s\\n" "$@" > "$STUB/ssh.args"',
          'echo $(( $(cat "$STUB/clock") + $(sed -n "${n}p" "$STUB/sessions") )) > "$STUB/clock"',
          "exit 255",
        ].join("\n"),
      );
      stub("date", '[ "$*" = +%s ] || exit 2\ncat "$STUB/clock"');
      stub(
        "sleep",
        [
          'echo "$1" >> "$STUB/sleep.log"',
          'echo $(( $(cat "$STUB/clock") + $1 )) > "$STUB/clock"',
          '[ "$(wc -l < "$STUB/sleep.log")" -lt 11 ] || kill -TERM "$PPID"',
        ].join("\n"),
      );
      const r = spawnSync("sh", [TUNNEL_SH], {
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, STUB: dir },
        encoding: "utf8",
        timeout: 20_000,
      });
      assert.equal(r.error, undefined, "the 11th sleep ends the loop, not the timeout");
      const delays = [10, 20, 40, 80, 160, 300, 300, 10, 20, 40, 10];
      assert.deepEqual(readFileSync(join(dir, "sleep.log"), "utf8").trim().split("\n").map(Number), delays);
      assert.equal(
        r.stderr,
        delays.map((d) => `repo2-tunnel: ssh exited 255; reconnecting in ${d} s\n`).join(""),
      );
      // Every session runs the same ssh, every option kept.
      assert.equal(readFileSync(join(dir, "ssh.n"), "utf8").trim(), "11");
      assert.deepEqual(readFileSync(join(dir, "ssh.args"), "utf8").trim().split("\n"), [
        "-N",
        "-F",
        "/dev/null",
        "-i",
        "/run/repo2-tunnel/id_ed25519",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "UserKnownHostsFile=/etc/repo2-tunnel/known_hosts",
        "-o",
        "GlobalKnownHostsFile=/dev/null",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        "-o",
        "ConnectTimeout=20",
        "-o",
        "GatewayPorts=yes",
        "-L",
        `0.0.0.0:443:${IDRIVE}:443`,
        `deploy@${RELAY}`,
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
