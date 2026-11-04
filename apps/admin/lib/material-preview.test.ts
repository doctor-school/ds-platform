import { describe, expect, it } from "vitest";
import { emptyMaterialBody } from "@ds/schemas";

import { materialPreviewContent } from "./material-preview";

/**
 * 048 EARS-3 (#3514) — «Предпросмотр» shows the CURRENT, possibly unsaved,
 * form content as the reading page renders it. This projection turns the form
 * state into the `MaterialArticle` content the preview `Sheet` mounts — the
 * same shape the public material read gives the Academy page.
 */

const body = emptyMaterialBody();

describe("materialPreviewContent", () => {
  it("EARS-3: a news item previews its typed title, trimmed author line and body, with no date while unpublished", () => {
    expect(
      materialPreviewContent({
        kind: "news",
        title: "  Совместная программа  ",
        authorLine: "  Редакция Академии ",
        expertName: "Страхов Михаил Андреевич",
        partnerName: null,
        coverUrl: null,
        firstPublishedAt: null,
        body,
      }),
    ).toEqual({
      kind: "news",
      title: "Совместная программа",
      publishedAt: null,
      author: { name: "Редакция Академии" },
      partner: null,
      cover: null,
      body,
    });
  });

  it("EARS-3: a column previews the chosen expert as its author, the chosen partner and the cover in hand", () => {
    const content = materialPreviewContent({
      kind: "column",
      title: "Чего не хватает ортобиологии",
      authorLine: "ignored for a column",
      expertName: "Страхов Михаил Андреевич",
      partnerName: "Партнёр А",
      coverUrl: "blob:http://admin/cover",
      firstPublishedAt: "2026-08-19T09:00:00.000Z",
      body,
    });
    expect(content.author).toEqual({ name: "Страхов Михаил Андреевич" });
    expect(content.partner).toEqual({ name: "Партнёр А" });
    expect(content.cover).toEqual({ url: "blob:http://admin/cover" });
    expect(content.publishedAt).toBe("2026-08-19T09:00:00.000Z");
  });

  it("EARS-3: an empty author line, no expert and no partner preview as absent", () => {
    const news = materialPreviewContent({
      kind: "news",
      title: "",
      authorLine: "   ",
      expertName: null,
      partnerName: null,
      coverUrl: null,
      firstPublishedAt: null,
      body,
    });
    expect(news.author).toBeNull();
    expect(news.partner).toBeNull();
    const column = materialPreviewContent({
      kind: "column",
      title: "",
      authorLine: "",
      expertName: null,
      partnerName: null,
      coverUrl: null,
      firstPublishedAt: null,
      body,
    });
    expect(column.author).toBeNull();
  });
});
