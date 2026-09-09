import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildSpecialtyBookSeed,
  seedSpecialtiesMinzdrav,
  type SpecialtyBookInsertRow,
  type SpecialtyBookSeedRow,
} from "./specialties-minzdrav.js";
import { specialtyIdFromCode } from "./specialty-id.js";

const dialect = new PgDialect();
const render = (value: unknown): string =>
  dialect.sqlToQuery(value as never).sql;
const renderParams = (value: unknown): unknown[] =>
  dialect.sqlToQuery(value as never).params;

interface Captured {
  clearWhere: string;
  inserted: SpecialtyBookInsertRow[];
  set: Record<string, unknown>;
}

/**
 * Records the two statements the seed issues without touching a database: the
 * assertions below are about the SQL the seed GENERATES, which is precisely
 * where the spurious `updated_at` write lived.
 */
function capturingExecutor(): { captured: Captured; db: never } {
  const captured: Captured = {
    clearWhere: "",
    inserted: [],
    set: {},
  };
  const db = {
    update: () => ({
      set: () => ({
        where: (condition: unknown) => {
          captured.clearWhere = render(condition);
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: (rows: SpecialtyBookInsertRow[]) => {
        captured.inserted = rows;
        return {
          onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
            captured.set = config.set;
            return Promise.resolve();
          },
        };
      },
    }),
  };
  return { captured, db: db as never };
}

const ROWS: SpecialtyBookSeedRow[] = [
  {
    id: specialtyIdFromCode("kardiologiya"),
    code: "kardiologiya",
    name: "Кардиология",
    isOther: false,
    frequentRank: 1,
  },
  {
    id: specialtyIdFromCode("nevrologiya"),
    code: "nevrologiya",
    name: "Неврология",
    isOther: false,
    frequentRank: 2,
  },
  {
    id: specialtyIdFromCode("drugoe"),
    code: "drugoe",
    name: "Другое",
    isOther: true,
    frequentRank: null,
  },
];

describe("#2063 deterministic specialty book ids", () => {
  it("derives the id from the code alone, identically on every call", () => {
    expect(specialtyIdFromCode("kardiologiya")).toBe(
      specialtyIdFromCode("kardiologiya"),
    );
    expect(specialtyIdFromCode("kardiologiya")).not.toBe(
      specialtyIdFromCode("nevrologiya"),
    );
  });

  it("is a well-formed RFC-4122 v5 UUID", () => {
    expect(specialtyIdFromCode("kardiologiya")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("is frozen: the derivation is persisted identity, not a detail", () => {
    // A change here re-identifies every book row on a fresh insert and breaks
    // the byte-equality of two `ds_golden` builds against each other.
    expect(specialtyIdFromCode("kardiologiya")).toBe(
      "2f8ffff5-51f6-5649-899f-9a659006bd76",
    );
  });

  it("rejects an empty code rather than deriving a shared id", () => {
    expect(() => specialtyIdFromCode("")).toThrow();
  });

  it("gives every row of the real book a distinct derived id", () => {
    const book = buildSpecialtyBookSeed();
    expect(book.length).toBeGreaterThan(0);
    for (const row of book) {
      expect(row.id).toBe(specialtyIdFromCode(row.code));
    }
    expect(new Set(book.map((row) => row.id)).size).toBe(book.length);
  });
});

describe("#2063 the book upsert does not write on an unchanged re-seed", () => {
  it("inserts the derived id", async () => {
    const { captured, db } = capturingExecutor();
    await seedSpecialtiesMinzdrav(db, { rows: ROWS });
    expect(captured.inserted.map((row) => row.id)).toEqual(
      ROWS.map((row) => row.id),
    );
  });

  it("never rewrites the id of a row that already exists", async () => {
    const { captured, db } = capturingExecutor();
    await seedSpecialtiesMinzdrav(db, { rows: ROWS });
    expect(Object.keys(captured.set).sort()).toEqual([
      "frequentRank",
      "isOther",
      "name",
      "updatedAt",
    ]);
  });

  it("moves updated_at only when a tracked column actually differs", async () => {
    const { captured, db } = capturingExecutor();
    await seedSpecialtiesMinzdrav(db, { rows: ROWS });
    const updatedAt = render(captured.set.updatedAt).toLowerCase();
    expect(updatedAt).toContain("is distinct from");
    expect(updatedAt).toContain("excluded.name");
    expect(updatedAt).toContain("excluded.is_other");
    expect(updatedAt).toContain("excluded.frequent_rank");
    // The «unchanged» arm keeps the stored value instead of stamping a new one.
    expect(updatedAt).toContain('else "specialties_minzdrav"."updated_at"');
  });

  it("releases only the frequent ranks that are actually moving", async () => {
    const { captured, db } = capturingExecutor();
    await seedSpecialtiesMinzdrav(db, { rows: ROWS });
    const where = captured.clearWhere.toLowerCase();
    expect(where).toContain("is not null");
    expect(where).toContain("not in");
    // A row that keeps the rank it already holds is excluded from the clear,
    // so an unchanged re-seed clears nothing and the conflict branch sees no
    // change in `frequent_rank`.
    expect(where).toContain(
      '("specialties_minzdrav"."code", "specialties_minzdrav"."frequent_rank") not in',
    );
  });

  it("clears every ranked row when the book carries no frequent set", async () => {
    const { captured, db } = capturingExecutor();
    await seedSpecialtiesMinzdrav(db, {
      rows: ROWS.map((row) => ({ ...row, frequentRank: null })),
    });
    expect(captured.clearWhere.toLowerCase()).not.toContain("not in");
  });
});

describe("#2063 pinned timestamps for the golden template", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");

  it("stamps the pinned instant on the inserted rows", async () => {
    const { captured, db } = capturingExecutor();
    await seedSpecialtiesMinzdrav(db, { rows: ROWS, now });
    for (const row of captured.inserted) {
      expect(row.createdAt).toEqual(now);
      expect(row.updatedAt).toEqual(now);
    }
    expect(render(captured.set.updatedAt)).toContain("::timestamptz");
    expect(renderParams(captured.set.updatedAt)).toContain(
      "2026-01-15T12:00:00.000Z",
    );
  });

  it("leaves the API boot path on the database clock when no pin is given", async () => {
    const { captured, db } = capturingExecutor();
    await seedSpecialtiesMinzdrav(db, { rows: ROWS });
    for (const row of captured.inserted) {
      expect(row.createdAt).toBeUndefined();
      expect(row.updatedAt).toBeUndefined();
    }
    expect(render(captured.set.updatedAt).toLowerCase()).toContain("now()");
  });
});
