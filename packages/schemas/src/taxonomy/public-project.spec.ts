import { describe, expect, it } from "vitest";
import {
  PublicProjectCatalogItemSchema,
  PublicProjectResultSchema,
  PublicProjectSchema,
} from "./public-project.js";

const item = {
  slug: "ortobiologiya",
  title: "Ортобиология",
  description: "О проекте",
  coverUrl: null,
  stage: "soon",
  stageNote: "идёт набор команды",
  outputs: ["Школа", "Подкаст"],
  investor: { title: "Фарма Плюс", logoUrl: null },
};

const page = {
  slug: "ortobiologiya",
  title: "Ортобиология",
  description: "О проекте",
  coverUrl: null,
  stage: "running",
  stageNote: null,
  curatorName: "Иванова Анна Сергеевна",
  resultCount: 2,
  expertCount: 3,
  sinceYear: 2024,
  organisations: [
    {
      title: "Фарма Плюс",
      logoUrl: null,
      roleTitle: "Инвестор проекта",
      note: null,
      isInvestor: true,
    },
  ],
  investorPlaceOpen: false,
};

describe("030 public project contract", () => {
  it("EARS-8: a catalog item shall carry no project kind, status or storage key", () => {
    expect(PublicProjectCatalogItemSchema.parse(item)).toEqual(item);
    for (const leak of [
      { kind: "school" },
      { legacyKind: "school" },
      { status: "published" },
      { coverRef: "taxonomy/projects/covers/a.webp" },
      { id: "22222222-2222-4222-8222-222222222222" },
    ]) {
      expect(
        PublicProjectCatalogItemSchema.safeParse({ ...item, ...leak }).success,
        JSON.stringify(leak),
      ).toBe(false);
    }
    expect(
      PublicProjectCatalogItemSchema.safeParse({
        ...item,
        investor: { ...item.investor, slug: "farma" },
      }).success,
    ).toBe(false);
  });

  it("EARS-13: the project read shall carry the curator's name and nothing else of the curator", () => {
    expect(PublicProjectSchema.parse(page)).toEqual(page);
    for (const leak of [
      { curator: { slug: "ivanova" } },
      { curatorSlug: "ivanova" },
      { kind: "school" },
    ]) {
      expect(
        PublicProjectSchema.safeParse({ ...page, ...leak }).success,
        JSON.stringify(leak),
      ).toBe(false);
    }
  });

  it("EARS-13: a result shall carry no row id, since results are replaced as a set", () => {
    const result = {
      kindTitle: "Школа",
      title: "Школа ортобиологии",
      description: null,
      storefrontUrl: "https://doctor.school/schools/ortho",
    };
    expect(PublicProjectResultSchema.parse(result)).toEqual(result);
    expect(
      PublicProjectResultSchema.safeParse({
        ...result,
        id: "22222222-2222-4222-8222-222222222222",
      }).success,
    ).toBe(false);
  });
});
