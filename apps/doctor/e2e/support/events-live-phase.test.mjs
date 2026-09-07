import { strict as assert } from "node:assert";
import { test } from "node:test";
import { branchDatabase } from "./events-live-phase.mjs";

test("EARS-13: lifecycle fixture refuses shared, production and foreign branch databases", () => {
  for (const database of [
    "ds_dev",
    "production",
    "ds_dev_999",
    "ds_dev_1528_extra",
  ]) {
    assert.throws(() =>
      branchDatabase(`postgres://localhost/${database}`, "1528"),
    );
  }
  assert.throws(() =>
    branchDatabase("postgres://localhost/ds_dev_1528", "1528;"),
  );
  assert.equal(
    branchDatabase("postgres://localhost/ds_dev_1528", "1528"),
    "ds_dev_1528",
  );
});
