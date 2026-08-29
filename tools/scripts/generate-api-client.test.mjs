import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  reconcileGeneratedFiles,
  stableJson,
} from "./generate-api-client-lib.mjs";

test("#1618: OpenAPI serialization is byte-stable regardless of object key order", () => {
  const first = stableJson({
    paths: { "/z": {}, "/a": {} },
    info: { version: "1", title: "API" },
  });
  const second = stableJson({
    info: { title: "API", version: "1" },
    paths: { "/a": {}, "/z": {} },
  });

  assert.equal(first, second);
  assert.equal(first.endsWith("\n"), true);
});

test("#1618: --check rejects each stale artifact without changing tracked output", async () => {
  for (const staleName of ["openapi.snapshot.json", "types.generated.ts"]) {
    const directory = await mkdtemp(join(tmpdir(), "ds-api-client-check-"));
    const snapshotPath = join(directory, "openapi.snapshot.json");
    const sdkPath = join(directory, "types.generated.ts");
    const expected = new Map([
      [snapshotPath, "new snapshot\n"],
      [sdkPath, "new sdk\n"],
    ]);
    for (const [path, contents] of expected) {
      await writeFile(
        path,
        path.endsWith(staleName) ? `stale ${contents}` : contents,
      );
    }
    const before = new Map();
    for (const path of expected.keys()) {
      before.set(path, await readFile(path, "utf8"));
    }

    await assert.rejects(
      reconcileGeneratedFiles(expected, { check: true }),
      new RegExp(staleName.replace(".", "\\.")),
    );
    for (const path of expected.keys()) {
      assert.equal(await readFile(path, "utf8"), before.get(path));
    }
  }
});

test("#1618: generation writes both artifacts and a second run is deterministic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ds-api-client-write-"));
  const snapshotPath = join(directory, "openapi.snapshot.json");
  const sdkPath = join(directory, "types.generated.ts");
  const outputs = new Map([
    [snapshotPath, "snapshot\n"],
    [sdkPath, "sdk\n"],
  ]);

  await reconcileGeneratedFiles(outputs, { check: false });
  const first = [
    await readFile(snapshotPath, "utf8"),
    await readFile(sdkPath, "utf8"),
  ];
  await reconcileGeneratedFiles(outputs, { check: false });
  const second = [
    await readFile(snapshotPath, "utf8"),
    await readFile(sdkPath, "utf8"),
  ];

  assert.deepEqual(second, first);
});
