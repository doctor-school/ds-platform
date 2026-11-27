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
 * pg_partman and both bases by digest (#3992), archive to repo1 alone and spool WAL for
 * each offsite repo (#4298), and carry repo2's tunnel to IDrive (#4287: the sidecar's
 * openssh-client and its tunnel network, the repo2-tunnel service in its own compose
 * profile), certified by postgres-artifact.yml before the release that ships them.
 */
const ACCEPTED_SOURCE_HASH =
  "d3bc46e7412a71cd63cec83051ac34ba332fe36e56d4d7b7db3e2351895c7692";

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
