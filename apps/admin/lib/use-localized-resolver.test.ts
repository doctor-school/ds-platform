import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EventFormSchema, StreamConfigFormSchema } from "./form-schemas";
import { translateIssue, type ZodIssueLike } from "./use-localized-resolver";

/**
 * #665 drift guard. The admin forms render RU validation copy by mapping the
 * STRUCTURED zod issue (code + shape + field path) of the SSOT-derived schemas —
 * never the English message text. This test drives every admin-form field's real
 * failing rule through `translateIssue` and asserts (a) none degrades to the
 * generic `fallback`, and (b) the field-specific keys resolve. A new `@ds/schemas`
 * bound the map doesn't handle fails here instead of leaking English to the
 * operator (mirrors the portal `use-localized-resolver.test.ts`, #188).
 */

// Identity translator — the RU catalog lookup is `next-intl`'s at runtime; here we
// assert the KEY the resolver chose (the catalog itself is covered by the e2e).
const id = (key: string) => key;

function issuesFor(schema: z.ZodType, value: unknown): ZodIssueLike[] {
  const result = schema.safeParse(value);
  expect(result.success, "expected the invalid fixture to fail").toBe(false);
  return result.success ? [] : (result.error.issues as ZodIssueLike[]);
}

function keysFor(schema: z.ZodType, value: unknown): string[] {
  return issuesFor(schema, value).map((issue) => translateIssue(issue, id));
}

describe("translateIssue — admin form RU error mapping (#665)", () => {
  it("every empty-required event field maps to a specific key, never fallback", () => {
    const keys = keysFor(EventFormSchema, {
      title: "",
      school: "",
      startsAtMsk: "",
      durationMin: Number.NaN,
      description: "",
      partnerRef: "",
      speakers: [{ name: "", regalia: "" }],
      specialtiesText: "",
    });
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).not.toContain("fallback");
    expect(keys).toContain("required"); // title / school
    expect(keys).toContain("dateTime"); // startsAtMsk
    expect(keys).toContain("duration"); // durationMin
    expect(keys).toContain("speakerName"); // speakers.0.name
  });

  it("maps the duration over-cap and length bounds distinctly", () => {
    expect(
      keysFor(EventFormSchema, {
        title: "ok",
        school: "ok",
        startsAtMsk: "2026-07-17T19:00",
        durationMin: 5000,
        description: "",
        partnerRef: "",
        speakers: [],
        specialtiesText: "",
      }),
    ).toContain("durationMax");

    expect(
      keysFor(EventFormSchema, {
        title: "x".repeat(301),
        school: "ok",
        startsAtMsk: "2026-07-17T19:00",
        durationMin: 60,
        description: "",
        partnerRef: "",
        speakers: [],
        specialtiesText: "",
      }),
    ).toContain("maxLength");
  });

  it("maps specialties per-token length and list-count caps", () => {
    expect(
      keysFor(EventFormSchema, {
        title: "ok",
        school: "ok",
        startsAtMsk: "2026-07-17T19:00",
        durationMin: 60,
        description: "",
        partnerRef: "",
        speakers: [],
        specialtiesText: "a".repeat(101),
      }),
    ).toContain("specialty");

    const manyTokens = Array.from({ length: 101 }, (_, i) => `c${i}`).join(", ");
    expect(
      keysFor(EventFormSchema, {
        title: "ok",
        school: "ok",
        startsAtMsk: "2026-07-17T19:00",
        durationMin: 60,
        description: "",
        partnerRef: "",
        speakers: [],
        specialtiesText: manyTokens,
      }),
    ).toContain("specialtyCount");
  });

  it("maps a required and a URL-shaped stream embed reference", () => {
    expect(keysFor(StreamConfigFormSchema, { provider: "rutube", embedRef: "" })).toContain(
      "required",
    );
    expect(
      keysFor(StreamConfigFormSchema, {
        provider: "rutube",
        embedRef: "https://rutube.ru/video/abc/",
      }),
    ).toContain("embedRefUrl");
  });
});
