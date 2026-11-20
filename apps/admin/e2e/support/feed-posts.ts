import pg from "pg";

/**
 * 048 EARS-32 — the posts of a Telegram source on the stand database
 * (`DATABASE_URL` — the branch database locally, the job database in the
 * `admin-e2e` CI job). The stand's API has no bot token, so its update
 * poller never runs (048 EARS-24); these rows are exactly what the connector's writer
 * (`telegram/telegram.feed-source.ts`) stores for a text post — kind `post`,
 * `source_ref` `<source id>:<message id>`, the `t.me` permalink, the post's
 * date — whose mapping is proven against the Telegram double by the API e2e
 * (V-15). «Публикации» reads and writes them through the real admin routes.
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

export interface SeededPost {
  id: string;
  messageId: number;
  text: string;
}

/** One stored post per `[messageId, text, iso date]`, for the source at `address`. */
export async function seedTelegramPosts(
  address: string,
  posts: [number, string, string][],
): Promise<SeededPost[]> {
  return withClient(async (client) => {
    const source = await client.query<{ id: string }>(
      "SELECT id FROM feed_sources WHERE platform = 'telegram' AND address = $1",
      [address],
    );
    const sourceId = source.rows[0]?.id;
    if (!sourceId) throw new Error(`no Telegram source t.me/${address}`);
    const seeded: SeededPost[] = [];
    for (const [messageId, text, at] of posts) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO feed_entries
           (source_platform, source_ref, feed_source_id, kind, title, source_name, href, published_at)
         VALUES ('telegram', $1, $2, 'post', $3, 'BBM Academy · Telegram', $4, $5::timestamptz)
         RETURNING id`,
        [
          `${sourceId}:${messageId}`,
          sourceId,
          text,
          `https://t.me/${address}/${messageId}`,
          at,
        ],
      );
      seeded.push({ id: rows[0]!.id, messageId, text });
    }
    return seeded;
  });
}

/**
 * An edit of the post arriving from the channel, as the connector applies it
 * (EARS-28): the text rewritten in place, `updated_at` moved — so a hide or
 * unhide issued against the row as listed before it is refused.
 */
export async function editTelegramPost(
  entryId: string,
  text: string,
): Promise<void> {
  await withClient(async (client) => {
    const res = await client.query(
      "UPDATE feed_entries SET title = $2, updated_at = now() WHERE id = $1 AND source_platform = 'telegram'",
      [entryId, text],
    );
    if (res.rowCount !== 1) throw new Error(`no Telegram entry ${entryId}`);
  });
}

/** The stored `hidden_at` of one entry (`null` while it is in the feed). */
export async function hiddenAt(entryId: string): Promise<Date | null> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ hidden_at: Date | null }>(
      "SELECT hidden_at FROM feed_entries WHERE id = $1",
      [entryId],
    );
    if (!rows[0]) throw new Error(`no entry ${entryId}`);
    return rows[0].hidden_at;
  });
}

/** Remove the seeded posts (the source row stays, as the source suite leaves it). */
export async function removeTelegramPosts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withClient(async (client) => {
    await client.query("DELETE FROM feed_entries WHERE id = ANY($1::uuid[])", [
      ids,
    ]);
  });
}

export interface RailPost {
  messageId: number;
  text: string;
  /** ISO instant of the post. */
  at: string;
  /** The copied preview's media key (`preview_state` `done`), or none. */
  imageRef?: string;
  /** A video's duration in seconds. */
  durationSeconds?: number;
  /** Hidden from the feed by an administrator (EARS-32). */
  hidden?: boolean;
}

/**
 * 048 EARS-33 / EARS-35 — a Telegram source of its own for a rail spec, with
 * its posts stored as the connector stores them (preview key once copied,
 * video duration, the `t.me` permalink). `failing` is the state the hourly
 * check leaves an unreachable Telegram in (EARS-31); `enabled = false` is a
 * switched-off source, mirrored onto its entries as `source_off` (EARS-22).
 */
export async function seedTelegramRailSource(
  address: string,
  options: { enabled: boolean; failing: boolean },
  posts: RailPost[],
): Promise<{ sourceId: string; entryIds: string[] }> {
  return withClient(async (client) => {
    const source = await client.query<{ id: string }>(
      `INSERT INTO feed_sources (platform, address, enabled, status, status_reason, checked_at)
       VALUES ('telegram', $1, $2, $3, $4, now())
       RETURNING id`,
      [
        address,
        options.enabled,
        options.failing ? "failing" : "ok",
        options.failing ? "Telegram недоступен" : null,
      ],
    );
    const sourceId = source.rows[0]!.id;
    const entryIds: string[] = [];
    for (const post of posts) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO feed_entries
           (source_platform, source_ref, feed_source_id, kind, title, source_name, href,
            published_at, image_ref, duration_seconds, preview_state, source_off, hidden_at)
         VALUES ('telegram', $1, $2, 'post', $3, 'BBM Academy · Telegram', $4,
            $5::timestamptz, $6, $7, $8, $9, $10::timestamptz)
         RETURNING id`,
        [
          `${sourceId}:${post.messageId}`,
          sourceId,
          post.text,
          `https://t.me/${address}/${post.messageId}`,
          post.at,
          post.imageRef ?? null,
          post.durationSeconds ?? null,
          post.imageRef ? "done" : null,
          !options.enabled,
          post.hidden ? new Date().toISOString() : null,
        ],
      );
      entryIds.push(rows[0]!.id);
    }
    return { sourceId, entryIds };
  });
}

/** Remove a rail spec's sources together with every entry they brought in. */
export async function removeTelegramRailSources(
  sourceIds: string[],
): Promise<void> {
  if (sourceIds.length === 0) return;
  await withClient(async (client) => {
    await client.query(
      "DELETE FROM feed_entries WHERE feed_source_id = ANY($1::uuid[])",
      [sourceIds],
    );
    await client.query("DELETE FROM feed_sources WHERE id = ANY($1::uuid[])", [
      sourceIds,
    ]);
  });
}
