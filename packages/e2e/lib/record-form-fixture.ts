import { expect } from "@playwright/test";
import { connection } from "./public-readonly-fixture.js";
import { feedEntryLog } from "./feed-entry.js";

export async function createRecordFormFixture(task: 3797 | 3804 = 3797) {
  const db = await connection(task);
  const directions: string[] = [];
  const edges: string[] = [];
  const links: string[] = [];
  const owned = { direction: directions, edge: edges, link: links };
  const tables = {
    direction: "directions",
    edge: "direction_adjacency",
    link: "direction_specialties",
  };
  return {
    directions,
    edges,
    links,
    own(kind: "direction" | "edge" | "link", id: string) {
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      owned[kind].push(id);
      feedEntryLog({
        command: "record exact API-created record ownership",
        kind,
        id,
      });
    },
    async row(kind: keyof typeof owned, id: string) {
      expect(owned[kind]).toContain(id);
      const result = await db.query(
        `SELECT * FROM ${tables[kind]} WHERE id=$1`,
        [id],
      );
      expect(result.rows).toHaveLength(1);
      return result.rows[0] as Record<string, unknown>;
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
          "DELETE FROM direction_specialties WHERE id=ANY($1::uuid[])",
          [links],
        );
        await db.query(
          "DELETE FROM direction_adjacency WHERE id=ANY($1::uuid[])",
          [edges],
        );
        await db.query("DELETE FROM directions WHERE id=ANY($1::uuid[])", [
          directions,
        ]);
        for (const [table, ids] of [
          ["direction_specialties", links],
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
          links,
        });
      } finally {
        await db.close();
      }
    },
  };
}
