import { createDrizzle, eventRecordings, events } from "@ds/db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedEvents } from "../../scripts/seed-events.js";

// #1851 — `seed:events` is idempotent, and that is a property of the SCRIPT, not
// of a lucky first run: the fixture's published recording sits on a row whose
// `first_published_at` is write-once (021 invariant, enforced by a trigger), so a
// second run that re-sent a fresh instant aborted the whole seed and left the
// `seed-006-*` fixtures stale. This suite drives the real script twice against
// the real database — the only shape that reproduces the failure.
describe("scripts/seed-events (#1851)", () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — the e2e harness injects it.");
  }
  const { pool, db } = createDrizzle(connectionString);

  const ARCHIVE_SLUG = "seed-006-legacy-archived";

  async function readRecording(): Promise<{
    id: string;
    firstPublishedAt: Date | null;
    updatedAt: Date | null;
  }> {
    const [row] = await db
      .select({
        id: eventRecordings.id,
        firstPublishedAt: eventRecordings.firstPublishedAt,
        updatedAt: eventRecordings.updatedAt,
      })
      .from(eventRecordings)
      .innerJoin(events, eq(events.id, eventRecordings.eventId))
      .where(
        and(eq(events.slug, ARCHIVE_SLUG), isNull(eventRecordings.deletedAt)),
      );
    expect(row, `no non-retired recording for ${ARCHIVE_SLUG}`).toBeDefined();
    return row as {
      id: string;
      firstPublishedAt: Date | null;
      updatedAt: Date | null;
    };
  }

  beforeAll(async () => {
    await seedEvents();
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  it("a second run succeeds and keeps the recording's first_published_at", async () => {
    const before = await readRecording();
    expect(before.firstPublishedAt).not.toBeNull();

    // The second run is the regression: before the fix it threw
    // `first_published_at is set once and cannot be cleared or changed`.
    await expect(seedEvents()).resolves.toBeUndefined();

    const after = await readRecording();
    expect(after.id).toBe(before.id);
    expect(after.firstPublishedAt?.getTime()).toBe(
      before.firstPublishedAt?.getTime(),
    );
    // The re-run still refreshes the row it owns — idempotent means "converges",
    // not "stops writing".
    expect(after.updatedAt).not.toBeNull();
  }, 60_000);
});
