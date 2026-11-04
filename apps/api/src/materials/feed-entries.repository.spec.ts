import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig } from "drizzle-orm/pg-core";
import { type DrizzleHandle, feedEntries } from "@ds/db";
import { publicFeedPageQuery } from "./feed-entries.repository.js";

// 048 V-6 (#3513) — the feed read is served from the feed-entry store joined
// only to the directory rows an entry references, never to `materials`.

describe("048 public feed read (V-6)", () => {
  // No connection: the suite only renders the SQL the builder would send.
  const db = drizzle.mock() as unknown as DrizzleHandle["db"];

  it("048 EARS-10: the feed read touches feed_entries, experts and organisations only — never materials", () => {
    for (const after of [
      null,
      { instant: "2026-10-30T10:00:00.123456Z", id: crypto.randomUUID() },
    ]) {
      const { sql } = publicFeedPageQuery(db, 13, after).toSQL();
      const tables = [...sql.matchAll(/(?:from|join)\s+"([a-z_]+)"/gi)].map(
        (m) => m[1],
      );
      expect(new Set(tables)).toEqual(
        new Set(["feed_entries", "experts", "organisations"]),
      );
      expect(sql).not.toMatch(/"materials"/);
    }
  });

  it("048 EARS-10: every feed entry names its source platform and its source record", () => {
    const columns = new Map(
      getTableConfig(feedEntries).columns.map((c) => [c.name, c.notNull]),
    );
    expect(columns.get("source_platform")).toBe(true);
    expect(columns.get("source_ref")).toBe(true);
    const unique = getTableConfig(feedEntries).indexes.find(
      (i) => i.config.name === "feed_entries_source_key",
    );
    expect(unique?.config.unique).toBe(true);
  });
});
