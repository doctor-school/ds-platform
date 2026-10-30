import { describe, expect, it } from "vitest";
import { allocateMaterialSlug, materialSlugBase } from "./materials-slug.js";

// 048-design §Data model — the slug comes from the title through the shared
// 012 slug primitives; route words are never a material address.
describe("048 material slug", () => {
  it("048 EARS-1: when a material is titled in Cyrillic, the system shall derive a transliterated slug", () => {
    expect(materialSlugBase("Грипп: сезон 2026")).toMatch(/^gripp-sezon-2026$/);
  });

  it("048 EARS-1: when a title slugifies to a route word or to nothing, the system shall prefix it with `material`", () => {
    expect(materialSlugBase("Feed")).toBe("material-feed");
    expect(materialSlugBase("!!!")).toBe("material");
  });

  it("048 EARS-1: when the base is taken, the system shall take the next free candidate of the collision sequence", async () => {
    const taken = new Set(["gripp", "gripp-2"]);
    expect(await allocateMaterialSlug("gripp", async (c) => taken.has(c))).toBe(
      "gripp-3",
    );
  });
});
