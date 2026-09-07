import { pathToFileURL } from "node:url";
import pg from "pg";

/**
 * Real branch-DB fixture phase for EARS-13. After seed:events and the present
 * browser run, end ONLY the six seed-owned live events, then run absent.
 * Restore present with the canonical seed:events command. This is test setup,
 * never a product lifecycle command. No shared/prod database is accepted.
 * Run: DATABASE_URL=<branch URL> node e2e/support/events-live-phase.mjs <issue>
 */
export function branchDatabase(connectionString, issue) {
  if (!/^[1-9]\d*$/.test(issue ?? ""))
    throw new Error("Expected numeric branch Issue ID");
  const expected = `ds_dev_${issue}`;
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.pathname.slice(1)) !== expected
  ) {
    throw new Error(`Refusing database other than ${expected}`);
  }
  return expected;
}

const slugs = [
  "seed-005-live",
  "seed-006-room-youtube",
  "seed-006-room-rutube",
  "seed-006-room-vk",
  "seed-006-room-cdnvideo",
  "seed-006-room-unavailable",
];

async function endLiveFixtures() {
  const expected = branchDatabase(process.env.DATABASE_URL, process.argv[2]);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const actual = await client.query("SELECT current_database() AS name");
    if (actual.rows[0].name !== expected)
      throw new Error("Connected database differs from requested branch");
    const fixtures = await client.query(
      "SELECT slug, state FROM events WHERE slug = ANY($1::text[]) FOR UPDATE",
      [slugs],
    );
    if (
      fixtures.rowCount !== slugs.length ||
      fixtures.rows.some(({ state }) => !["live", "ended"].includes(state))
    ) {
      throw new Error(
        "Expected all six seed:events live fixtures (live or already ended); run seed:events first",
      );
    }
    const result = await client.query(
      "UPDATE events SET state = 'ended', updated_at = now() WHERE slug = ANY($1::text[]) AND state = 'live' RETURNING slug",
      [slugs],
    );
    await client.query("COMMIT");
    process.stdout.write(
      `${JSON.stringify({ database: expected, phase: "absent", changed: result.rows.map(({ slug }) => slug) })}\n`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  endLiveFixtures().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
