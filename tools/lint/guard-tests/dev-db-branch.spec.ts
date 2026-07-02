import { describe, expect, it } from "vitest";

import {
  branchDbName,
  branchDatabaseUrl,
  assertDroppableDbName,
} from "../../dev/run.mjs";

/**
 * Unit cover for the #428 per-branch DB seams in `tools/dev/run.mjs`
 * (`dev:db:branch` / `dev:db:drop`). Pure seams only — name derivation, URL
 * swap, and the drop-safety gate. The impure half (compose exec psql, the
 * migrate wrapper) runs against the live stand and is verified there.
 *
 * Importing run.mjs must NOT fire its CLI (the INVOKED-guard pattern shared
 * with task-worktree.mjs / pr-preflight.mjs) — this suite existing at all pins
 * that contract.
 */
describe("db-branch branchDbName()", () => {
  it("derives ds_dev_<n> from an issue number", () => {
    expect(branchDbName("428")).toBe("ds_dev_428");
  });

  it("lowercases and folds dashes to underscores for a slug", () => {
    expect(branchDbName("Feat-428-Ports")).toBe("ds_dev_feat_428_ports");
  });

  it("passes an already-derived ds_dev_* name through unchanged", () => {
    expect(branchDbName("ds_dev_428")).toBe("ds_dev_428");
  });

  it("rejects anything that does not reduce to [a-z0-9_]", () => {
    expect(() => branchDbName("４２８; DROP TABLE")).toThrow();
    expect(() => branchDbName("")).toThrow();
    expect(() => branchDbName("../etc")).toThrow();
  });
});

describe("db-branch branchDatabaseUrl()", () => {
  it("swaps ONLY the database path of the recipe URL", () => {
    expect(
      branchDatabaseUrl("postgres://ds:devpw@truenas.local:5442/ds_dev", "ds_dev_428"),
    ).toBe("postgres://ds:devpw@truenas.local:5442/ds_dev_428");
  });

  it("preserves query params (e.g. sslmode)", () => {
    expect(
      branchDatabaseUrl(
        "postgres://ds:pw@host:5442/ds_dev?sslmode=disable",
        "ds_dev_x",
      ),
    ).toBe("postgres://ds:pw@host:5442/ds_dev_x?sslmode=disable");
  });

  it("throws on an unparsable base URL", () => {
    expect(() => branchDatabaseUrl("not a url", "ds_dev_x")).toThrow();
  });
});

describe("db-branch assertDroppableDbName()", () => {
  it("accepts a derived branch database", () => {
    expect(() => assertDroppableDbName("ds_dev_428")).not.toThrow();
  });

  it("refuses the shared ds_dev itself", () => {
    expect(() => assertDroppableDbName("ds_dev")).toThrow();
  });

  it("refuses anything outside the ds_dev_* namespace", () => {
    expect(() => assertDroppableDbName("postgres")).toThrow();
    expect(() => assertDroppableDbName("zitadel")).toThrow();
    expect(() => assertDroppableDbName("ds_dev_")).toThrow();
  });
});
