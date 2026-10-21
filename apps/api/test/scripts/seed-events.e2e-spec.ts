import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDrizzle, eventRecordings, events } from "@ds/db";
import { SEED_EVENT_KINDS } from "@ds/db/seed/golden";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SEED_CONGRESS_EVENT_ID,
  SEED_CONGRESS_EVENT_SLUG,
  seedEvents,
} from "../../scripts/seed-events.js";

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

  // #3149 — the dev stand's `CONGRESS_SIGNUP_EVENT_ID` (infra/dev-stand/.env.example)
  // names the congress fixture by a FIXED id, so every stand database the seed
  // ran on answers the same key: the intake's EARS-5 «configured event exists
  // and is registrable» holds without a per-database id lookup.
  it("044 EARS-5: the congress fixture is a registrable «Конгресс» for doctors under the fixed id the stand contract names", async () => {
    const [row] = await db
      .select({
        id: events.id,
        state: events.state,
        kindId: events.kindId,
        audience: events.audience,
        participationFormat: events.participationFormat,
        startsAt: events.startsAt,
        venue: events.venue,
      })
      .from(events)
      .where(eq(events.slug, SEED_CONGRESS_EVENT_SLUG));
    expect(row).toBeDefined();
    expect(row!.id).toBe(SEED_CONGRESS_EVENT_ID);
    expect(row!.state).toBe("published");
    expect(row!.kindId).toBe(SEED_EVENT_KINDS.kongress.id);
    expect(row!.audience).toBe("doctors");
    expect(row!.participationFormat).toBe("offline");
    expect(row!.startsAt.getTime()).toBeGreaterThan(Date.now());
    expect(row!.venue).not.toBeNull();

    const contract = readFileSync(
      fileURLToPath(
        new URL("../../../../infra/dev-stand/.env.example", import.meta.url),
      ),
      "utf8",
    );
    expect(contract).toMatch(
      new RegExp(`^CONGRESS_SIGNUP_EVENT_ID=${SEED_CONGRESS_EVENT_ID}$`, "m"),
    );
  }, 60_000);

  it("044 EARS-13: the configured congress fixture seeds and restores its event-owned venue without changing another fixture's venue", async () => {
    const readEvent = async (slug: string) => {
      const [row] = await db
        .select({ id: events.id, venue: events.venue })
        .from(events)
        .where(eq(events.slug, slug));
      expect(row).toBeDefined();
      return row!;
    };
    const congress = await readEvent(SEED_CONGRESS_EVENT_SLUG);
    expect(congress.venue).toBe("Москва, тестовая площадка (эталон)");
    const other = await readEvent("seed-005-upcoming");
    await db
      .update(events)
      .set({ venue: null })
      .where(eq(events.id, congress.id));
    await db
      .update(events)
      .set({ venue: "Другая тестовая площадка" })
      .where(eq(events.id, other.id));

    await seedEvents();

    expect(await readEvent(SEED_CONGRESS_EVENT_SLUG)).toEqual(congress);
    expect(await readEvent("seed-005-upcoming")).toEqual({
      id: other.id,
      venue: "Другая тестовая площадка",
    });
  }, 60_000);
});
