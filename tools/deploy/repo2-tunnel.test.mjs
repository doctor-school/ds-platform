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
// - the names the box scripts reach the tunnel by are compose.yml's.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_PROD = resolve(here, "../../infra/deploy/compose/data-prod");
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
