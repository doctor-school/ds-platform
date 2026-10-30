import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AdminMaterialListQuerySchema,
  CreateMaterialRequestSchema,
  MATERIAL_AUTHOR_LINE_MAX,
  MATERIAL_TITLE_MAX,
  materialPublishMissing,
  UpdateMaterialRequestSchema,
} from "./material.js";
import { emptyMaterialBody } from "./material-body.js";

/** 048 EARS-1, EARS-4, EARS-7, EARS-19 — the material authoring contract. */

const body = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Текст" }] }],
};

const issuePaths = (r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) => (r.success ? [] : r.error!.issues.map((i) => i.path.join(".")));

describe("048 material contract", () => {
  it("048 EARS-1: when a news item is created with a title, an author line and a body, the system shall accept it trimmed", () => {
    const r = CreateMaterialRequestSchema.safeParse({
      kind: "news",
      title: "  Новость  ",
      authorLine: "  Редакция  ",
      body,
    });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ title: "Новость", authorLine: "Редакция" });
  });

  it("048 EARS-1: when the title is empty or longer than 160, the system shall refuse it on `title`", () => {
    for (const title of ["   ", "я".repeat(MATERIAL_TITLE_MAX + 1)]) {
      const r = CreateMaterialRequestSchema.safeParse({ kind: "news", title });
      expect(issuePaths(r)).toContain("title");
    }
    const ok = CreateMaterialRequestSchema.safeParse({
      kind: "news",
      title: "я".repeat(MATERIAL_TITLE_MAX),
    });
    expect(ok.success).toBe(true);
  });

  it("048 EARS-1: when the author line is longer than 120, the system shall refuse it on `authorLine`", () => {
    const r = CreateMaterialRequestSchema.safeParse({
      kind: "news",
      title: "Т",
      authorLine: "а".repeat(MATERIAL_AUTHOR_LINE_MAX + 1),
    });
    expect(issuePaths(r)).toContain("authorLine");
  });

  it("048 EARS-1: when a column is created without an expert, the system shall refuse it on `expertId`", () => {
    const r = CreateMaterialRequestSchema.safeParse({
      kind: "column",
      title: "Колонка",
    });
    expect(issuePaths(r)).toContain("expertId");
  });

  it("048 EARS-1: when a news item names an expert, the system shall refuse it on `expertId`", () => {
    const r = CreateMaterialRequestSchema.safeParse({
      kind: "news",
      title: "Новость",
      expertId: randomUUID(),
    });
    expect(issuePaths(r)).toContain("expertId");
  });

  it("048 EARS-1: when a body is not an allowlisted document, the system shall refuse it on `body`", () => {
    const r = CreateMaterialRequestSchema.safeParse({
      kind: "news",
      title: "Новость",
      body: { type: "doc", content: [{ type: "image" }] },
    });
    expect(issuePaths(r).some((p) => p.startsWith("body"))).toBe(true);
  });

  it("048 EARS-19: when the partner is not a canonical id, the system shall refuse it on `partnerOrganisationId`", () => {
    const r = CreateMaterialRequestSchema.safeParse({
      kind: "news",
      title: "Новость",
      partnerOrganisationId: "acme",
    });
    expect(issuePaths(r)).toContain("partnerOrganisationId");
    const cleared = UpdateMaterialRequestSchema.safeParse({
      partnerOrganisationId: null,
    });
    expect(cleared.success).toBe(true);
  });

  it("048 EARS-1: when the request carries a storage reference or a slug, the system shall refuse the unknown key", () => {
    expect(
      CreateMaterialRequestSchema.safeParse({
        kind: "news",
        title: "Новость",
        coverRef: "x",
      }).success,
    ).toBe(false);
    expect(UpdateMaterialRequestSchema.safeParse({ slug: "x" }).success).toBe(
      false,
    );
  });

  it("048 EARS-4: when a material lacks the body text or a column's published expert, the system shall name each missing item", () => {
    expect(
      materialPublishMissing({
        kind: "column",
        title: "Колонка",
        body: emptyMaterialBody(),
        expertPublished: false,
      }).map((e) => e.path),
    ).toEqual(["body", "expertId"]);
    expect(
      materialPublishMissing({
        kind: "news",
        title: " ",
        body,
        expertPublished: null,
      }).map((e) => e.path),
    ).toEqual(["title"]);
    expect(
      materialPublishMissing({
        kind: "news",
        title: "Новость",
        body,
        expertPublished: null,
      }),
    ).toEqual([]);
  });

  it("048 EARS-7: when the list is queried by title, kind and status, the system shall accept those filters only", () => {
    const r = AdminMaterialListQuerySchema.safeParse({
      q: "грипп",
      kind: "column",
      status: "published",
      page: "2",
    });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ page: 2, kind: "column" });
    expect(
      AdminMaterialListQuerySchema.safeParse({ status: "retired" }).success,
    ).toBe(false);
  });
});
