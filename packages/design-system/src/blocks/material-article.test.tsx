import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MaterialBody } from "@ds/schemas";

import {
  MATERIAL_ARTICLE_COPY,
  MaterialArticle,
  formatMaterialPublishedDay,
  type MaterialArticleContent,
} from "./material-article";

/**
 * 048 EARS-12 (and EARS-3 — the admin preview renders the same block) — the
 * reading page of a material, built from `design-source/academy-material.dc.html`
 * (Stage A approved 2026-11-04, #3514): kind label, title, byline, the partner
 * mark under the byline only when the read carries `partner`, the cover only
 * when there is one, the body through `RichTextContent`, a way back to the
 * Academy home news block, the loading skeleton and the read error with
 * «Повторить».
 */

const body: MaterialBody = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Методология — в обзоре на " },
        {
          type: "text",
          text: "PubMed",
          marks: [
            {
              type: "link",
              attrs: { href: "https://pubmed.ncbi.nlm.nih.gov/" },
            },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Нет общего языка" }],
    },
  ],
};

const column: MaterialArticleContent = {
  kind: "column",
  title: "Ортобиология в России: чего не хватает практике",
  publishedAt: "2026-08-18T21:30:00.000Z",
  author: { name: "Страхов Михаил Андреевич" },
  partner: null,
  cover: null,
  body,
};

const news: MaterialArticleContent = {
  kind: "news",
  title: "Открыт набор центров в исследование PRP",
  publishedAt: "2026-08-15T09:00:00.000Z",
  author: null,
  partner: { name: "Партнёр А" },
  cover: { url: "https://cdn.example/cover.webp" },
  body,
};

describe("MaterialArticle", () => {
  it("EARS-12: renders the kind, the title, the byline with the МСК publication day and the body through RichTextContent", () => {
    render(<MaterialArticle material={column} backHref="/#materials" />);
    const article = screen.getByRole("article");
    expect(within(article).getByText("Колонка эксперта")).toBeInTheDocument();
    expect(
      within(article).getByRole("heading", {
        level: 1,
        name: column.title,
      }),
    ).toBeInTheDocument();
    // 21:30 UTC on 18 August is 00:30 on 19 August in Moscow.
    expect(screen.getByTestId("material-byline")).toHaveTextContent(
      "Страхов Михаил Андреевич · 19 августа",
    );
    expect(
      within(article).getByRole("heading", {
        level: 2,
        name: "Нет общего языка",
      }),
    ).toBeInTheDocument();
    const link = within(article).getByRole("link", { name: "PubMed" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The author is plain text, never a link (no expert page before 031).
    expect(
      within(screen.getByTestId("material-byline")).queryByRole("link"),
    ).toBeNull();
  });

  it("EARS-12: a news item reads «Новость»; without an author the byline is the day alone", () => {
    render(<MaterialArticle material={news} backHref="/#materials" />);
    expect(screen.getByText("Новость")).toBeInTheDocument();
    expect(screen.getByTestId("material-byline")).toHaveTextContent(
      /^15 августа$/,
    );
  });

  it("EARS-12: shows the partner mark under the byline only when the read carries a partner", () => {
    const { rerender } = render(
      <MaterialArticle material={news} backHref="/#materials" />,
    );
    expect(screen.getByTestId("material-partner-mark")).toHaveTextContent(
      "Партнёрский материал · Партнёр А",
    );
    rerender(
      <MaterialArticle
        material={{ ...news, partner: null }}
        backHref="/#materials"
      />,
    );
    expect(screen.queryByTestId("material-partner-mark")).toBeNull();
    expect(screen.queryByText(/Партнёрский материал/)).toBeNull();
  });

  it("EARS-12: renders the cover only when there is one", () => {
    const { rerender } = render(
      <MaterialArticle material={news} backHref="/#materials" />,
    );
    const cover = screen.getByTestId("material-cover");
    expect(cover.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example/cover.webp",
    );
    rerender(<MaterialArticle material={column} backHref="/#materials" />);
    expect(screen.queryByTestId("material-cover")).toBeNull();
  });

  it("EARS-12: offers a way back to the Academy home news block", () => {
    render(<MaterialArticle material={news} backHref="/#materials" />);
    expect(
      screen.getByRole("link", { name: MATERIAL_ARTICLE_COPY.back }),
    ).toHaveAttribute("href", "/#materials");
  });

  it("EARS-12: the read error shows «Повторить» and calls the retry", () => {
    const onRetry = vi.fn();
    render(
      <MaterialArticle
        state="error"
        onRetry={onRetry}
        backHref="/#materials"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      MATERIAL_ARTICLE_COPY.errorTitle,
    );
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("EARS-12: the loading state is a busy status with the skeleton, no article", () => {
    render(<MaterialArticle state="loading" backHref="/#materials" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent(MATERIAL_ARTICLE_COPY.loading);
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("EARS-3: the preview renders the same article with its banner, no date while unpublished and no back link", () => {
    render(
      <MaterialArticle
        material={{ ...news, publishedAt: null, author: { name: "Редакция" } }}
        banner={MATERIAL_ARTICLE_COPY.previewBanner}
      />,
    );
    expect(screen.getByTestId("material-preview-banner")).toHaveTextContent(
      "Предпросмотр — материал не опубликован",
    );
    expect(screen.getByTestId("material-byline")).toHaveTextContent(
      /^Редакция$/,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      news.title,
    );
    expect(
      screen.queryByRole("link", { name: MATERIAL_ARTICLE_COPY.back }),
    ).toBeNull();
  });

  it("EARS-3: an unpublished preview with no author line renders no byline (no empty row, no gap)", () => {
    const { container, rerender } = render(
      <MaterialArticle
        material={{ ...news, publishedAt: null, author: null }}
        banner={MATERIAL_ARTICLE_COPY.previewBanner}
      />,
    );
    expect(screen.queryByTestId("material-byline")).toBeNull();
    expect(screen.getByTestId("material-partner-mark")).toBeInTheDocument();
    rerender(
      <MaterialArticle
        material={{ ...news, publishedAt: null, author: null, partner: null }}
        banner={MATERIAL_ARTICLE_COPY.previewBanner}
      />,
    );
    expect(screen.queryByTestId("material-byline")).toBeNull();
    // The header holds the badge and the title only — no empty meta block.
    expect(container.querySelector("header")?.children).toHaveLength(2);
  });
});

describe("formatMaterialPublishedDay", () => {
  it("EARS-12: is the calendar day in МСК with the month in words", () => {
    expect(formatMaterialPublishedDay("2026-10-27T20:59:00.000Z")).toBe(
      "27 октября",
    );
    expect(formatMaterialPublishedDay("2026-10-27T21:00:00.000Z")).toBe(
      "28 октября",
    );
  });
});
