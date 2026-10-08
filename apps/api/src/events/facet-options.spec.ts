import { describe, expect, it } from "vitest";
import { facetOptionsOver } from "./facet-options.js";

type Row = { kind: string; city?: string };
const rows: Row[] = [
  { kind: "lecture", city: "Москва" },
  { kind: "lecture" },
  { kind: "school", city: "Казань" },
];
const dims = (kind: string[], city: string[]) => ({
  kind: {
    selected: kind,
    valuesOf: (r: Row) => [{ slug: r.kind, title: r.kind }],
  },
  city: {
    selected: city,
    valuesOf: (r: Row) => (r.city ? [{ slug: r.city, title: r.city }] : []),
  },
});

describe("facetOptionsOver (wave-2 gate §4.3 D9)", () => {
  it("NEW: counts each option under the other facets only, keeps zero-yield options, orders by title", () => {
    const options = facetOptionsOver(rows, dims(["lecture"], ["Казань"]), [
      "kind",
      "city",
    ]);
    expect(options.kind).toEqual([
      { slug: "lecture", title: "lecture", count: 0 },
      { slug: "school", title: "school", count: 1 },
    ]);
    expect(options.city).toEqual([
      { slug: "Казань", title: "Казань", count: 0 },
      { slug: "Москва", title: "Москва", count: 1 },
    ]);
  });
});
