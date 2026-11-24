import pg from "pg";

/**
 * 048 EARS-38 / EARS-44 / EARS-47 — VK sources and their entries on the stand
 * database (`DATABASE_URL`: the branch database locally, the job database in
 * the `admin-e2e` CI job). The stand's API has no VK connector configured, so
 * its check reads «VK не подключён на сервере» and no Callback, reconcile or
 * VK call ever runs; these rows are exactly what the connector stores
 * (`apps/api/src/materials/vk/vk.feed-source.ts`) — a bound community id, a
 * check verdict, `post` / `video` entries with `source_ref`
 * `<source id>:<kind>:<object id>`, their object keys, the VK permalink, the
 * removed mark the wall reconcile sets, and the month's call count — whose
 * mapping is proven against the VK double by the API e2e (V-25…V-30).
 * «Источники» and «Публикации» read and write them through the real routes.
 */
async function withClient<T>(run: (client: pg.Client) => Promise<T>) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("E2E requires DATABASE_URL in the environment");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** A unique positive VK community id per seeded source. */
let nextGroupId = 900_000_000 + (Date.now() % 10_000_000);

export interface SeededVkSource {
  id: string;
  address: string;
  groupId: number;
}

/**
 * A checked, bound VK source: `reason` null reads «Работает», a reason reads
 * «Ошибка: <reason>» (the EARS-44 verdict as the hourly check writes it).
 */
export async function seedVkSource(
  address: string,
  options: { reason: string | null; enabled?: boolean },
): Promise<SeededVkSource> {
  const groupId = nextGroupId++;
  return withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO feed_sources (platform, address, enabled, status, status_reason, checked_at, vk_group_id)
       VALUES ('vk', $1, $2, $3, $4, now(), $5)
       RETURNING id`,
      [
        address,
        options.enabled ?? true,
        options.reason ? "failing" : "ok",
        options.reason,
        groupId,
      ],
    );
    return { id: rows[0]!.id, address, groupId };
  });
}

export interface VkEntry {
  kind: "post" | "video";
  objectId: number;
  text: string;
  /** ISO instant of the publication. */
  at: string;
  /** The wall reconcile found the post gone (EARS-45). */
  removed?: boolean;
}

/** The entries of a seeded VK source, stored as the connector writes them. */
export async function seedVkEntries(
  source: SeededVkSource,
  entries: VkEntry[],
): Promise<string[]> {
  return withClient(async (client) => {
    const ids: string[] = [];
    for (const entry of entries) {
      const href =
        entry.kind === "post"
          ? `https://vk.com/wall-${source.groupId}_${entry.objectId}`
          : `https://vk.com/video-${source.groupId}_${entry.objectId}`;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO feed_entries
           (source_platform, source_ref, feed_source_id, kind, title, source_name, href,
            published_at, duration_seconds, removed_at)
         VALUES ('vk', $1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9::timestamptz)
         RETURNING id`,
        [
          `${source.id}:${source.groupId}:${entry.kind}:${entry.objectId}`,
          source.id,
          entry.kind,
          entry.text,
          entry.kind === "post" ? "BBM Academy · VK" : "BBM Academy · VK Видео",
          href,
          entry.at,
          entry.kind === "video" ? 95 : null,
          entry.removed ? new Date().toISOString() : null,
        ],
      );
      const id = rows[0]!.id;
      await client.query(
        `INSERT INTO feed_entry_vk_objects (feed_source_id, vk_group_id, object_kind, vk_object_id, feed_entry_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [source.id, source.groupId, entry.kind, entry.objectId, id],
      );
      ids.push(id);
    }
    return ids;
  });
}

/**
 * Set the current Moscow month's VK call count; answers the count it
 * replaced (`null`: the month had no row), for {@link restoreVkCallsThisMonth}.
 */
export async function setVkCallsThisMonth(
  calls: number,
): Promise<number | null> {
  return withClient(async (client) => {
    const month = `date_trunc('month', now() AT TIME ZONE 'Europe/Moscow')::date`;
    const before = await client.query<{ calls: number }>(
      `SELECT calls FROM feed_vk_call_months WHERE month = ${month}`,
    );
    await client.query(
      `INSERT INTO feed_vk_call_months (month, calls) VALUES (${month}, $1)
       ON CONFLICT (month) DO UPDATE SET calls = EXCLUDED.calls, updated_at = now()`,
      [calls],
    );
    return before.rows[0]?.calls ?? null;
  });
}

export async function restoreVkCallsThisMonth(
  previous: number | null,
): Promise<void> {
  await withClient(async (client) => {
    const month = `date_trunc('month', now() AT TIME ZONE 'Europe/Moscow')::date`;
    if (previous === null) {
      await client.query(
        `DELETE FROM feed_vk_call_months WHERE month = ${month}`,
      );
    } else {
      await client.query(
        `UPDATE feed_vk_call_months SET calls = $1 WHERE month = ${month}`,
        [previous],
      );
    }
  });
}

/** The stored `hidden_at` of one entry (`null` while it is in the feed). */
export async function vkHiddenAt(entryId: string): Promise<Date | null> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ hidden_at: Date | null }>(
      "SELECT hidden_at FROM feed_entries WHERE id = $1 AND source_platform = 'vk'",
      [entryId],
    );
    if (!rows[0]) throw new Error(`no VK entry ${entryId}`);
    return rows[0].hidden_at;
  });
}

/**
 * Remove VK sources by address with every entry they hold (the admin has no
 * delete route; a run leaves the database as it found it).
 */
export async function removeVkSources(addresses: string[]): Promise<void> {
  if (addresses.length === 0) return;
  await withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM feed_sources WHERE platform = 'vk' AND address = ANY($1::text[])",
      [addresses],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    await client.query(
      "DELETE FROM feed_entries WHERE feed_source_id = ANY($1::uuid[])",
      [ids],
    );
    await client.query(
      "DELETE FROM feed_entry_vk_objects WHERE feed_source_id = ANY($1::uuid[])",
      [ids],
    );
    await client.query("DELETE FROM feed_sources WHERE id = ANY($1::uuid[])", [
      ids,
    ]);
  });
}
