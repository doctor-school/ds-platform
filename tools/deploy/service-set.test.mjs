// tools/deploy/service-set.test.mjs — Issue #1896.
//
// The regression these lock: `pnpm deploy:prod --ref <sha>` must verify the
// TARGET tree's services, not the local checkout's. The pre-#1860 shape (3
// SHA-tagged services, no `doctor`) is embedded as a fixture excerpt rather than
// read through `git show` so the test stays pure and offline.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  API_PROD_COMPOSE_PATH,
  ServiceSetError,
  bootProbeSet,
  deployServiceSet,
  formatServiceImages,
  formatServiceNames,
  parseDeployServices,
  rollbackBoundaryVerdict,
  shellVarName,
} from "./service-set.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

/** The CURRENT tree's compose file — the `origin/main` deploy target. */
const currentCompose = readFileSync(
  join(REPO_ROOT, ...API_PROD_COMPOSE_PATH.split("/")),
  "utf8",
);

/**
 * Excerpt of `git show 1455bb9c:infra/deploy/compose/api-prod/compose.yml` —
 * the live prod SHA the first `--ref` hotfix built on (2026-08-25), BEFORE
 * #1860 added the `doctor` storefront service. Trimmed to the structure the
 * parser reads; indentation and key shapes are verbatim.
 */
const PRE_DOCTOR_COMPOSE = `# api-prod — public plane.

name: ds-api-prod

services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"

  api:
    build:
      context: ../../../..
      dockerfile: apps/api/Dockerfile
    image: ds-api:\${DEPLOY_SHA:-local}
    restart: unless-stopped
    env_file: [/etc/ds-platform/api.env]
    environment:
      DEPLOY_SHA: \${DEPLOY_SHA:-}

  portal:
    build:
      context: ../../../..
      dockerfile: apps/portal/Dockerfile
    image: ds-portal:\${DEPLOY_SHA:-local}
    restart: unless-stopped
    environment:
      PORT: "3001"

  admin:
    build:
      context: ../../../..
      dockerfile: apps/admin/Dockerfile
    image: ds-admin:\${DEPLOY_SHA:-local}
    restart: unless-stopped
    environment:
      PORT: "3002"

  centrifugo:
    image: centrifugo/centrifugo:v6
    restart: unless-stopped

  zitadel:
    image: ghcr.io/zitadel/zitadel:v4.15.0 # pinned in lockstep with zitadel-login
    environment:
      ZITADEL_EXTERNALPORT: "443"
      ZITADEL_DATABASE_POSTGRES_PORT: "5432"

  sms-aero-adapter:
    image: node:22-alpine
    environment:
      SMS_AERO_ADAPTER_PORT: "8091"

  migrate:
    build:
      context: ../../../..
      dockerfile: apps/api/Dockerfile
      target: migrate
    image: ds-api-migrate:local
    profiles: ["migrate"]

volumes:
  caddy_data:
`;

test("1896: an origin/main deploy derives today's four SHA-tagged services from the CURRENT compose", () => {
  const services = deployServiceSet(currentCompose, { source: "origin/main" });
  assert.deepEqual(
    services.map((s) => s.name),
    ["api", "portal", "admin", "doctor"],
  );
  assert.deepEqual(
    services.map((s) => s.image),
    ["ds-api", "ds-portal", "ds-admin", "ds-doctor"],
  );
  assert.deepEqual(
    services.map((s) => s.port),
    [null, 3001, 3002, 3004],
  );
});

test("1896: the pre-#1860 hotfix base (1455bb9c) derives three services — no doctor", () => {
  const services = deployServiceSet(PRE_DOCTOR_COMPOSE, {
    source: "1455bb9c",
  });
  assert.deepEqual(
    services.map((s) => s.name),
    ["api", "portal", "admin"],
  );
  assert.equal(
    services.some((s) => s.name === "doctor"),
    false,
    "a doctor probe on this target is exactly the #1896 failure",
  );
});

test("1896: upstream pins and the one-shot migrate runner are never in the set", () => {
  const names = parseDeployServices(currentCompose).map((s) => s.name);
  for (const excluded of [
    "caddy",
    "centrifugo",
    "zitadel",
    "zitadel-login",
    "sms-aero-adapter",
    "migrate",
  ]) {
    assert.equal(names.includes(excluded), false, `${excluded} must not be SHA-tagged`);
  }
});

test("1896: the boot probe drops the api and keeps a pinned port per remaining service", () => {
  const probed = bootProbeSet(deployServiceSet(currentCompose));
  assert.deepEqual(
    probed.map((s) => [s.name, s.image, s.port]),
    [
      ["portal", "ds-portal", 3001],
      ["admin", "ds-admin", 3002],
      ["doctor", "ds-doctor", 3004],
    ],
  );

  const preDoctor = bootProbeSet(deployServiceSet(PRE_DOCTOR_COMPOSE));
  assert.deepEqual(
    preDoctor.map((s) => [s.name, s.port]),
    [
      ["portal", 3001],
      ["admin", 3002],
    ],
  );
});

test("1896: PORT keys of other services never leak into a service's probe port", () => {
  const services = parseDeployServices(PRE_DOCTOR_COMPOSE);
  assert.equal(services.find((s) => s.name === "api").port, null);
});

test("1896: an empty or unparsable derivation dies before any ssh", () => {
  assert.throws(() => deployServiceSet(""), ServiceSetError);
  assert.throws(
    () => deployServiceSet("services:\n  caddy:\n    image: caddy:2\n"),
    ServiceSetError,
  );
  // A tree whose only deploy-tagged service is the api leaves the boot probe
  // with nothing to assert — refuse the swap rather than "verify nothing".
  const apiOnly = deployServiceSet(
    "services:\n  api:\n    image: ds-api:${DEPLOY_SHA:-local}\n",
  );
  assert.throws(() => bootProbeSet(apiOnly), ServiceSetError);
  // A probed service without a pinned PORT is a hard error too.
  const noPort = deployServiceSet(
    "services:\n  api:\n    image: ds-api:${DEPLOY_SHA:-local}\n  portal:\n    image: ds-portal:${DEPLOY_SHA:-local}\n",
  );
  assert.throws(() => bootProbeSet(noPort), ServiceSetError);
});

test("1896: human labels render the derived set, not a hard-coded list", () => {
  const preDoctor = deployServiceSet(PRE_DOCTOR_COMPOSE);
  assert.equal(formatServiceNames(preDoctor), "api + portal + admin");
  assert.equal(
    formatServiceImages(preDoctor),
    "ds-api + ds-portal + ds-admin",
  );
  assert.equal(
    formatServiceImages(preDoctor, " / "),
    "ds-api / ds-portal / ds-admin",
  );
});

// ── the app-only rollback boundary (Mode (a) BLOCKER on PR #1901) ──────────
//
// A rollback ships no tree: `docker compose up -d` runs against the compose the
// LAST DEPLOY left on the box. A service the target predates is still declared
// there with a `build:` section, so Compose would rebuild it from the current
// on-box source under the rollback SHA and report success over the code being
// reverted. The crossing must be refused before any ssh.

const svc = (...names) => names.map((name) => ({ name }));

test("1896: rollback across equal service sets is allowed", () => {
  const verdict = rollbackBoundaryVerdict(
    svc("api", "portal", "admin", "doctor"),
    svc("api", "portal", "admin", "doctor"),
  );
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.extra, []);
  assert.equal(verdict.reason, null);
});

test("1896: rollback below a service introduction is refused, naming the extras", () => {
  // Live prod runs the doctor storefront (#1860); the target predates it.
  const verdict = rollbackBoundaryVerdict(
    svc("api", "portal", "admin", "doctor"),
    svc("api", "portal", "admin"),
  );
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.extra, ["doctor"]);
  assert.match(verdict.reason, /doctor/);
  assert.match(verdict.reason, /service-introduction boundary/);
  // The message must point at the sanctioned alternatives, not at a hack.
  assert.match(verdict.reason, /forward fix/);
  assert.match(verdict.reason, /--ref/);
});

test("1896: rollback to a tree declaring MORE services is allowed", () => {
  // A service removed between the target and prod leaves nothing on the box to
  // rebuild wrongly — the reverse direction is not a boundary crossing.
  const verdict = rollbackBoundaryVerdict(
    svc("api", "portal"),
    svc("api", "portal", "admin", "doctor"),
  );
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.extra, []);
});

test("1896: service names that would break the generated verify shell are rejected", () => {
  // A leading digit emits an invalid shell assignment (`3d_img=...`).
  const leadingDigit =
    'services:\n  3d:\n    image: ds-3d:${DEPLOY_SHA}\n    environment:\n      PORT: "3005"\n';
  assert.throws(() => deployServiceSet(leadingDigit), ServiceSetError);
  // `edge.web` and `edge-web` are distinct compose services but ONE shell variable -
  // without this guard the generated condition would compare `edge_web` twice and
  // silently never assert one of the two containers.
  const dotted = "services:\n  edge.web:\n    image: ds-edge-web:${DEPLOY_SHA}\n";
  assert.throws(() => deployServiceSet(dotted), ServiceSetError);
  assert.equal(shellVarName("sms-aero"), "sms_aero");
  // The real compose passes the guard.
  assert.ok(deployServiceSet(currentCompose).length > 0);
});
