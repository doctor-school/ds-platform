import pg from "pg";

/**
 * 048 EARS-32 — the posts of a Telegram source on the stand database
 * (`DATABASE_URL` — the branch database locally, the job database in the
 * `admin-e2e` CI job). The stand's API has no bot connected, so no update
 * ever reaches its webhook; these rows are exactly what the connector's writer
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
