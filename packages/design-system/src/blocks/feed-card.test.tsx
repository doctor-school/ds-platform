import { fireEvent, render, screen } from "@testing-library/react";
import type {
  FeedCard as FeedCardData,
  FeedPostCard,
  FeedVideoCard,
} from "@ds/schemas";
import { describe, expect, it } from "vitest";

import {
  FEED_CARD_COPY,
  FeedCard,
  FeedCardSkeleton,
  formatFeedDuration,
  type FeedContentCardData,
  type FeedContentRowData,
} from "./feed-card";

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
    // in a 20px bold title is wider than the 260px text box and was clipped
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

  it("048 EARS-13: when the title is clamped, system shall keep every clamped line inside the card body", () => {
    // Mode (a) on #3973: at `leading-snug` (27.5px lines) a 3-line clamp under
    // the partner line needs more than the fixed body leaves, and the last
    // line's descenders were clipped. The canvas line is 23px
    // (`unit-feed-card.dc.html`), the `leading-title` token (1.15 × 20px).
    const title =
      "Клинические рекомендации по ведению артериальной гипертензии";
    render(
      <FeedCard
        card={card({ title, partner: { name: "Партнёр А" } })}
        now={NOW}
      />,
    );
    const el = screen.getByText(title);
    expect(el.className).toContain("leading-title");
    expect(el.className).not.toContain("leading-snug");
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

/**
 * 023 EARS-5, EARS-22 — the doctor content card, variant Б (`kind: "content"`,
 * `design-source/unit-content-card.dc.html`): a metric column, the kicker and
 * scope, the title, the description, the facts line, the done mark, the
 * partner mark and the call to action — one same-tab link.
 */
describe("FeedCard — doctor content card (variant Б)", () => {
  const content = (
    over: Partial<FeedContentCardData> = {},
  ): FeedContentCardData => ({
    kind: "content",
    href: "/courses/osnovy",
    kicker: "Курс",
    scope: "Школа ортобиологии",
    title: "Ортобиология. Базовый",
    description: "Три модуля по шесть уроков.",
    metric: { value: "18", label: "уроков" },
    facts: ["36 академических часов", "Сертификат НМО"],
    state: null,
    partner: null,
    cta: "Открыть путь курса →",
    ...over,
  });

  it("023 EARS-5: system shall render the course as one link with its metric, facts and call to action", () => {
    render(<FeedCard card={content()} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("/courses/osnovy");
    expect(links[0]?.textContent).toContain("18");
    expect(links[0]?.textContent).toContain("уроков");
    expect(links[0]?.textContent).toContain(
      "36 академических часов · Сертификат НМО",
    );
    expect(links[0]?.textContent).toContain("Открыть путь курса →");
    expect(screen.queryByText(FEED_CARD_COPY.done)).toBeNull();
  });

  it("023 EARS-5: a done course shows the done mark", () => {
    render(<FeedCard card={content({ state: "done" })} />);
    expect(screen.getByText(FEED_CARD_COPY.done)).toBeTruthy();
  });

  it("023 EARS-5: a done card is not dimmed — its texts keep WCAG AA contrast (axe color-contrast)", () => {
    const { container } = render(
      <FeedCard card={content({ state: "done" })} />,
    );
    const card = container.querySelector('[data-feed-card="content"]');
    expect(card?.className).not.toMatch(/\bopacity-/);
  });

  it("023 EARS-22: system shall show the partner mark only WHILE the course carries a partner", () => {
    const { rerender } = render(<FeedCard card={content()} />);
    expect(screen.queryByText(/Партнёрский материал/)).toBeNull();
    rerender(<FeedCard card={content({ partner: { name: "Партнёр А" } })} />);
    expect(screen.getByText("Партнёрский материал · Партнёр А")).toBeTruthy();
  });

  it("023 EARS-5: on a phone the card has no frame — no border, no offset shadow (canvas `m`: border:0; box-shadow:none); from the layout breakpoint it is framed", () => {
    const { container } = render(<FeedCard card={content()} />);
    const card = container.querySelector('[data-feed-card="content"]');
    const classes = (card?.className ?? "").split(/\s+/);
    expect(classes).toContain("border-0");
    expect(classes).toContain("shadow-none");
    expect(classes).toContain("layout:border-2");
    expect(classes).toContain("layout:shadow-lg");
    expect(classes).not.toContain("border-2");
    expect(classes).not.toContain("shadow-lg");
  });
});

/**
 * 023 EARS-5 — the course row, variant В «строка» of
 * `design-source/unit-content-card.dc.html` (`kind: "content-row"`): the
 * kicker, the title, the meta and the arrow — one same-tab link.
 */
describe("FeedCard — doctor content row (variant В)", () => {
  const row = (over: Partial<FeedContentRowData> = {}): FeedContentRowData => ({
    kind: "content-row",
    href: "/courses/tendinopatii",
    kicker: "Курс",
    title: "Тендинопатии",
    meta: "6 уроков",
    ...over,
  });

  it("023 EARS-5: system shall render a course row as one link with its kicker, title, meta and arrow", () => {
    const { container } = render(<FeedCard card={row()} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("/courses/tendinopatii");
    expect(links[0]?.textContent).toContain("Курс");
    expect(links[0]?.textContent).toContain("Тендинопатии");
    expect(links[0]?.textContent).toContain("6 уроков");
    expect(links[0]?.textContent).toContain("→");
    expect(container.querySelector('[data-feed-card="content-row"]')).toBe(
      links[0],
    );
  });

  it("023 EARS-5: on a phone a row is separated by a hairline; from the layout breakpoint it is framed", () => {
    const { container } = render(<FeedCard card={row()} />);
    const classes = (
      container.querySelector('[data-feed-card="content-row"]')?.className ?? ""
    ).split(/\s+/);
    expect(classes).toContain("border-b");
    expect(classes).toContain("border-hairline");
    expect(classes).toContain("layout:border-2");
    expect(classes).toContain("layout:border-border");
  });
});

// 048 V-20 — the `post` variant (Telegram, EARS-34), Stage A #3997 comment
// 6941007863 with its four lead corrections.

const TEXT_GLYPH = "︎";

function post(overrides: Partial<FeedPostCard> = {}): FeedPostCard {
  return {
    id: "1b7e4d2a-5f60-4c1d-8a3e-2c9f0d6b7e11",
    kind: "post",
    text: "Сегодня в 19:00 МСК — эфир о показаниях к PRP",
    publishedAt: "2026-11-12T10:00:00Z",
    image: { url: "https://cdn.example/tg-1201.jpg" },
    duration: null,
    source: { platform: "telegram", name: "BBM Academy · Telegram" },
    partner: null,
    href: "https://t.me/bbmacademy/1201",
    external: true,
    ...overrides,
  };
}

describe("FeedCard post (Telegram)", () => {
  it("048 EARS-34: a post with an image shall show the image and no play mark", () => {
    const { container } = render(<FeedCard card={post()} now={NOW} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example/tg-1201.jpg",
    );
    expect(container.querySelector("[data-feed-card-play]")).toBeNull();
    expect(container.querySelector("[data-feed-card-duration]")).toBeNull();
  });

  it("048 EARS-34: a video post with a preview shall show the play mark and the duration as m:ss", () => {
    const { container } = render(
      <FeedCard card={post({ duration: 72 })} now={NOW} />,
    );
    expect(container.querySelector("img")).not.toBeNull();
    const play = container.querySelector("[data-feed-card-play]");
    expect(play?.getAttribute("aria-hidden")).toBe("true");
    expect(play?.textContent).toBe(`▶${TEXT_GLYPH}`);
    expect(
      container.querySelector("[data-feed-card-duration]")?.textContent,
    ).toBe("1:12");
    expect(container.querySelector("video, iframe, audio")).toBeNull();
  });

  it("048 EARS-34: the duration shall be h:mm:ss from one hour", () => {
    expect(formatFeedDuration(0)).toBe("0:00");
    expect(formatFeedDuration(59)).toBe("0:59");
    expect(formatFeedDuration(72)).toBe("1:12");
    expect(formatFeedDuration(3599)).toBe("59:59");
    expect(formatFeedDuration(3600)).toBe("1:00:00");
    expect(formatFeedDuration(3725)).toBe("1:02:05");
    const { container } = render(
      <FeedCard card={post({ duration: 3725 })} now={NOW} />,
    );
    expect(
      container.querySelector("[data-feed-card-duration]")?.textContent,
    ).toBe("1:02:05");
  });

  it("048 EARS-34: a post without an image shall use the no-image layout with the field mark «Telegram»", () => {
    const { container } = render(
      <FeedCard card={post({ image: null })} now={NOW} />,
    );
    expect(container.querySelector("img")).toBeNull();
    const none = container.querySelector('[data-feed-card-media="none"]');
    expect(none?.textContent).toBe("Telegram");
  });

  it("048 EARS-34: a video post without a copied preview shall use the plain no-image layout, with no play mark", () => {
    const { container } = render(
      <FeedCard card={post({ image: null, duration: 72 })} now={NOW} />,
    );
    expect(
      container.querySelector('[data-feed-card-media="none"]')?.textContent,
    ).toBe("Telegram");
    expect(container.querySelector("[data-feed-card-play]")).toBeNull();
    expect(container.querySelector("[data-feed-card-duration]")).toBeNull();
    expect(screen.queryByText(/Превью видео/)).toBeNull();
  });

  it("048 EARS-34: the source shall read «BBM Academy · Telegram» in full, with the Academy logo and the chip «TG» named «Telegram»", () => {
    const { container } = render(
      <FeedCard
        card={post()}
        now={NOW}
        logo={<svg data-testid="academy-logo" />}
      />,
    );
    const source = screen.getByText("BBM Academy · Telegram");
    expect(source.className).not.toContain("truncate");
    expect(source.className).toContain("wrap-break-word");
    expect(screen.getByTestId("academy-logo")).toBeTruthy();
    const chip = screen.getByRole("img", { name: "Telegram" });
    expect(chip.textContent).toBe("TG");
    expect(
      container.querySelector('[data-feed-card-avatar="initials"]'),
    ).toBeNull();
  });

  it("048 EARS-34: a post shall show no kind badge and no partner line", () => {
    render(<FeedCard card={post()} now={NOW} />);
    expect(screen.queryByText("Новость")).toBeNull();
    expect(screen.queryByText("Колонка эксперта")).toBeNull();
    expect(screen.queryByText(/Партнёрский материал/)).toBeNull();
  });

  it("048 EARS-34: the post text shall be clamped to the six body lines the card holds", () => {
    const text =
      "Сегодня в 19:00 МСК — эфир о показаниях к PRP. Михаил Страхов разберёт три клинических случая и ответит на вопросы коллег. Регистрация — по ссылке в профиле канала, запись появится на сайте Академии через пару дней.";
    render(<FeedCard card={post({ text })} now={NOW} />);
    const el = screen.getByText(text);
    expect(el.className).toContain("line-clamp-6");
    expect(el.className).toContain("text-base");
    expect(el.className).toContain("wrap-break-word");
  });

  it("048 EARS-34: a post with empty text shall render the card without a text block", () => {
    const { container } = render(
      <FeedCard card={post({ text: "" })} now={NOW} />,
    );
    expect(container.querySelector("[data-feed-card-text]")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("048 EARS-34: the date shall follow EARS-13", () => {
    render(<FeedCard card={post()} now={NOW} />);
    expect(screen.getByText("12 ноября")).toBeTruthy();
  });

  it("048 EARS-34: the card shall show «Telegram ↗» as text glyphs with the hidden new-tab text", () => {
    const { container } = render(<FeedCard card={post()} now={NOW} />);
    const mark = container.querySelector("[data-feed-card-external]");
    expect(mark?.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      `Telegram ↗${TEXT_GLYPH}`,
    );
    expect(mark?.querySelector(".sr-only")?.textContent).toBe(
      ", откроется в новой вкладке на площадке Telegram",
    );
  });

  it("048 EARS-34: the whole card shall be one link to its t.me href opening in a new tab", () => {
    const { container } = render(<FeedCard card={post()} now={NOW} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://t.me/bbmacademy/1201");
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelectorAll("button, input, select")).toHaveLength(0);
    expect(links[0]?.textContent).toContain(
      ", откроется в новой вкладке на площадке Telegram",
    );
  });
});

// 048 V-32 — the VK `post` and the `video` variants (EARS-49), canvas
// `unit-feed-card.dc.html` `source` = «vk» / «vk-видео».

function vkPost(overrides: Partial<FeedPostCard> = {}): FeedPostCard {
  return post({
    text: "Записали первый выпуск второго сезона подкаста «Кто стоит за брендом».",
    image: { url: "https://sun9-1.userapi.com/impg/wall.jpg" },
    source: { platform: "vk", name: "BBM Academy · VK" },
    href: "https://vk.com/wall-123456_789",
    ...overrides,
  });
}

function vkVideo(overrides: Partial<FeedVideoCard> = {}): FeedVideoCard {
  return {
    id: "3a1c6d2f-8b5e-4d4c-9f30-7b8c9d0e1f2a",
    kind: "video",
    title: "Как устроен проект «Ортобиология» — за минуту",
    publishedAt: "2026-11-12T10:00:00Z",
    image: { url: "https://sun9-2.userapi.com/impg/cover.jpg" },
    duration: 72,
    source: { platform: "vk", name: "BBM Academy · VK Видео" },
    partner: null,
    href: "https://vk.com/video-123456_456239017",
    external: true,
    ...overrides,
  };
}

describe("FeedCard post (VK)", () => {
  it("048 EARS-49: a VK post shall show the referenced image sent with no referrer", () => {
    const { container } = render(<FeedCard card={vkPost()} now={NOW} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      "https://sun9-1.userapi.com/impg/wall.jpg",
    );
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(container.querySelector("[data-feed-card-play]")).toBeNull();
  });

  it("048 EARS-49: a VK video post shall show the play mark and the duration, and nothing plays inside the card", () => {
    const { container } = render(
      <FeedCard card={vkPost({ duration: 3725 })} now={NOW} />,
    );
    expect(container.querySelector("[data-feed-card-play]")).not.toBeNull();
    expect(
      container.querySelector("[data-feed-card-duration]")?.textContent,
    ).toBe("1:02:05");
    expect(container.querySelector("video, iframe, audio")).toBeNull();
  });

  it("048 EARS-49: a VK post without an image shall use the no-image layout with the field mark «VK»", () => {
    const { container } = render(
      <FeedCard card={vkPost({ image: null, duration: 72 })} now={NOW} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[data-feed-card-media="none"]')?.textContent,
    ).toBe("VK");
    expect(container.querySelector("[data-feed-card-play]")).toBeNull();
  });

  it("048 EARS-49: when the referenced preview fails to load, the VK post shall show its no-image layout", () => {
    const { container } = render(
      <FeedCard card={vkPost({ duration: 72 })} now={NOW} />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[data-feed-card-media="none"]')?.textContent,
    ).toBe("VK");
    expect(container.querySelector("[data-feed-card-play]")).toBeNull();
  });

  it("048 EARS-49: the source shall read «BBM Academy · VK» with the Academy logo and the chip «VK» named «VK»; no kind badge", () => {
    render(
      <FeedCard
        card={vkPost()}
        now={NOW}
        logo={<svg data-testid="academy-logo" />}
      />,
    );
    expect(screen.getByText("BBM Academy · VK")).toBeTruthy();
    expect(screen.getByTestId("academy-logo")).toBeTruthy();
    expect(screen.getByRole("img", { name: "VK" }).textContent).toBe("VK");
    expect(screen.queryByText("Новость")).toBeNull();
    expect(screen.queryByText(/Партнёрский материал/)).toBeNull();
  });

  it("048 EARS-49: the VK post shall be one link to its vk.com href in a new tab, marked «VK ↗» with the hidden new-tab text", () => {
    const { container } = render(<FeedCard card={vkPost()} now={NOW} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(
      "https://vk.com/wall-123456_789",
    );
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    const mark = container.querySelector("[data-feed-card-external]");
    expect(mark?.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      `VK ↗${TEXT_GLYPH}`,
    );
    expect(mark?.querySelector(".sr-only")?.textContent).toBe(
      ", откроется в новой вкладке на площадке VK",
    );
  });

  it("048 EARS-49: a preview that already failed before the card mounted (a server-rendered page) shall show the no-image layout", () => {
    const proto = HTMLImageElement.prototype;
    const complete = Object.getOwnPropertyDescriptor(proto, "complete");
    const naturalWidth = Object.getOwnPropertyDescriptor(proto, "naturalWidth");
    Object.defineProperty(proto, "complete", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(proto, "naturalWidth", {
      configurable: true,
      get: () => 0,
    });
    try {
      const { container } = render(<FeedCard card={vkVideo()} now={NOW} />);
      expect(container.querySelector("img")).toBeNull();
      expect(
        container.querySelector('[data-feed-card-media="none"]')?.textContent,
      ).toBe("VK Видео");
    } finally {
      if (complete) Object.defineProperty(proto, "complete", complete);
      if (naturalWidth)
        Object.defineProperty(proto, "naturalWidth", naturalWidth);
    }
  });

  it("048 EARS-49: a Telegram post keeps its image as it was — no referrer policy", () => {
    const { container } = render(<FeedCard card={post()} now={NOW} />);
    expect(container.querySelector("img")?.hasAttribute("referrerpolicy")).toBe(
      false,
    );
  });
});

describe("FeedCard video (VK Видео)", () => {
  it("048 EARS-49: a video shall show the cover with the play mark and the duration, sent with no referrer", () => {
    const { container } = render(<FeedCard card={vkVideo()} now={NOW} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      "https://sun9-2.userapi.com/impg/cover.jpg",
    );
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    const play = container.querySelector("[data-feed-card-play]");
    expect(play?.getAttribute("aria-hidden")).toBe("true");
    expect(play?.textContent).toBe(`▶${TEXT_GLYPH}`);
    expect(
      container.querySelector("[data-feed-card-duration]")?.textContent,
    ).toBe("1:12");
    expect(container.querySelector("video, iframe, audio")).toBeNull();
  });

  it("048 EARS-49: a video without a cover shall use the no-image layout with the field mark «VK Видео» and no play mark", () => {
    const { container } = render(
      <FeedCard card={vkVideo({ image: null })} now={NOW} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[data-feed-card-media="none"]')?.textContent,
    ).toBe("VK Видео");
    expect(container.querySelector("[data-feed-card-play]")).toBeNull();
    expect(container.querySelector("[data-feed-card-duration]")).toBeNull();
  });

  it("048 EARS-49: when the cover fails to load, the video shall show its no-image layout", () => {
    const { container } = render(<FeedCard card={vkVideo()} now={NOW} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[data-feed-card-media="none"]')?.textContent,
    ).toBe("VK Видео");
    expect(container.querySelector("[data-feed-card-play]")).toBeNull();
  });

  it("048 EARS-49: the source shall read «BBM Academy · VK Видео» with the Academy logo and the chip «VK▶» named «VK Видео»; no kind badge, no partner", () => {
    const { container } = render(
      <FeedCard
        card={vkVideo()}
        now={NOW}
        logo={<svg data-testid="academy-logo" />}
      />,
    );
    const source = screen.getByText("BBM Academy · VK Видео");
    expect(source.className).toContain("wrap-break-word");
    expect(screen.getByTestId("academy-logo")).toBeTruthy();
    expect(screen.getByRole("img", { name: "VK Видео" }).textContent).toBe(
      `VK▶${TEXT_GLYPH}`,
    );
    expect(
      container.querySelector('[data-feed-card-avatar="initials"]'),
    ).toBeNull();
    expect(screen.queryByText("Новость")).toBeNull();
    expect(screen.queryByText(/Партнёрский материал/)).toBeNull();
  });

  it("048 EARS-49: the title shall be clamped to the six title lines the card holds, and the date follow EARS-13", () => {
    render(<FeedCard card={vkVideo()} now={NOW} />);
    const title = screen.getByText(
      "Как устроен проект «Ортобиология» — за минуту",
    );
    expect(title.className).toContain("line-clamp-6");
    expect(title.className).toContain("text-lg");
    expect(title.className).toContain("wrap-break-word");
    expect(screen.getByText("12 ноября")).toBeTruthy();
  });

  it("048 EARS-49: the video shall be one link to its vk.com href in a new tab, marked «VK Видео ↗» with the hidden new-tab text", () => {
    const { container } = render(<FeedCard card={vkVideo()} now={NOW} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(
      "https://vk.com/video-123456_456239017",
    );
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelectorAll("button, input, select")).toHaveLength(0);
    const mark = container.querySelector("[data-feed-card-external]");
    expect(mark?.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      `VK Видео ↗${TEXT_GLYPH}`,
    );
    expect(mark?.querySelector(".sr-only")?.textContent).toBe(
      ", откроется в новой вкладке на площадке VK Видео",
    );
  });
});

/**
 * 048 EARS-14 — the card and its placeholder draw the token values of the
 * re-vendored `design-source/unit-feed-card.dc.html` (#4273, #4277): every
 * size, tracking and leading below is the canvas `var(--…)` token's utility.
 */
describe("FeedCard — canvas token parity (unit-feed-card.dc.html)", () => {
  const classesOf = (el: Element | null | undefined) =>
    (el?.className ?? "").toString().split(/\s+/);

  it("048 EARS-14: the title tracks at the title token and the no-media mark at the display token", () => {
    const title = "Открыт набор центров в исследование эффективности PRP";
    render(<FeedCard card={card({ title })} now={NOW} />);
    const t = classesOf(screen.getByText(title));
    expect(t).toContain("tracking-title");
    expect(t).not.toContain("tracking-tight");
    const { container } = render(
      <FeedCard card={card({ image: null })} now={NOW} />,
    );
    const mark = classesOf(
      container.querySelector('[data-feed-card-media="none"] span'),
    );
    expect(mark).toContain("tracking-display");
    expect(mark).not.toContain("tracking-tight");
  });

  it("048 EARS-14: the partner mark and the date row set the label leading", () => {
    const { container } = render(
      <FeedCard card={card({ partner: { name: "Партнёр А" } })} now={NOW} />,
    );
    expect(
      classesOf(screen.getByText("Партнёрский материал · Партнёр А")),
    ).toContain("leading-label");
    const date = container.querySelector("a")?.querySelector(".tabular-nums");
    expect(classesOf(date)).toContain("leading-label");
  });

  it("048 EARS-49: the network date row sets the canvas label type with proportional figures", () => {
    for (const c of [post(), vkPost(), vkVideo()]) {
      const { container, unmount } = render(<FeedCard card={c} now={NOW} />);
      const row = classesOf(
        container.querySelector("[data-feed-card-external]")?.parentElement ??
          null,
      );
      expect(row).toContain("text-sm");
      expect(row).toContain("leading-label");
      expect(row).toContain("font-semibold");
      expect(row).toContain("text-muted-foreground");
      expect(row).not.toContain("tabular-nums");
      unmount();
    }
  });

  it("048 EARS-14: the video play plate is the space-12 square with the lead glyph size", () => {
    const { container } = render(
      <FeedCard card={post({ duration: 72 })} now={NOW} />,
    );
    const play = classesOf(container.querySelector("[data-feed-card-play]"));
    expect(play).toContain("size-12");
    expect(play).toContain("text-lead");
    expect(play).not.toContain("size-13");
  });

  it("048 EARS-14: the network chip is eyebrow type, wide tracking, label leading, space-px/space-1 padding", () => {
    render(<FeedCard card={post()} now={NOW} />);
    const chip = classesOf(screen.getByRole("img", { name: "Telegram" }));
    for (const c of [
      "text-eyebrow",
      "tracking-wide",
      "leading-label",
      "px-1",
      "py-px",
    ]) {
      expect(chip).toContain(c);
    }
    expect(chip).not.toContain("text-xs");
    expect(chip).not.toContain("leading-4");
  });

  it("048 EARS-14: the post date row sets the label leading", () => {
    const { container } = render(<FeedCard card={post()} now={NOW} />);
    const row = container.querySelector(
      "[data-feed-card-external]",
    )?.parentElement;
    expect(classesOf(row)).toContain("leading-label");
  });

  it("048 EARS-14: the placeholder bars are the space-4 / space-6 / space-5 heights", () => {
    const { container } = render(<FeedCardSkeleton />);
    const heights = Array.from(
      container.querySelectorAll(
        '[data-slot="skeleton"], .animate-skeleton-pulse',
      ),
    )
      .map((el) => classesOf(el).find((c) => /^h-/.test(c)))
      .filter(Boolean);
    expect(heights).toEqual(["h-4", "h-6", "h-5", "h-5", "h-5", "h-4"]);
  });
});
