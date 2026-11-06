import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "@playwright/test";
import {
  feedEntryLog,
  feedEntryRoot,
  feedEntryTask,
  ownedFeedEntryDatabase,
} from "./feed-entry.js";

const require = createRequire(resolve(feedEntryRoot, "apps/api/package.json"));

/** Real, committed 018 fixture rows visible to the independently running API. */
export async function createPublicFeedStateFixture(specialtyId: string) {
  const database = ownedFeedEntryDatabase(
    process.env.E2E_FEED_ENTRY_DATABASE_URL ?? "",
    process.env.E2E_PUBLIC_READONLY === "1" ? 3785 : 3772,
  );
  const { Pool } = require("pg");
  const { drizzle } = require("drizzle-orm/node-postgres");
  const pool = new Pool({
    connectionString: database,
    application_name: `feed-states-${feedEntryTask()}-fixture`,
  });
  const client = await pool.connect();
  const own = randomUUID(),
    adjacent = randomUUID(),
    kind = randomUUID(),
    user = randomUUID();
  const events = ["hidden", "shown", "offline"].map((name, index) => ({
    name,
    id: randomUUID(),
    slug: `feed-state-${name}-${randomUUID()}`,
    title: `018 ${name} ${randomUUID()}`,
    index,
  }));
  async function query(sql: string, values: unknown[] = []) {
    feedEntryLog({ command: "SQL", database: new URL(database).pathname, sql });
    return client.query(sql, values);
  }
  const ids = events.map(({ id }) => id);
  async function cleanup() {
    try {
      await query("BEGIN");
      await query(
        "DELETE FROM registrations WHERE event_id=ANY($1::uuid[]) AND user_id=$2",
        [ids, user],
      );
      await query(
        "DELETE FROM event_directions WHERE event_id=ANY($1::uuid[]) AND direction_id=$2",
        [ids, own],
      );
      await query("DELETE FROM events WHERE id=ANY($1::uuid[])", [ids]);
      await query("DELETE FROM users WHERE id=$1", [user]);
      await query("DELETE FROM event_kinds WHERE id=$1", [kind]);
      await query(
        "DELETE FROM direction_adjacency WHERE direction_id=$1 AND adjacent_direction_id=$2",
        [own, adjacent],
      );
      await query(
        "DELETE FROM direction_specialties WHERE direction_id=$1 AND specialty_minzdrav_id=$2",
        [own, specialtyId],
      );
      await query("DELETE FROM directions WHERE id=ANY($1::uuid[])", [
        [own, adjacent],
      ]);
      await query("COMMIT");
      const remaining = (
        await query(
          "SELECT (SELECT count(*)::int FROM events WHERE id=ANY($1::uuid[])) AS events, (SELECT count(*)::int FROM directions WHERE id=ANY($2::uuid[])) AS directions, (SELECT count(*)::int FROM event_kinds WHERE id=$3) AS kinds, (SELECT count(*)::int FROM users WHERE id=$4) AS users",
          [ids, [own, adjacent], kind, user],
        )
      ).rows[0];
      expect(remaining).toEqual({
        events: 0,
        directions: 0,
        kinds: 0,
        users: 0,
      });
      feedEntryLog({
        command: "removed exact owned 018 fixture rows",
        ids,
        own,
        adjacent,
        kind,
        user,
      });
    } finally {
      client.release();
      await pool.end();
    }
  }
  try {
    const facts = (
      await query(
        "SELECT current_database() AS name, (SELECT count(*)::int FROM pg_stat_activity WHERE application_name=$1) AS api_connections",
        [`feed-entry-${feedEntryTask()}-api`],
      )
    ).rows[0];
    expect(`/${facts.name}`).toBe(new URL(database).pathname);
    expect(facts.api_connections).toBeGreaterThan(0);
    await query("BEGIN");
    await query(
      "INSERT INTO directions (id,slug,title,status,first_published_at) VALUES ($1,$2,'018 own','published',now()),($3,$4,'018 adjacent','published',now())",
      [own, `feed-own-${own}`, adjacent, `feed-adjacent-${adjacent}`],
    );
    await query(
      "INSERT INTO direction_specialties (direction_id,specialty_minzdrav_id) VALUES ($1,$2)",
      [own, specialtyId],
    );
    await query(
      "INSERT INTO direction_adjacency (direction_id,adjacent_direction_id,kind) VALUES ($1,$2,'related')",
      [own, adjacent],
    );
    await query(
      "INSERT INTO event_kinds (id,slug,title,allowed_formats,status,first_published_at) VALUES ($1,$2,'018 fixture event',ARRAY['online','offline']::event_participation_format[],'published',now())",
      [kind, `feed-kind-${kind}`],
    );
    await query(
      "INSERT INTO users (id,zitadel_sub,email,role) VALUES ($1,$2,$3,'doctor_guest')",
      [user, `fixture-${user}`, `fixture-${user}@example.test`],
    );
    for (const event of events) {
      await query(
        "INSERT INTO events (id,slug,title,school,starts_at,duration_min,state,kind_id,audience,participation_format,hide_sign_up_count) VALUES ($1,$2,$3,'018 fixture',now()+interval '1 hour'+$4*interval '1 minute',60,'published',$5,'doctors',$6,$7)",
        [
          event.id,
          event.slug,
          event.title,
          event.index,
          kind,
          event.name === "offline" ? "offline" : "online",
          event.name === "hidden",
        ],
      );
      await query(
        "INSERT INTO event_directions (event_id,direction_id) VALUES ($1,$2)",
        [event.id, own],
      );
      await query(
        "INSERT INTO registrations (event_id,user_id) VALUES ($1,$2)",
        [event.id, user],
      );
    }
    const { TargetingRepository } = await import(
      pathToFileURL(
        resolve(
          feedEntryRoot,
          "apps/api/dist/storefront/targeting.repository.js",
        ),
      ).href
    );
    const repository = new TargetingRepository(drizzle(client));
    expect(
      (await repository.findOwnDirections(specialtyId)).map(
        (row: { id: string }) => row.id,
      ),
    ).toContain(own);
    expect(await repository.findAdjacentDirections([own])).toEqual([
      expect.objectContaining({ id: adjacent, kind: "related" }),
    ]);
    await query("COMMIT");
    feedEntryLog({
      command: "committed real owned 018 fixture and owning targeting reads",
      events,
      own,
      adjacent,
      kind,
      user,
      apiConnections: facts.api_connections,
    });
    return { events, cleanup };
  } catch (error) {
    await query("ROLLBACK");
    client.release();
    await pool.end();
    throw error;
  }
}
