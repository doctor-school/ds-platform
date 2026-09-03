import { describe, expect, it } from "vitest";

import { AroundEventSchema, EventPageViewSchema } from "./public-page.schema.js";

/**
 * 020 EARS-2 (#1765) — the shape contract of `AroundEvent`. The rules under
 * test are the ones that make «absent rather than dead» a STRUCTURAL fact
 * rather than a rendering convention: a destination that does not exist has no
 * key, and no href is ever `null` or empty.
 */
describe("AroundEvent", () => {
  it("020 EARS-2.1: links keys are absent, never null, when a host has no target", () => {
    const empty = AroundEventSchema.parse({ speakerPages: [] });
    expect(empty).toEqual({ speakerPages: [] });
    expect("school" in empty).toBe(false);
    expect("communityHref" in empty).toBe(false);

    expect(() =>
      AroundEventSchema.parse({ speakerPages: [], school: null }),
    ).toThrow();
    expect(() =>
      AroundEventSchema.parse({ speakerPages: [], communityHref: null }),
    ).toThrow();
    expect(() =>
      AroundEventSchema.parse({ speakerPages: [], communityHref: "" }),
    ).toThrow();
    expect(() =>
      AroundEventSchema.parse({
        speakerPages: [{ speakerKey: "ivanov", href: "" }],
      }),
    ).toThrow();
    expect(() =>
      AroundEventSchema.parse({
        speakerPages: [],
        school: { label: "Школа", href: "" },
      }),
    ).toThrow();
  });

  it("020 EARS-2.1: a populated link set round-trips every key", () => {
    const parsed = AroundEventSchema.parse({
      school: { label: "Школа кардиологии", href: "/schools/cardio" },
      speakerPages: [{ speakerKey: "ivanov", href: "/experts/ivanov" }],
      communityHref: "/community",
    });
    expect(parsed).toEqual({
      school: { label: "Школа кардиологии", href: "/schools/cardio" },
      speakerPages: [{ speakerKey: "ivanov", href: "/experts/ivanov" }],
      communityHref: "/community",
    });
  });

  it("020 EARS-2.1: the event page read requires links, so a host cannot omit it", () => {
    const keys = Object.keys(EventPageViewSchema.shape);
    expect(keys).toContain("links");
  });
});
