// tools/deploy/postgres-source-pin.test.mjs — Issues #3418, #3419, #4089.
//
// The regression this locks: #3392 changed the bytes of
// `infra/deploy/compose/data-prod/compose.yml` (a log bound), which changed the
// PostgreSQL source hash, and the release refused at `postgres-verify` on a hash
// nobody had certified. The hash is v2 since #3419 (`postgresSourceHash`: the data
// compose without its runtime-only service keys + every file under `postgres/` and
// `pgbackrest/`), so a log bound no longer moves it; an image/cluster input still
// does. Since #4089 a changed input ships through Actions (postgres-artifact.yml
// certifies it, deploy-prod.yml delivers the certificate), and this pin keeps the
// change deliberate: it moves only in the PR that changes the input.
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
 * pg_partman and both bases by digest (#3992) and carry the offsite-repo include and
 * async WAL spool (#3670), certified by postgres-artifact.yml before the release that
 * ships them.
 */
const ACCEPTED_SOURCE_HASH =
  "9331f8e4518c2fd0d459f1c00c90870d87f57be6317eaed7b10f419031dcc66f";

test("3418: the committed data-prod postgres source hash is the accepted one", () => {
  const { sourceHash } = readPostgresTarget("HEAD", REPO_ROOT);
  assert.equal(
    sourceHash,
    ACCEPTED_SOURCE_HASH,
    "The committed data-prod postgres source changed (infra/deploy/compose/data-prod/" +
      "compose.yml or a file under postgres/ / pgbackrest/). A changed data input " +
      "recreates the production database containers: its merge runs " +
      "postgres-artifact.yml, which certifies the images, and the release delivers " +
      "that certificate (tools/deploy/README.md → PostgreSQL deployment guard). " +
      "Update this pin in the PR that changes the input.",
  );
});
