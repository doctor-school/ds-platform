import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createDrizzle,
  eventExperts,
  eventRecordings,
  events,
  experts,
} from "@ds/db";
import { SEED_EVENT_KINDS, isGoldenVolumeUuid } from "@ds/db/seed/golden";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SEED_CONGRESS_EVENT_ID,
  SEED_CONGRESS_EVENT_SLUG,
  SEED_EVENT_PAGE_SLUGS,
  SEED_SPEAKER_SLUGS,
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

  // #2996 — the event-page e2e specs on both hosts assert a speaker card, the
  // «Спикеры» block and ≥1 `event_experts` link. The seed does not invent expert
  // records: the speakers are the golden expert fixtures, upserted by their
  // golden id and linked to every seed event those specs read.
  async function readSpeakers(slug: string) {
    return db
      .select({
        linkId: eventExperts.id,
        expertId: eventExperts.expertId,
        position: eventExperts.position,
        role: eventExperts.role,
        expertStatus: experts.status,
      })
      .from(eventExperts)
      .innerJoin(events, eq(events.id, eventExperts.eventId))
      .innerJoin(experts, eq(experts.id, eventExperts.expertId))
      .where(and(eq(events.slug, slug), eq(eventExperts.status, "active")))
      .orderBy(asc(eventExperts.position));
  }

  it("020 EARS-1: every seed event the event-page specs read carries published golden experts as its speakers, and a re-run keeps the same links", async () => {
    expect(SEED_SPEAKER_SLUGS).toEqual(
      expect.arrayContaining([
        "seed-005-upcoming",
        "seed-005-ended",
        "seed-014-ended-month-ago",
      ]),
    );
    const before = new Map<string, Awaited<ReturnType<typeof readSpeakers>>>();
    for (const slug of SEED_SPEAKER_SLUGS) {
      const speakers = await readSpeakers(slug);
      expect(speakers.length, slug).toBeGreaterThan(0);
      speakers.forEach((speaker, index) => {
        expect(isGoldenVolumeUuid(speaker.expertId), slug).toBe(true);
        expect(speaker.expertStatus, slug).toBe("published");
        expect(speaker.position, slug).toBe(index);
        expect(speaker.role, slug).toBeTruthy();
      });
      before.set(slug, speakers);
    }

    await seedEvents();

    for (const slug of SEED_SPEAKER_SLUGS) {
      expect(await readSpeakers(slug), slug).toEqual(before.get(slug));
    }
  }, 60_000);

  it("014 EARS-7: the preparing fixture is an ended event with a committed readiness day and no published recording", async () => {
    const slug = SEED_EVENT_PAGE_SLUGS.E2E_PREPARING_WEBINAR_SLUG;
    const [row] = await db
      .select({
        id: events.id,
        state: events.state,
        recordingExpectedBy: events.recordingExpectedBy,
      })
      .from(events)
      .where(eq(events.slug, slug));
    expect(row).toBeDefined();
    expect(row!.state).toBe("ended");
    expect(row!.recordingExpectedBy).not.toBeNull();
    const published = await db
      .select({ id: eventRecordings.id })
      .from(eventRecordings)
      .where(
        and(
          eq(eventRecordings.eventId, row!.id),
          eq(eventRecordings.status, "published"),
          isNull(eventRecordings.deletedAt),
        ),
      );
    expect(published).toEqual([]);
    expect((await readSpeakers(slug)).length).toBeGreaterThan(0);
  }, 60_000);

  it("020 EARS-8/9: the wave-3 sweep shapes are registrable Academy events — offline and hybrid, with seats and sold out", async () => {
    const readShape = async (slug: string) => {
      const [row] = await db
        .select({
          state: events.state,
          audience: events.audience,
          participationFormat: events.participationFormat,
          seatsLeft: events.seatsLeft,
          venue: events.venue,
          startsAt: events.startsAt,
        })
        .from(events)
        .where(eq(events.slug, slug));
      expect(row, slug).toBeDefined();
      expect(row!.state, slug).toBe("published");
      expect(row!.audience, slug).toBe("experts");
      expect(row!.venue, slug).toBeTruthy();
      expect(row!.startsAt.getTime(), slug).toBeGreaterThan(Date.now());
      return row!;
    };
    const hybrid = await readShape(SEED_EVENT_PAGE_SLUGS.E2E_HYBRID_SLUG);
    expect(hybrid.participationFormat).toBe("hybrid");
    expect(hybrid.seatsLeft).toBeGreaterThan(0);
    const hybridSoldOut = await readShape(
      SEED_EVENT_PAGE_SLUGS.E2E_HYBRID_SOLDOUT_SLUG,
    );
    expect(hybridSoldOut.participationFormat).toBe("hybrid");
    expect(hybridSoldOut.seatsLeft).toBe(0);
    const offlineSoldOut = await readShape(
      SEED_EVENT_PAGE_SLUGS.E2E_OFFLINE_SOLDOUT_SLUG,
    );
    expect(offlineSoldOut.participationFormat).toBe("offline");
    expect(offlineSoldOut.seatsLeft).toBe(0);

    const sweep = SEED_EVENT_PAGE_SLUGS.E2E_SWEEP_SLUGS.split(",");
    const formats = new Set<string>();
    for (const slug of sweep) {
      const [row] = await db
        .select({ participationFormat: events.participationFormat })
        .from(events)
        .where(eq(events.slug, slug));
      expect(row, slug).toBeDefined();
      formats.add(row!.participationFormat);
    }
    expect([...formats].sort()).toEqual(["hybrid", "offline", "online"]);
  }, 60_000);
});
