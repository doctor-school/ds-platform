// tools/deploy/postgres-source-pin.test.mjs — Issues #3418, #3419.
//
// The regression this locks: #3392 changed the bytes of
// `infra/deploy/compose/data-prod/compose.yml` (a log bound), which changed the
// PostgreSQL source hash, and the Actions prod release — the box-local driver
// (`prod.mjs --local`), which takes no `--postgres-artifacts` — refused at
// `postgres-verify` on a hash it could not certify. The hash is v2 since #3419
// (`postgresSourceHash`: the data compose without its runtime-only service keys +
// every file under `postgres/` and `pgbackrest/`), so a log bound no longer moves
// it; an image/cluster input still does. This pin moves that refusal to CI.
//
// The hash is read from COMMITTED bytes (`git show`), never the working tree: a
// Windows autocrlf checkout would otherwise disagree with CI.

import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { readPostgresTarget } from "./postgres-guard.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

/**
 * The accepted v2 source hash: the v2 of the data-prod images that pin pgBackRest 2.60.0,
 * pg_partman and both bases by digest (#3992), certified by postgres-artifact-prepare.mjs
 * on the approved build host. Until the certified break-glass release ships them, the
 * record on data-prod holds the previous hash and Actions releases refuse at
 * postgres-verify.
 */
const ACCEPTED_SOURCE_HASH =
  "a8d1460e9231a32969a55ef5bc7cc78b18527866dc52968a1a95439851e1e390";

test("3418: the committed data-prod postgres source hash is the accepted one", () => {
  const { sourceHash } = readPostgresTarget("HEAD", REPO_ROOT);
  assert.equal(
    sourceHash,
    ACCEPTED_SOURCE_HASH,
    "The committed data-prod postgres source changed (infra/deploy/compose/data-prod/" +
      "compose.yml or a file under postgres/ / pgbackrest/). The Actions release path " +
      "(prod.mjs --local) cannot certify a changed data input and refuses at " +
      "postgres-verify. A change needs postgres-artifact-prepare.mjs + break-glass " +
      "`pnpm deploy:prod --postgres-artifacts <certificate.json>` (tools/deploy/" +
      "README.md → PostgreSQL deployment guard); update this pin only together with " +
      "that certification.",
  );
});
