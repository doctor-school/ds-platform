// tools/deploy/postgres-source-pin.test.mjs — Issue #3418.
//
// The regression this locks: #3392 changed the bytes of
// `infra/deploy/compose/data-prod/compose.yml` (a log bound), which changed the
// PostgreSQL source hash (`postgresSourceHash`: the data compose + every file under
// `postgres/` and `pgbackrest/`). The Actions prod release runs the box-local
// driver (`prod.mjs --local`), which takes no `--postgres-artifacts`, so its
// `postgres-verify` refused the release on a hash it could not certify. This pin
// moves that refusal from the prod release to CI.
//
// The hash is read from COMMITTED bytes (`git show`), never the working tree: a
// Windows autocrlf checkout would otherwise disagree with CI.

import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { readPostgresTarget } from "./postgres-guard.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

/** The accepted source hash live on data-prod (adopted at 09c152b). */
const ACCEPTED_SOURCE_HASH =
  "e8656c8b6259847701dfae069a011ab878329bfc5b8adaa7724cd477318c0da4";

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
      "that certification (the log bound waiting on it: #3419).",
  );
});
