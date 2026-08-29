import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EVENT_EXPERT_POSITION_MAX } from "@ds/schemas";

import {
  EventExpertFormSchema,
  EventFormSchema,
  ExpertFormSchema,
  LoginFormSchema,
  PartnerFormSchema,
  ProjectFormSchema,
  RecordingExpectedByFormSchema,
  StreamConfigFormSchema,
  DirectionFormSchema,
} from "./form-schemas";
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

    const manyTokens = Array.from({ length: 101 }, (_, i) => `c${i}`).join(
      ", ",
    );
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
    expect(
      keysFor(StreamConfigFormSchema, { provider: "rutube", embedRef: "" }),
    ).toContain("required");
    expect(
      keysFor(StreamConfigFormSchema, {
        provider: "rutube",
        embedRef: "https://rutube.ru/video/abc/",
      }),
    ).toContain("embedRefUrl");
  });

  it("maps a garbage embed id to the provider-specific shape key (Stage-B «ччсапп», #665)", () => {
    // The Stage-B repro: a keyboard-mash token is neither a URL nor a valid
    // provider id — the SSOT `EMBED_REF_SHAPES` refinement flags it with
    // `params.shape`, and the resolver renders the provider-named RU guidance
    // (never the generic URL copy, never fallback).
    expect(
      keysFor(StreamConfigFormSchema, {
        provider: "rutube",
        embedRef: "ччсапп",
      }),
    ).toEqual(["embedRefRutube"]);
    expect(
      keysFor(StreamConfigFormSchema, {
        provider: "youtube",
        embedRef: "ччсапп",
      }),
    ).toEqual(["embedRefYoutube"]);
    // #1134 — vk (malformed triple) and cdnvideo (non-allowlisted URL) map to
    // their own provider-named RU guidance, never the generic URL copy or fallback.
    expect(
      keysFor(StreamConfigFormSchema, { provider: "vk", embedRef: "ччсапп" }),
    ).toEqual(["embedRefVk"]);
    expect(
      keysFor(StreamConfigFormSchema, {
        provider: "cdnvideo",
        embedRef: "https://evil.example.com/aloha/players/x.html",
      }),
    ).toEqual(["embedRefCdnvideo"]);
  });

  it("login form: every field's real failing rule maps to a specific key, never fallback", () => {
    // Empty submit — the Stage-B finding: the login form showed NATIVE browser
    // bubbles («Please fill out this field.») instead of DS RU errors.
    const empty = keysFor(LoginFormSchema, { email: "", password: "" });
    expect(empty).toContain("email");
    expect(empty).toContain("passwordTooShort");
    expect(empty).not.toContain("fallback");

    // A malformed email and an over-long password map to their own keys.
    const malformed = keysFor(LoginFormSchema, {
      email: "not-an-email",
      password: "x".repeat(300),
    });
    expect(malformed).toContain("email");
    expect(malformed).toContain("maxLength");
    expect(malformed).not.toContain("fallback");
  });

  it("project form (012 EARS-1): every field's real failing rule maps to a specific key, never fallback", () => {
    // Empty submit — title and description are required; the slug box may be
    // empty (the server generates it), so it must NOT report an error here.
    const empty = keysFor(ProjectFormSchema, {
      kind: "school",
      title: "",
      description: "",
      slug: "",
    });
    expect(empty).toContain("required");
    expect(empty).not.toContain("fallback");

    // Over-long title/description → the length key.
    const tooLong = keysFor(ProjectFormSchema, {
      kind: "school",
      title: "x".repeat(161),
      description: "x".repeat(2001),
      slug: "",
    });
    expect(tooLong).toEqual(["maxLength", "maxLength"]);

    // The slug box distinguishes its two refusals: wrong grammar vs the
    // forbidden canonical-UUID id namespace.
    expect(
      keysFor(ProjectFormSchema, {
        kind: "school",
        title: "Школа",
        description: "Описание",
        slug: "Not valid",
      }),
    ).toEqual(["slugPattern"]);
    expect(
      keysFor(ProjectFormSchema, {
        kind: "school",
        title: "Школа",
        description: "Описание",
        slug: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual(["slugReserved"]);

    // An unknown kind maps to its own key.
    expect(
      keysFor(ProjectFormSchema, {
        kind: "podcast",
        title: "Школа",
        description: "Описание",
        slug: "",
      }),
    ).toEqual(["kind"]);
  });

  it("EARS-20: the expert form validates structured names and exposes no authored slug", () => {
    const filled = {
      familyName: "Петров",
      givenName: "Иван",
      patronymic: "Сергеевич",
      userId: "",
      professionalRole: "Кардиолог",
      credentials: "д.м.н.",
      affiliation: "НМИЦ кардиологии",
      bio: "Практикующий кардиолог.",
    };

    // Family and given names are independently required. Patronymic and User link
    // remain optional; publication fields remain legal draft omissions.
    expect(
      keysFor(ExpertFormSchema, {
        ...filled,
        familyName: "",
        givenName: "",
        patronymic: "",
        userId: "",
        professionalRole: "",
        credentials: "",
        affiliation: "",
        bio: "",
      }),
    ).toEqual(["required", "required"]);

    // Every text field's over-long bound maps to the length key, never fallback.
    const tooLong = keysFor(ExpertFormSchema, {
      familyName: "x".repeat(81),
      givenName: "x".repeat(81),
      patronymic: "x".repeat(81),
      userId: "",
      professionalRole: "x".repeat(161),
      credentials: "x".repeat(501),
      affiliation: "x".repeat(241),
      bio: "x".repeat(4001),
    });
    expect(tooLong).toEqual([
      "maxLength",
      "maxLength",
      "maxLength",
      "maxLength",
      "maxLength",
      "maxLength",
      "maxLength",
    ]);

    // Slug is server-owned: the form schema strips an unknown slug property
    // rather than validating or forwarding an operator-authored value.
    expect(
      ExpertFormSchema.parse({
        ...filled,
        slug: "00000000-0000-4000-8000-000000000000",
      }),
    ).not.toHaveProperty("slug");
  });

  it("EARS-19: the Expert User selector accepts only an empty or existing UUID value", () => {
    const filled = {
      familyName: "Петров",
      givenName: "Иван",
      patronymic: "",
      professionalRole: "",
      credentials: "",
      affiliation: "",
      bio: "",
    };

    expect(ExpertFormSchema.safeParse({ ...filled, userId: "" }).success).toBe(
      true,
    );
    expect(
      ExpertFormSchema.safeParse({
        ...filled,
        userId: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
    expect(
      ExpertFormSchema.safeParse({ ...filled, userId: "manual-user-id" })
        .success,
    ).toBe(false);
  });

  it("EARS-3: every direction-form failing rule maps to a specific key, never fallback", () => {
    // Empty submit — «Название» is the direction's ONLY authored value (017
    // EARS-18): the address is derived server-side and the form has no slug box
    // at all, so there is no second field left to report against.
    expect(keysFor(DirectionFormSchema, { title: "" })).toEqual(["required"]);

    // The 120-character title bound maps to the length key, not the fallback.
    expect(keysFor(DirectionFormSchema, { title: "х".repeat(121) })).toEqual([
      "maxLength",
    ]);

    // …and there is nothing for a slug rule to fire on: the form's parsed shape
    // carries no address at all, so the create request cannot smuggle one past
    // the `.strict()` wire schema.
    expect(
      DirectionFormSchema.parse({
        title: "Кардиология",
        slug: "kardiologiya",
      }),
    ).not.toHaveProperty("slug");
  });

  it("EARS-4: every partner-form failing rule maps to a specific key, never fallback", () => {
    // Empty submit — the title is the partner's only required value; the website
    // and slug boxes may both be empty (no site / server-generated address) and
    // must NOT report an error here.
    expect(
      keysFor(PartnerFormSchema, { title: "", websiteUrl: "", slug: "" }),
    ).toEqual(["required"]);

    // The 160-character title bound maps to the length key, not the fallback.
    expect(
      keysFor(PartnerFormSchema, {
        title: "х".repeat(161),
        websiteUrl: "",
        slug: "",
      }),
    ).toEqual(["maxLength"]);

    // The website box: a bare domain, an http:// address and a value carrying
    // whitespace are all the SAME fix — «начните с https://» — and none of them
    // may degrade to the generic sentence.
    for (const bad of [
      "example.ru",
      "http://example.ru",
      "https:// example.ru",
    ]) {
      expect(
        keysFor(PartnerFormSchema, {
          title: "Фарма-Лаб",
          websiteUrl: bad,
          slug: "",
        }),
      ).toEqual(["pattern"]);
    }
    // Over the 2048-character cap is its own key, not the pattern sentence.
    expect(
      keysFor(PartnerFormSchema, {
        title: "Фарма-Лаб",
        websiteUrl: `https://example.ru/${"a".repeat(2100)}`,
        slug: "",
      }),
    ).toEqual(["maxLength"]);

    // The slug box distinguishes its two refusals exactly as its siblings do:
    // wrong grammar vs the forbidden canonical-UUID id namespace.
    expect(
      keysFor(PartnerFormSchema, {
        title: "Фарма-Лаб",
        websiteUrl: "",
        slug: "Not valid",
      }),
    ).toEqual(["slugPattern"]);
    expect(
      keysFor(PartnerFormSchema, {
        title: "Фарма-Лаб",
        websiteUrl: "",
        slug: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual(["slugReserved"]);
  });

  it("EARS-7: every event↔expert link failing rule maps to a specific key, never fallback", () => {
    const expertId = "11111111-1111-4111-8111-111111111111";

    // Empty submit — the expert selector, the role box and the place box are all
    // required, and none of the three may degrade to the generic sentence.
    const empty = keysFor(EventExpertFormSchema, {
      expertId: "",
      role: "",
      positionText: "",
    });
    expect(empty).not.toContain("fallback");
    expect(empty).toContain("expert");
    expect(empty).toContain("required");

    // Nothing chosen in the selector gets the «pick from the list» sentence, not
    // «обязательное поле» — under a dropdown the latter names no action.
    expect(
      keysFor(EventExpertFormSchema, {
        expertId: "",
        role: "Модератор",
        positionText: "1",
      }),
    ).toEqual(["expert"]);

    // The role box: empty and over the 80-character SSOT bound are the two shapes
    // it can fail on, and they map to the two generic-tail keys, never fallback.
    expect(
      keysFor(EventExpertFormSchema, {
        expertId,
        role: "",
        positionText: "1",
      }),
    ).toEqual(["required"]);
    expect(
      keysFor(EventExpertFormSchema, {
        expertId,
        role: "х".repeat(81),
        positionText: "1",
      }),
    ).toEqual(["maxLength"]);

    // The place box is a TEXT box folded through the SSOT number check. Empty,
    // whitespace-only, non-numeric, an exponent and a negative slot are ONE fix
    // — type a whole number in range — and `Number(" ")` = 0 / `Number("1e3")` =
    // 1000 must not slip through as a legal slot the operator never typed.
    for (const bad of ["", " ", "abc", "1e3", "-1", "1.5"]) {
      expect(
        keysFor(EventExpertFormSchema, {
          expertId,
          role: "Модератор",
          positionText: bad,
        }),
      ).toEqual(["position"]);
    }

    // Over the SSOT cap is its own sentence, not the generic «type a number».
    expect(
      keysFor(EventExpertFormSchema, {
        expertId,
        role: "Модератор",
        positionText: String(EVENT_EXPERT_POSITION_MAX + 1),
      }),
    ).toEqual(["positionMax"]);
  });

  it("the 014 readiness date maps every refusal to its own key, never fallback", () => {
    // Wrong shape, impossible month and impossible DAY are one fix — «type
    // ГГГГ-ММ-ДД» — and none of them may degrade to the generic sentence.
    for (const bad of ["01.09.2026", "2026-13-45", "2026-02-31"]) {
      expect(
        keysFor(RecordingExpectedByFormSchema, { expectedBy: bad }),
      ).toEqual(["expectedBy"]);
    }
    // The two legal values: a real day, and the empty box that means «no promise».
    for (const good of ["2026-09-01", ""]) {
      expect(
        RecordingExpectedByFormSchema.safeParse({ expectedBy: good }).success,
      ).toBe(true);
    }
  });
});
