import { expect } from "@playwright/test";
import { connection } from "./public-readonly-fixture.js";
import { feedEntryLog } from "./feed-entry.js";

export async function createRecordFormFixture() {
  const db = await connection(3797);
  const directions: string[] = [];
  const edges: string[] = [];
  return {
    directions,
    edges,
    own(kind: "direction" | "edge", id: string) {
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      (kind === "direction" ? directions : edges).push(id);
      feedEntryLog({
        command: "record exact API-created record ownership",
        kind,
        id,
      });
    },
    async edge(id: string) {
      expect(edges).toContain(id);
      const result = await db.query(
        "SELECT * FROM direction_adjacency WHERE id=$1",
        [id],
      );
      expect(result.rows).toHaveLength(1);
      return result.rows[0] as Record<string, unknown>;
    },
    async cleanup() {
      try {
        await db.query(
          "DELETE FROM direction_adjacency WHERE id=ANY($1::uuid[])",
          [edges],
        );
        await db.query("DELETE FROM directions WHERE id=ANY($1::uuid[])", [
          directions,
        ]);
        for (const [table, ids] of [
          ["direction_adjacency", edges],
          ["directions", directions],
        ] as const) {
          const result = await db.query(
            `SELECT count(*)::int AS count FROM ${table} WHERE id=ANY($1::uuid[])`,
            [ids],
          );
          expect(result.rows[0].count).toBe(0);
        }
        feedEntryLog({
          command: "removed exact record fixture and verified absence",
          directions,
          edges,
        });
      } finally {
        await db.close();
      }
    },
  };
}
