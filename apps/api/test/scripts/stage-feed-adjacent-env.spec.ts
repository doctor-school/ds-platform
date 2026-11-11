import { buildSpecialtyBookSeed } from "@ds/db";
import { buildGoldenDataset, type GoldenSubjectMap } from "@ds/db/seed/golden";
import { describe, expect, it } from "vitest";

interface LiveTiersModule {
  readonly LIVE_TIERS: readonly {
    readonly name: string;
    readonly seededEnv?: Readonly<Record<string, string>>;
  }[];
}

// The staging runner's mirror of the golden 018 adjacency (#1503) — untyped
// plain ESM tooling, loaded by URL like `stage-event-page-slugs.spec.ts` does.
const { LIVE_TIERS } = (await import(
  new URL("../../../../tools/staging/live-tiers.mjs", import.meta.url).href
)) as LiveTiersModule;

const env = LIVE_TIERS.find((t) => t.name === "live/doctor/feed-live")
  ?.seededEnv as Readonly<Record<string, string>>;

const subjects = new Proxy(
  {},
  { get: (_target, key) => `stage-adjacent-spec-${String(key)}` },
) as GoldenSubjectMap;

/**
 * 018 EARS-8 over the golden rows, read the way `TargetingRepository` reads the
 * slot's database: published undeleted directions, active undeleted links and
 * edges, edges by weight desc then id, «Другое» never an entry, the chosen
 * specialty never its own entry, one entry per specialty through its heaviest
 * edge. Returns `[code, name, weight]` in edge order.
 */
function adjacentOf(code: string, now: Date): [string, string, number][] {
  const ds = buildGoldenDataset(now, subjects);
  const book = buildSpecialtyBookSeed();
  const byName = new Map(book.map((row) => [row.name, row]));
  const chosen = book.find((row) => row.code === code);
  if (!chosen) throw new Error(`${code} is not in the book`);
  const published = new Set(
    ds.directions
      .filter((d) => d.status === "published" && !d.deletedAt)
      .map((d) => d.id),
  );
  const links = ds.directionSpecialties.filter(
    (l) => l.status === "active" && !l.deletedAt,
  );
  const own = new Set(
    links
      .filter(
        (l) => l.specialtyName === chosen.name && published.has(l.directionId),
      )
      .map((l) => l.directionId),
  );
  const edges = ds.directionAdjacency
    .filter(
      (e) =>
        e.status === "active" &&
        !e.deletedAt &&
        own.has(e.directionId) &&
        published.has(e.adjacentDirectionId),
    )
    .sort((a, b) => b.weight! - a.weight! || (a.id! < b.id! ? -1 : 1));
  const adjacent: { id: string; weight: number }[] = [];
  for (const edge of edges) {
    const id = edge.adjacentDirectionId;
    if (own.has(id) || adjacent.some((d) => d.id === id)) continue;
    adjacent.push({ id, weight: edge.weight! });
  }
  const entries = new Map<string, [string, string, number]>();
  for (const direction of adjacent)
    for (const link of links.filter((l) => l.directionId === direction.id)) {
      const specialty = byName.get(link.specialtyName);
      if (!specialty || specialty.isOther || specialty.id === chosen.id)
        continue;
      if (!entries.has(specialty.code))
        entries.set(specialty.code, [
          specialty.code,
          specialty.name,
          direction.weight,
        ]);
    }
  return [...entries.values()];
}

// A slot seeds at its own `now`; the taxonomy must not depend on it.
const instants = [
  new Date("2026-01-15T09:00:00Z"),
  new Date("2026-06-30T21:00:00Z"),
  new Date(),
];

describe("live/doctor/feed-live seeded env (018 EARS-8, #1503)", () => {
  it("018 EARS-8: the mirrored entries are what the golden managed rows resolve to, in order", () => {
    const expected = JSON.parse(env.E2E_FEED_ADJACENT_EXPECT) as [
      string,
      string,
    ][];
    expect(expected.length).toBeGreaterThan(1);
    for (const now of instants) {
      const entries = adjacentOf(env.E2E_FEED_ADJACENT_CODE, now);
      expect(entries.map(([code, name]) => [code, name])).toEqual(expected);
      // Distinct weights: the order never rests on the database's collation.
      const weights = entries.map(([, , weight]) => weight);
      expect(new Set(weights).size).toBe(weights.length);
    }
  });

  it("018 EARS-8: the empty specialty is a plain book member whose managed rows reach no adjacent specialty", () => {
    const book = buildSpecialtyBookSeed();
    const empty = book.find((r) => r.code === env.E2E_FEED_ADJACENT_EMPTY_CODE);
    expect(empty?.isOther).toBe(false);
    for (const now of instants)
      expect(adjacentOf(env.E2E_FEED_ADJACENT_EMPTY_CODE, now)).toEqual([]);
  });
});
