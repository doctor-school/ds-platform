import { describe, expect, it } from "vitest";

import {
  CONGRESS_SUBMISSION_CONSENT_PURPOSES,
  CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE,
} from "./congress-consent.js";
import {
  CONGRESS_SUBMISSION_LIMITS,
  CONGRESS_SUBMISSION_STATUSES,
  CongressSubmissionDraftContentSchema,
  CongressSubmissionProblemSchema,
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
