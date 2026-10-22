import { buildGoldenDataset, type GoldenSubjectMap } from "@ds/db/seed/golden";
import { describe, expect, it } from "vitest";

interface LiveTiersModule {
  readonly GOLDEN_SLUGS: Readonly<Record<string, string>>;
  readonly LIVE_TIERS: readonly {
    readonly name: string;
    readonly seededEnv?: Readonly<Record<string, string>>;
  }[];
}

// The staging runner's mirror of the golden slugs (#2996) — untyped plain ESM
// tooling, loaded by URL like `packages/e2e/lib/password-policy.ts` loads its
// `tools/staging` modules. This spec is what keeps that mirror honest.
const { GOLDEN_SLUGS, LIVE_TIERS } = (await import(
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

      const doctor = read(slugs.doctorUpcoming!);
      expect(doctor).toMatchObject({
        state: "published",
        audience: "doctors",
        format: "online",
        future: true,
      });
      expect(doctor.speakers).toBeGreaterThan(0);
    });
  }

  it("020 EARS-1: every event-page tier slug is one of the verified golden slugs", () => {
    const verified = new Set(Object.values(slugs));
    const tiers = LIVE_TIERS.filter((tier) => tier.seededEnv);
    expect(tiers.map((t) => t.name).sort()).toEqual([
      "live/academy/event-page",
      "live/doctor/event-page",
    ]);
    for (const tier of tiers) {
      for (const [name, value] of Object.entries(tier.seededEnv!)) {
        for (const slug of value.split(",")) {
          expect(verified.has(slug), `${tier.name} ${name}=${slug}`).toBe(true);
        }
      }
    }
  });
});
