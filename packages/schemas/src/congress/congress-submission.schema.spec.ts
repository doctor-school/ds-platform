import { describe, expect, it } from "vitest";

import {
  CONGRESS_SUBMISSION_CONSENT_PURPOSES,
  CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE,
} from "./congress-consent.js";
import {
  CONGRESS_SUBMISSION_LIMITS,
  CONGRESS_SUBMISSION_STATUSES,
  CongressSubmissionDraftContentSchema,
  CongressAgeLimitParamsSchema,
  CongressBirthDateRequestSchema,
  CongressSubmissionProblemSchema,
  congressAgeOnDay,
  congressAgeLimitParams,
  parseCongressDraftBody,
  congressTextLength,
  countsTowardCongressLimit,
  parseCongressSendContent,
} from "./congress-submission.schema.js";

/**
 * 046 V-1 (oral part) — the per-kind send schema accepts the complete oral set
 * and refuses each missing field, each over-limit field, zero or two
 * presenters; the draft schema accepts incomplete content.
 */

const author = (overrides: Record<string, unknown> = {}) => ({
  surname: "Иванова",
  firstName: "Мария",
  patronymic: "Петровна",
  workplace: "ГКБ №1",
  presenting: false,
  ...overrides,
});

const completeOral = () => ({
  title: "Эндопротезирование коленного сустава",
  authors: [author({ presenting: true }), author({ surname: "Петров" })],
  body: { goal: "Разобрать показания.", summary: "Краткое содержание." },
});

const fields = (content: unknown) => {
  const result = parseCongressSendContent("oral", content);
  return result.ok ? [] : result.problems.map((p) => p.field);
};

describe("046 congress submissions — oral send and draft schemas", () => {
  it("EARS-8: the oral send schema accepts the complete field set and normalises author names by the 044 EARS-33 rule", () => {
    const result = parseCongressSendContent("oral", {
      ...completeOral(),
      authors: [author({ surname: "  иВАНОВА ", presenting: true })],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.authors[0]!.surname).toBe("Иванова");
    expect(result.content.title).toBe("Эндопротезирование коленного сустава");
  });

  it("EARS-8: each missing required field is named as its own problem", () => {
    expect(fields({ ...completeOral(), title: "   " })).toEqual(["title"]);
    expect(
      fields({ ...completeOral(), body: { goal: "", summary: "x" } }),
    ).toEqual(["body.goal"]);
    expect(
      fields({ ...completeOral(), body: { goal: "x", summary: "" } }),
    ).toEqual(["body.summary"]);
    expect(fields({ ...completeOral(), authors: [] })).toEqual(["authors"]);
    expect(
      fields({
        ...completeOral(),
        authors: [author({ presenting: true, workplace: "" })],
      }),
    ).toEqual(["authors.0.workplace"]);
    expect(
      fields({
        ...completeOral(),
        authors: [author({ presenting: true, firstName: " " })],
      }),
    ).toEqual(["authors.0.firstName"]);
  });

  it("EARS-8: each over-limit field is refused at its 046-design limit", () => {
    const L = CONGRESS_SUBMISSION_LIMITS;
    expect(fields({ ...completeOral(), title: "т".repeat(L.title) })).toEqual(
      [],
    );
    expect(
      fields({ ...completeOral(), title: "т".repeat(L.title + 1) }),
    ).toEqual(["title"]);
    expect(
      fields({
        ...completeOral(),
        body: { goal: "ц".repeat(L.oralGoal + 1), summary: "x" },
      }),
    ).toEqual(["body.goal"]);
    expect(
      fields({
        ...completeOral(),
        body: { goal: "x", summary: "с".repeat(L.oralSummary + 1) },
      }),
    ).toEqual(["body.summary"]);
    expect(
      fields({
        ...completeOral(),
        authors: Array.from({ length: L.authorsMax + 1 }, (_, i) =>
          author({ presenting: i === 0 }),
        ),
      }),
    ).toEqual(["authors"]);
  });

  it("EARS-8: zero or two presenting authors are refused — exactly one presents", () => {
    expect(
      fields({ ...completeOral(), authors: [author(), author()] }),
    ).toEqual(["authors"]);
    expect(
      fields({
        ...completeOral(),
        authors: [author({ presenting: true }), author({ presenting: true })],
      }),
    ).toEqual(["authors"]);
  });

  it("EARS-8: lengths count Unicode code points after trimming, a CRLF line break as one character", () => {
    expect(congressTextLength("  ab  ")).toBe(2);
    expect(congressTextLength("a\r\nb")).toBe(3);
    expect(congressTextLength("😀")).toBe(1);
  });

  it("EARS-7: the draft schema accepts incomplete content and enforces only types and maximum lengths", () => {
    expect(
      CongressSubmissionDraftContentSchema.safeParse({
        title: "",
        authors: [{ surname: "Ив" }],
        body: { goal: "" },
      }).success,
    ).toBe(true);
    expect(CongressSubmissionDraftContentSchema.safeParse({}).success).toBe(
      true,
    );
    expect(
      CongressSubmissionDraftContentSchema.safeParse({
        title: "т".repeat(CONGRESS_SUBMISSION_LIMITS.title + 1),
      }).success,
    ).toBe(false);
    expect(
      CongressSubmissionDraftContentSchema.safeParse({ title: 42 }).success,
    ).toBe(false);
  });

  it("EARS-17: every status except draft counts toward the limit, withdrawn and rejected included", () => {
    expect(
      CONGRESS_SUBMISSION_STATUSES.filter(countsTowardCongressLimit),
    ).toEqual([
      "submitted",
      "in_review",
      "accepted",
      "rejected",
      "needs_revision",
      "withdrawn",
    ]);
  });

  it("EARS-9: the refusal problem carries a closed code set", () => {
    expect(
      CongressSubmissionProblemSchema.safeParse({
        code: "limit-reached",
        params: { limit: 3 },
      }).success,
    ).toBe(true);
    expect(
      CongressSubmissionProblemSchema.safeParse({ code: "made-up" }).success,
    ).toBe(false);
  });

  it("EARS-16: the submission consent is its own closed purpose, distinct from the 044 registration consent", () => {
    expect(CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE).toBe(
      "congress-submission-personal-data",
    );
    expect(CONGRESS_SUBMISSION_CONSENT_PURPOSES).toEqual([
      "congress-submission-personal-data",
    ]);
  });
});

const completePoster = () => ({
  title: "Ревизионное эндопротезирование",
  authors: [author({ presenting: true })],
  body: { goal: "Показать результаты.", content: "Содержание постера." },
});

const posterFields = (content: unknown) => {
  const result = parseCongressSendContent("poster", content);
  return result.ok ? [] : result.problems.map((p) => p.field);
};

describe("046 congress submissions — posters, birth date and the age rule", () => {
  it("046 EARS-18: the poster send schema takes the title, the authors as an oral talk, the goal and the content", () => {
    const result = parseCongressSendContent("poster", completePoster());
    expect(result.ok).toBe(true);
    expect(posterFields({ ...completePoster(), body: { goal: "g" } })).toEqual([
      "body.content",
    ]);
    expect(
      posterFields({
        ...completePoster(),
        authors: [author(), author({ surname: "Петров" })],
      }),
    ).toEqual(["authors"]);
  });

  it("046 EARS-18: the goal and the content are refused over their 046-design limits (1000 / 3000)", () => {
    expect(CONGRESS_SUBMISSION_LIMITS.posterGoal).toBe(1000);
    expect(CONGRESS_SUBMISSION_LIMITS.posterContent).toBe(3000);
    expect(
      posterFields({
        ...completePoster(),
        body: { goal: "ц".repeat(1001), content: "с".repeat(3001) },
      }),
    ).toEqual(["body.goal", "body.content"]);
    expect(
      posterFields({
        ...completePoster(),
        body: { goal: "ц".repeat(1000), content: "с".repeat(3000) },
      }),
    ).toEqual([]);
  });

  it("046 EARS-18: no file is accepted — the poster draft body holds only the goal and the content", () => {
    expect(parseCongressDraftBody("poster", { goal: "g" })).toEqual({
      goal: "g",
    });
    expect(parseCongressDraftBody("poster", { file: "x.pdf" })).toBeNull();
    expect(parseCongressDraftBody("poster", { summary: "s" })).toBeNull();
  });

  it("046 EARS-19: the birth date is a real calendar day", () => {
    const ok = (birthDate: unknown) =>
      CongressBirthDateRequestSchema.safeParse({ birthDate }).success;
    expect(ok("1987-04-24")).toBe(true);
    expect(ok("1987-02-30")).toBe(false);
    expect(ok("24.04.1987")).toBe(false);
    expect(ok("1899-12-31")).toBe(false);
    expect(ok(null)).toBe(false);
  });

  it("046 EARS-20: the age is the full years on the event's start day — a birthday on that day counts", () => {
    expect(congressAgeOnDay("1987-04-23", "2027-04-23")).toBe(40);
    expect(congressAgeOnDay("1987-04-24", "2027-04-23")).toBe(39);
    expect(congressAgeOnDay("1988-02-29", "2027-02-28")).toBe(38);
    expect(congressAgeOnDay("1988-02-29", "2027-03-01")).toBe(39);
  });

  it("046 EARS-20: the age-limit params carry the limit, the event start day and the age", () => {
    const params = { maxAgeYears: 40, eventStartDate: "2027-04-23", age: 40 };
    expect(CongressAgeLimitParamsSchema.parse(params)).toEqual(params);
    expect(
      CongressSubmissionProblemSchema.safeParse({ code: "age-limit", params })
        .success,
    ).toBe(true);
    expect(congressAgeLimitParams(params)).toEqual(params);
    expect(congressAgeLimitParams(undefined)).toBeNull();
    expect(congressAgeLimitParams({ maxAgeYears: 40 })).toBeNull();
  });
});
