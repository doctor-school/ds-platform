import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { AUDIT_PD_COLUMNS } from "../audit.js";
import { registrations } from "./registrations.js";

/**
 * 044 EARS-5 — the storage half of the congress answers column (044 design
 * §«Data model»).
 *
 * The column shape is a decision, not an incidental: it is nullable because the
 * platform-origin path (EARS-16, a signed-in doctor registering from the feed)
 * writes no answers at all, and the roster renders those rows from the
 * account's own profile. A NOT NULL column with a `{}` default would erase that
 * distinction and make every platform-origin row look like an empty answer
 * sheet — which is why nullability is pinned here rather than left to the
 * migration diff.
 */
describe("044 EARS-5: registrations.answers", () => {
  const columns = getTableConfig(registrations).columns;
  const answers = columns.find((column) => column.name === "answers");

  it("044 EARS-5.6: the registrations table carries an answers column", () => {
    expect(answers).toBeDefined();
  });

  it("044 EARS-5.7: the column is jsonb", () => {
    expect(answers?.getSQLType()).toBe("jsonb");
  });

  it("044 EARS-5.8: the column is nullable with no default — null is the platform-origin row", () => {
    expect(answers?.notNull).toBe(false);
    expect(answers?.hasDefault).toBe(false);
  });

  it("044 EARS-5.9: the existing registration columns are untouched", () => {
    expect(columns.map((column) => column.name).sort()).toEqual([
      "answers",
      "deleted_at",
      "event_id",
      "id",
      "record_status",
      "registered_at",
      "user_id",
    ]);
  });

  it("044 EARS-5.10: the answers payload is PD-masked in the edit-audit ledger", () => {
    // The answer sheet carries surname, patronymic, contact phone and email in
    // one jsonb value, so `registrations` crossed into PD-bearing the moment
    // the column landed (010-design §5, ADR-0009 §2.4). Without the registry
    // entry every edit of a registration would copy that payload into an
    // `audit_ledger` diff in the clear. SQL ⇄ TS agreement of this registry is
    // asserted by `apps/api/test/db/universal-edit-audit.e2e-spec.ts`.
    expect(AUDIT_PD_COLUMNS.registrations).toEqual(["answers"]);
    // The structural facts stay readable — masking them would erase the diff
    // without protecting anything.
    expect(AUDIT_PD_COLUMNS.registrations).not.toContain("user_id");
  });
});
