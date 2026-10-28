// tools/deploy/compose-logging.test.mjs — Issue #3386.
//
// The regression this locks: a container's json log grows without a bound when
// its compose service sets no `logging:` limit (2026-10-27: the stage Zitadel log
// reached 17.6 GB and its Postgres log 10.7 GB, pushing `ds-stage-1` under the
// release driver's 10 GB free-disk floor). Every service of every compose file
// under `infra/deploy/compose/` must carry a `json-file` log with both
// `max-size` and `max-file`. The files are discovered by walking the directory,
// so a new compose file or a new service without a bound goes red here.
//
// No exemption: `data-prod/compose.yml` is a PostgreSQL source-hash input, but the
// v2 hash leaves `logging` out (#3419, RUNTIME_ONLY_SERVICE_KEYS in
// tools/deploy/postgres-guard.mjs), so its bound needs no artifact certification.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import { parse } from "yaml";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const COMPOSE_ROOT = join(REPO_ROOT, "infra", "deploy", "compose");

/** Every `compose.yml` under `infra/deploy/compose/`, at any depth. */
function composeFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return composeFiles(path);
    return entry.name === "compose.yml" ? [path] : [];
  });
}

const files = composeFiles(COMPOSE_ROOT);

/** A size like `50m` / `1g`, in bytes — the json-file driver's own units. */
function sizeBytes(value) {
  const match = /^(\d+)([kmg]?)$/i.exec(String(value));
  assert.ok(match, `max-size ${JSON.stringify(value)} is not a json-file size`);
  const unit = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[
    match[2].toLowerCase()
  ];
  return Number(match[1]) * unit;
}

test("3386: the walk finds the five deploy compose files", () => {
  const found = files
    .map((f) => relative(COMPOSE_ROOT, f).replaceAll("\\", "/"))
    .sort();
  for (const expected of [
    "api-prod/compose.yml",
    "data-prod/compose.yml",
    "data-prod/glitchtip/compose.yml",
    "slot/compose.yml",
    "stg-infra/compose.yml",
  ]) {
    assert.ok(
      found.includes(expected),
      `${expected} not discovered (found: ${found.join(", ")})`,
    );
  }
});

for (const file of files) {
  const name = relative(COMPOSE_ROOT, file).replaceAll("\\", "/");
  const services = Object.entries(
    parse(readFileSync(file, "utf8"), { merge: true }).services ?? {},
  );

  test(`3386: ${name} declares services`, () => {
    assert.ok(services.length > 0, `${name} has no services`);
  });

  for (const [service, spec] of services) {
    test(`3386: ${name} ${service} has a bounded json-file log`, () => {
      const logging = spec?.logging;
      assert.ok(
        logging,
        `${name} ${service}: no logging block — its json log is unbounded`,
      );
      assert.equal(
        logging.driver,
        "json-file",
        `${name} ${service}: logging driver`,
      );
      const options = logging.options ?? {};
      assert.ok(options["max-size"], `${name} ${service}: no max-size`);
      assert.ok(options["max-file"], `${name} ${service}: no max-file`);
      const files = Number(options["max-file"]);
      assert.ok(
        Number.isInteger(files) && files >= 1,
        `${name} ${service}: max-file ${options["max-file"]}`,
      );
      // The bound per container: max-size × max-file. 256 MiB keeps the stage
      // box's whole service set (stg-infra + every live slot) well under its
      // 10 GB free-disk floor.
      assert.ok(
        sizeBytes(options["max-size"]) * files <= 256 * 1024 ** 2,
        `${name} ${service}: ${options["max-size"]} × ${files} exceeds 256 MiB`,
      );
    });
  }
}
