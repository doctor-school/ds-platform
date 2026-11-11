import { render, screen } from "@testing-library/react";
import type { FeedCard as FeedCardData } from "@ds/schemas";
import { describe, expect, it } from "vitest";

import { FeedCard, FeedCardSkeleton } from "./feed-card";

// 048 V-7 (feed-card half) — the shared feed card of
// `design-source/unit-feed-card.dc.html`, slice 1 (EARS-13, EARS-19).

const NOW = new Date("2026-11-11T09:00:00Z");

function card(overrides: Partial<FeedCardData> = {}): FeedCardData {
  return {
    id: "8d4f0b56-3c0e-4c3a-9a51-0e4b3b8f1a01",
    kind: "news",
    title: "Открыт набор центров в исследование эффективности PRP",
    publishedAt: "2026-08-19T10:00:00Z",
    image: { url: "https://cdn.example/cover.jpg" },
    source: { platform: "academy", name: "Академия" },
    partner: null,
    href: "/materials/prp-centres",
    ...overrides,
  } as FeedCardData;
}

describe("FeedCard", () => {
  it("048 EARS-13: when the card has an image, system shall render it as the cover", () => {
    const { container } = render(<FeedCard card={card()} now={NOW} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn.example/cover.jpg");
    expect(img?.getAttribute("alt")).toBe("");
    expect(container.querySelector('[data-feed-card-media="none"]')).toBeNull();
  });

  it("048 EARS-13: when the card has no image, system shall render the no-image layout", () => {
    const { container } = render(
      <FeedCard card={card({ image: null })} now={NOW} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[data-feed-card-media="none"]'),
    ).not.toBeNull();
  });

  it("048 EARS-13: a news card shall show the kind mark «Новость» and the source «Академия» with the Academy logo", () => {
    const { container } = render(
      <FeedCard
        card={card()}
        now={NOW}
        logo={<svg data-testid="academy-logo" />}
      />,
    );
    expect(screen.getByText("Новость")).toBeTruthy();
    expect(screen.getByText("Академия")).toBeTruthy();
    expect(screen.getByTestId("academy-logo")).toBeTruthy();
    expect(
      container.querySelector('[data-feed-card-avatar="initials"]'),
    ).toBeNull();
  });

  it("048 EARS-13: a column card shall show «Колонка эксперта», the expert's «Фамилия И. О.» and the initials avatar", () => {
    const { container } = render(
      <FeedCard
        card={card({
          kind: "column",
          source: { platform: "academy", name: "Страхов М. А." },
        })}
        now={NOW}
      />,
    );
    expect(screen.getByText("Колонка эксперта")).toBeTruthy();
    expect(screen.getByText("Страхов М. А.")).toBeTruthy();
    const avatar = container.querySelector(
      '[data-feed-card-avatar="initials"]',
    );
    expect(avatar?.textContent).toBe("СМ");
    expect(screen.queryByText("Академия")).toBeNull();
  });

  it("048 EARS-13: the date shall be day and month in Moscow time when it is the current year", () => {
    // 21:30 UTC on 18 August is already 19 August in Moscow (UTC+3).
    render(
      <FeedCard
        card={card({ publishedAt: "2026-08-18T21:30:00Z" })}
        now={NOW}
      />,
    );
    expect(screen.getByText("19 августа")).toBeTruthy();
  });

  it("048 EARS-13: the date shall carry the year when it is not the current Moscow year", () => {
    render(
      <FeedCard
        card={card({ publishedAt: "2025-03-04T10:00:00Z" })}
        now={NOW}
      />,
    );
    expect(screen.getByText("4 марта 2025")).toBeTruthy();
  });

  it("048 EARS-13: the whole card shall be exactly one link to its href in the same tab", () => {
    const { container } = render(<FeedCard card={card()} now={NOW} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("/materials/prp-centres");
    expect(links[0]?.hasAttribute("target")).toBe(false);
    expect(container.querySelectorAll("button, input, select")).toHaveLength(0);
    expect(links[0]?.textContent).toContain(
      "Открыт набор центров в исследование эффективности PRP",
    );
  });

  it("048 EARS-13: a title word longer than the card width shall wrap inside the card, not be cut at its edge", () => {
    // Driven on the Academy home @1440 (#3516): «Антибиотикорезистентность:»
    // in an 18px bold title is wider than the 260px text box and was clipped
    // by the clamp's `overflow: hidden`.
    render(
      <FeedCard
        card={card({ title: "Антибиотикорезистентность: что изменилось" })}
        now={NOW}
      />,
    );
    const title = screen.getByText("Антибиотикорезистентность: что изменилось");
    expect(title.className).toContain("wrap-break-word");
  });

  it("048 EARS-19: when the card has a partner, system shall show «Партнёрский материал · <name>»", () => {
    render(
      <FeedCard card={card({ partner: { name: "Партнёр А" } })} now={NOW} />,
    );
    expect(screen.getByText("Партнёрский материал · Партнёр А")).toBeTruthy();
  });

  it("048 EARS-19: a card without a partner shall show no partner mark", () => {
    render(<FeedCard card={card()} now={NOW} />);
    expect(screen.queryByText(/Партнёрский материал/)).toBeNull();
  });

  it("048 EARS-16: the placeholder card shall be hidden from assistive tech and hold no link", () => {
    const { container } = render(<FeedCardSkeleton />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(container.querySelector("a")).toBeNull();
  });
});
