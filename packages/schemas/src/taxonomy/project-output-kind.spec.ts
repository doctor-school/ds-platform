import { describe, expect, it } from "vitest";

import {
  CreateProjectOutputKindRequestSchema,
  PROJECT_RESULTS_MAX,
  ReplaceProjectResultsRequestSchema,
  UpdateProjectOutputKindRequestSchema,
} from "./project-output-kind.js";
import {
  CreateProjectRequestSchema,
  STAGE_NOTE_REQUIRED_MESSAGE,
  TAXONOMY_ERROR_CODES,
  UpdateProjectRequestSchema,
} from "./taxonomy.schema.js";

// 030 EARS-1 / EARS-2 / EARS-3 — the project form, results set and output-kind
// contract (030-design §Data model, §Endpoints).

const KIND = "03000000-0000-4000-8000-000000000001";

function result(overrides: Record<string, unknown> = {}) {
  return { outputKindId: KIND, title: "Школа кардиологии", ...overrides };
}

describe("030 project form, results and output-kind contract (SSOT)", () => {
  it("030 EARS-1: when a project is created without a stage, the system shall default it to soon and require the stage note", () => {
    const base = { title: "Проект", defaultAudience: "doctors" };
    const missing = CreateProjectRequestSchema.safeParse(base);
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]).toMatchObject({
      path: ["stageNote"],
      message: STAGE_NOTE_REQUIRED_MESSAGE,
    });
    const parsed = CreateProjectRequestSchema.parse({
      ...base,
      stageNote: "  Набираем экспертов  ",
    });
    expect(parsed.stage).toBe("soon");
    expect(parsed.stageNote).toBe("Набираем экспертов");
  });

  it("030 EARS-1: when the stage is running or completed, the system shall not require a stage note; the stage set is closed and the note is 1–80", () => {
    for (const stage of ["running", "completed"]) {
      expect(
        CreateProjectRequestSchema.safeParse({
          title: "Проект",
          defaultAudience: "doctors",
          stage,
        }).success,
      ).toBe(true);
    }
    expect(
      CreateProjectRequestSchema.safeParse({
        title: "Проект",
        defaultAudience: "doctors",
        stage: "paused",
      }).success,
    ).toBe(false);
    expect(
      UpdateProjectRequestSchema.safeParse({ stageNote: "x".repeat(81) })
        .success,
    ).toBe(false);
    expect(UpdateProjectRequestSchema.safeParse({ stageNote: "   " }).success).toBe(
      false,
    );
  });

  it("030 EARS-1: the project form shall offer no project kind on create or edit", () => {
    expect(
      CreateProjectRequestSchema.safeParse({
        title: "Проект",
        defaultAudience: "doctors",
        stage: "running",
        kind: "school",
      }).success,
    ).toBe(false);
    expect(UpdateProjectRequestSchema.safeParse({ kind: "media" }).success).toBe(
      false,
    );
  });

  it("030 EARS-2: when results are saved, the system shall accept an ordered list of 0–20 and refuse a 21st", () => {
    expect(
      ReplaceProjectResultsRequestSchema.safeParse({ results: [] }).success,
    ).toBe(true);
    const twenty = Array.from({ length: PROJECT_RESULTS_MAX }, () => result());
    expect(
      ReplaceProjectResultsRequestSchema.safeParse({ results: twenty }).success,
    ).toBe(true);
    expect(
      ReplaceProjectResultsRequestSchema.safeParse({
        results: [...twenty, result()],
      }).success,
    ).toBe(false);
  });

  it("030 EARS-2: a result title is trimmed 1–120, its description 0–300 (empty ⇒ none), and the kind is a stable id", () => {
    const parsed = ReplaceProjectResultsRequestSchema.parse({
      results: [result({ title: "  Курс  ", description: "   " })],
    });
    expect(parsed.results[0]).toMatchObject({
      title: "Курс",
      description: null,
      storefrontUrl: null,
    });
    for (const bad of [
      result({ title: "" }),
      result({ title: "x".repeat(121) }),
      result({ description: "x".repeat(301) }),
      result({ outputKindId: "school" }),
    ]) {
      expect(
        ReplaceProjectResultsRequestSchema.safeParse({ results: [bad] })
          .success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("030 EARS-2: a storefront link shall be an absolute HTTPS URL", () => {
    for (const bad of [
      "http://doctor.school/events/x",
      "/events/x",
      "doctor.school/events/x",
      "javascript:alert(1)",
    ]) {
      expect(
        ReplaceProjectResultsRequestSchema.safeParse({
          results: [result({ storefrontUrl: bad })],
        }).success,
        bad,
      ).toBe(false);
    }
    expect(
      ReplaceProjectResultsRequestSchema.parse({
        results: [result({ storefrontUrl: "https://doctor.school/events/x" })],
      }).results[0]?.storefrontUrl,
    ).toBe("https://doctor.school/events/x");
  });

  it("030 EARS-3: an output kind title is trimmed 1–60 and the slug is never authored", () => {
    expect(
      CreateProjectOutputKindRequestSchema.parse({ title: "  Клуб  " }).title,
    ).toBe("Клуб");
    expect(
      CreateProjectOutputKindRequestSchema.safeParse({ title: "x".repeat(61) })
        .success,
    ).toBe(false);
    expect(
      CreateProjectOutputKindRequestSchema.safeParse({
        title: "Клуб",
        slug: "klub",
      }).success,
    ).toBe(false);
    expect(
      UpdateProjectOutputKindRequestSchema.safeParse({ title: "" }).success,
    ).toBe(false);
  });

  it("030 EARS-3: retiring a held kind has its own stable refusal code", () => {
    expect(TAXONOMY_ERROR_CODES).toContain("OUTPUT_KIND_IN_USE");
  });
});
