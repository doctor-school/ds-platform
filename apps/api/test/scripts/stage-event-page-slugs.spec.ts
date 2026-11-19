import { buildGoldenDataset, type GoldenSubjectMap } from "@ds/db/seed/golden";
import { describe, expect, it } from "vitest";

interface LiveTiersModule {
  readonly GOLDEN_SLUGS: Readonly<Record<string, string>>;
  readonly GOLDEN_MATERIAL_SLUG: string;
  readonly GOLDEN_LEARNING_COURSE_SLUG: string;
  readonly GOLDEN_EVENT_SLUGS: { readonly live: string };
  readonly LIVE_TIERS: readonly {
    readonly name: string;
    readonly seededEnv?: Readonly<Record<string, string>>;
  }[];
}

// The staging runner's mirror of the golden slugs (#2996) — untyped plain ESM
// tooling, loaded by URL like `packages/e2e/lib/password-policy.ts` loads its
// `tools/staging` modules. This spec is what keeps that mirror honest.
const {
  GOLDEN_SLUGS,
  GOLDEN_MATERIAL_SLUG,
  GOLDEN_LEARNING_COURSE_SLUG,
  GOLDEN_EVENT_SLUGS,
  LIVE_TIERS,
} = (await import(
  new URL("../../../../tools/staging/live-tiers.mjs", import.meta.url).href
)) as LiveTiersModule;

// #2996 — a staging slot runs ONLY `seed:golden`, so the event-page live tiers
// read golden slugs (`tools/staging/live-tiers.mjs` → `seededEnv`). This builds
// the golden dataset and proves every mirrored slug carries the shape its spec
// asserts — at several seed instants, because a slot seeds at its own
// `now` and a volume event's shape must not depend on it.
const slugs = GOLDEN_SLUGS;

// The subject ids only feed the account rows; no event shape reads them.
const subjects = new Proxy(
  {},
  { get: (_target, key) => `stage-slug-spec-${String(key)}` },
) as GoldenSubjectMap;

function shapes(now: Date) {
  const ds = buildGoldenDataset(now, subjects);
  const published = new Set(
    ds.experts.filter((e) => e.status === "published").map((e) => e.id),
  );
  return (slug: string) => {
    const event = ds.events.find((e) => e.slug === slug);
    expect(event, slug).toBeDefined();
    const speakers = ds.eventExperts.filter(
      (l) =>
        l.eventId === event!.id &&
        (l.status ?? "active") === "active" &&
        published.has(l.expertId),
    ).length;
    const recordings = ds.eventRecordings
      .filter(
        (r) =>
          r.eventId === event!.id && r.status === "published" && !r.deletedAt,
      )
      .map((r) => r.kind)
      .sort();
    return {
      state: event!.state,
      audience: event!.audience,
      format: event!.participationFormat ?? "online",
      seatsLeft: event!.seatsLeft ?? null,
      expectedBy: event!.recordingExpectedBy ?? null,
      future: new Date(event!.startsAt).getTime() > now.getTime(),
      speakers,
      recordings,
    };
  };
}

describe("tools/staging live-tier golden slugs (#2996)", () => {
  for (const now of [
    new Date("2026-10-22T09:00:00Z"),
    new Date("2026-10-23T16:45:00Z"),
    new Date("2026-12-31T21:59:00Z"),
    new Date("2027-03-05T18:30:00Z"),
    new Date("2027-07-14T03:15:00Z"),
  ]) {
    it(`020 EARS-1: every seeded slug carries the shape its event-page spec asserts (seeded at ${now.toISOString()})`, () => {
      const read = shapes(now);

      const upcoming = read(slugs.academyUpcoming!);
      expect(upcoming).toMatchObject({
        state: "published",
        audience: "experts",
        future: true,
      });
      expect(upcoming.speakers).toBeGreaterThan(0);

      const ended = read(slugs.academyEndedRecorded!);
      expect(ended).toMatchObject({
        state: "ended",
        audience: "experts",
        recordings: ["edited"],
      });
      expect(ended.speakers).toBeGreaterThan(0);

      const preparing = read(slugs.academyPreparingDated!);
      expect(preparing).toMatchObject({
        state: "ended",
        audience: "experts",
        recordings: [],
      });
      expect(preparing.expectedBy).not.toBeNull();
      expect(preparing.speakers).toBeGreaterThan(0);

      const inPerson = (slug: string, format: string, soldOut: boolean) => {
        const shape = read(slug);
        expect(shape, slug).toMatchObject({
          state: "published",
          audience: "experts",
          format,
          future: true,
        });
        if (soldOut) expect(shape.seatsLeft, slug).toBe(0);
        else expect(shape.seatsLeft, slug).toBeGreaterThan(0);
      };
      inPerson(slugs.academyOffline!, "offline", false);
      inPerson(slugs.academyOfflineSoldOut!, "offline", true);
      inPerson(slugs.academyHybrid!, "hybrid", false);
      inPerson(slugs.academyHybridSoldOut!, "hybrid", true);

      // #3229 — the default Academy tier's 005 journey events.
      for (const slug of [
        slugs.academyUpcomingOneTap!,
        slugs.academyUpcomingMarker!,
      ]) {
        const shape = read(slug);
        expect(shape, slug).toMatchObject({
          state: "published",
          audience: "experts",
          format: "online",
          future: true,
        });
        expect(shape.speakers, slug).toBeGreaterThan(0);
      }
      expect(read(slugs.academyHidden!)).toMatchObject({
        state: "hidden",
        audience: "experts",
      });

      const doctor = read(slugs.doctorUpcoming!);
      expect(doctor).toMatchObject({
        state: "published",
        audience: "doctors",
        format: "online",
        future: true,
      });
      expect(doctor.speakers).toBeGreaterThan(0);

      const room = read(GOLDEN_EVENT_SLUGS.live);
      expect(room).toMatchObject({
        state: "live",
        audience: "doctors",
        format: "online",
      });
      expect(room.speakers).toBeGreaterThan(0);
    });
  }

  // The seeded env names whose value addresses a material (048 EARS-11), not an
  // event; every other seeded name addresses an event.
  const MATERIAL_ENV = new Set(["E2E_MATERIAL_SLUG"]);
  // The seeded env names whose value addresses a learning course (024 EARS-14),
  // not an event.
  const LEARNING_ENV = new Set(["E2E_LEARNING_COURSE_SLUG"]);
  // The seeded env names whose value addresses a specialty (018 EARS-8), proven
  // against the golden adjacency by `stage-feed-adjacent-env.spec.ts`.
  const SPECIALTY_ENV = new Set([
    "E2E_FEED_ADJACENT_CODE",
    "E2E_FEED_ADJACENT_EXPECT",
    "E2E_FEED_ADJACENT_EMPTY_CODE",
  ]);

  it("020 EARS-1: every event-page tier slug is one of the verified golden slugs", () => {
    const verified = new Set([
      ...Object.values(slugs),
      GOLDEN_EVENT_SLUGS.live,
    ]);
    const tiers = LIVE_TIERS.filter((tier) => tier.seededEnv);
    expect(tiers.map((t) => t.name).sort()).toEqual([
      "live/academy/default",
      "live/academy/event-page",
      "live/admin/event-lifecycle",
      "live/doctor/congress",
      "live/doctor/event-page",
      "live/doctor/event-register",
      "live/doctor/feed-live",
      "live/doctor/learning",
      "live/doctor/room",
    ]);
    for (const tier of tiers) {
      for (const [name, value] of Object.entries(tier.seededEnv!)) {
        if (
          MATERIAL_ENV.has(name) ||
          LEARNING_ENV.has(name) ||
          SPECIALTY_ENV.has(name)
        )
          continue;
        for (const slug of value.split(",")) {
          expect(verified.has(slug), `${tier.name} ${name}=${slug}`).toBe(true);
        }
      }
    }
  });

  it("046 EARS-9: the doctor's stage congress is the cabinet event and accepts oral submissions at the seed instant", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const dataset = buildGoldenDataset(now, subjects);
    const tier = LIVE_TIERS.find((t) => t.name === "live/doctor/congress");
    const slug = tier?.seededEnv?.E2E_DOCTOR_CONGRESS_SLUG;
    expect(slug).toBeTruthy();
    const adminTier = LIVE_TIERS.find((t) => t.name === "live/admin/event-lifecycle");
    expect(adminTier?.seededEnv?.E2E_DOCTOR_CONGRESS_SLUG).toBe(slug);
    const event = dataset.events.find((e) => e.slug === slug);
    expect(event).toMatchObject({
      state: "published",
      audience: "doctors",
      participationFormat: "offline",
      seatsLeft: null,
    });
    expect(event!.startsAt.getTime()).toBeGreaterThan(now.getTime());
    const congressIds = new Set(
      dataset.congressSubmissionSettings.map((s) => s.eventId),
    );
    const cabinetEvent = dataset.events
      .filter((e) => congressIds.has(e.id!))
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
    expect(cabinetEvent?.id).toBe(event!.id);
    const oral = dataset.congressSubmissionKindSettings.find(
      (s) => s.eventId === event!.id && s.kind === "oral",
    );
    expect(oral).toMatchObject({ submitLimit: null, maxAgeYears: null });
    expect(oral!.opensAt!.getTime()).toBeLessThan(now.getTime());
    expect(oral!.closesAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("048 EARS-11: every seeded material reference is the published golden material", () => {
    const published = new Set(
      buildGoldenDataset(new Date("2026-10-22T09:00:00Z"), subjects)
        .materials.filter((m) => m.status === "published" && !m.deletedAt)
        .map((m) => m.slug),
    );
    expect([...published]).toEqual([GOLDEN_MATERIAL_SLUG]);
    expect(Object.values(slugs)).not.toContain(GOLDEN_MATERIAL_SLUG);
    const refs = LIVE_TIERS.flatMap((tier) =>
      Object.entries(tier.seededEnv ?? {})
        .filter(([name]) => MATERIAL_ENV.has(name))
        .map(([name, value]) => `${tier.name} ${name}=${value}`),
    );
    expect(refs).toEqual([
      `live/academy/default E2E_MATERIAL_SLUG=${GOLDEN_MATERIAL_SLUG}`,
    ]);
  });

  it("024 EARS-14: every seeded learning-course reference is the published golden course", () => {
    const ds = buildGoldenDataset(new Date("2026-10-22T09:00:00Z"), subjects);
    const published = ds.learningCourses
      .filter((c) => c.state === "published")
      .map((c) => c.slug);
    expect(published).toEqual([GOLDEN_LEARNING_COURSE_SLUG]);
    expect(ds.events.map((e) => e.slug)).not.toContain(
      GOLDEN_LEARNING_COURSE_SLUG,
    );
    expect(Object.values(slugs)).not.toContain(GOLDEN_LEARNING_COURSE_SLUG);
    const refs = LIVE_TIERS.flatMap((tier) =>
      Object.entries(tier.seededEnv ?? {})
        .filter(([name]) => LEARNING_ENV.has(name))
        .map(([name, value]) => `${tier.name} ${name}=${value}`),
    );
    expect(refs).toEqual([
      `live/doctor/learning E2E_LEARNING_COURSE_SLUG=${GOLDEN_LEARNING_COURSE_SLUG}`,
    ]);
  });
});
