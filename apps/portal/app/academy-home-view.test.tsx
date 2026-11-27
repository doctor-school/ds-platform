import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ds/events-storefront/feed", () => ({
  EventsFeed: vi.fn(() => <div data-testid="events-feed-block" />),
}));
vi.mock("./webinars/retry-block-action", () => ({
  retryAcademyEventsBlock: vi.fn(),
}));
vi.mock("./materials-feed-section", () => ({
  MaterialsFeedSection: () => <div data-academy-section="feed" />,
}));

import { EventsFeed } from "@ds/events-storefront/feed";

import { ACADEMY_EVENTS_STOREFRONT } from "../lib/events-storefront.host-config";
import { AcademyHomeView } from "./academy-home-view";
import { retryAcademyEventsBlock } from "./webinars/retry-block-action";

type Counts = {
  running: number | "fail";
  soon?: number;
  experts: number | "fail";
  partners: number | "fail";
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function project(slug: string, stage: "running" | "soon") {
  return {
    slug,
    title: slug,
    description: null,
    coverUrl: null,
    stage,
    stageNote: null,
    outputs: [],
    investor: null,
  };
}

/** The platform behind the three public reads (the scenarios' Background by default). */
function stubPlatform(counts: Counts) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/public/projects")) {
      if (counts.running === "fail") return json({}, 503);
      return json({
        data: [
          ...Array.from({ length: counts.running }, (_, i) =>
            project(`running-${i}`, "running"),
          ),
          ...Array.from({ length: counts.soon ?? 0 }, (_, i) =>
            project(`soon-${i}`, "soon"),
          ),
        ],
      });
    }
    if (url.endsWith("/v1/public/experts/count")) {
      if (counts.experts === "fail") throw new TypeError("fetch failed");
      return json({ count: counts.experts });
    }
    if (url.endsWith("/v1/public/organisations/count")) {
      if (counts.partners === "fail") return json({}, 500);
      return json({ count: counts.partners });
    }
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const BACKGROUND: Counts = { running: 3, soon: 1, experts: 12, partners: 14 };

/** Resolves the async server components of a tree the way the RSC renderer does. */
async function resolveServer(node: React.ReactNode): Promise<React.ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServer));
  if (!React.isValidElement(node)) return node;
  const element = node as React.ReactElement<{ children?: React.ReactNode }>;
  const { type } = element;
  if (
    typeof type === "function" &&
    type.constructor.name === "AsyncFunction"
  ) {
    const rendered = await (
      type as (props: unknown) => Promise<React.ReactNode>
    )(element.props);
    return resolveServer(rendered);
  }
  if (element.props.children === undefined) return element;
  const children = await resolveServer(element.props.children);
  return Array.isArray(children)
    ? React.cloneElement(element, undefined, ...children)
    : React.cloneElement(element, undefined, children);
}

async function renderHome() {
  const tree = await resolveServer(<>{AcademyHomeView()}</>);
  return render(<>{tree}</>);
}

function text(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  vi.mocked(EventsFeed).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("029 V-3 — the Academy home composition", () => {
  it("029 EARS-1: the home renders its sections in order and none of the 013 landing", async () => {
    stubPlatform(BACKGROUND);
    const { container } = await renderHome();

    const order = Array.from(
      container.querySelectorAll(
        '[data-testid="academy-home-sections"] > [data-academy-section]',
      ),
    ).map((section) => section.getAttribute("data-academy-section"));
    expect(order).toEqual(["hero", "who", "events", "feed", "personas"]);

    // Scenario «The home carries none of the 013 landing».
    const copy = text(container);
    for (const gone of [
      "Что такое Doctor.School",
      "Зачем",
      "Медицинскому образованию нужна другая среда",
      "Объединение лидеров и экспертов",
      "Что получает партнёр",
      "Выгоды",
      "Форматы",
      "Как присоединиться",
      "Обсудим партнёрство?",
      "Создаем будущее медицинского образования вместе",
    ]) {
      expect(copy).not.toContain(gone);
    }
    expect(copy.toLowerCase()).not.toContain("бесплатн");
  });

  it("029 EARS-1: no fixture data is left in apps/portal", () => {
    expect(existsSync(resolve(__dirname, "fixtures.ts"))).toBe(false);
    expect(existsSync(resolve(__dirname, "../public/experts"))).toBe(false);
  });

  it("029 EARS-2: the hero shows the platform line and the «Экспертам» / «Партнёрам» cards with the canvas texts", async () => {
    stubPlatform(BACKGROUND);
    const { container } = await renderHome();
    const hero = container.querySelector('[data-academy-section="hero"]');

    expect(text(hero)).toContain(
      "Академия Doctor.School · закулисье платформы",
    );
    const experts = hero!.querySelector('[data-hero-card="experts"]');
    expect(text(experts)).toContain("Экспертам");
    expect(text(experts!.querySelector("h1"))).toBe(
      "Создавайте образование вместе с нами",
    );
    expect(text(experts)).toContain(
      "Участвуйте в подкасте, создайте курс или школу, выступите на конгрессе — с командой производства, как автор или соавтор проекта.",
    );
    expect(
      within(experts as HTMLElement)
        .getByRole("link", { name: "Подать заявку" })
        .getAttribute("href"),
    ).toBe("/apply");

    const partners = hero!.querySelector('[data-hero-card="partners"]');
    expect(text(partners)).toContain("Партнёрам");
    expect(text(partners!.querySelector("h2"))).toBe(
      "Постройте репутацию в экспертной среде",
    );
    expect(text(partners)).toContain(
      "Участвуйте в проектах вместе с экспертами: соавторство направлений, события и прямой доступ к профессиональной среде.",
    );
  });

  it("029 EARS-3: the «Экспертам» card reads the counts computed at the request, under its action", async () => {
    stubPlatform(BACKGROUND);
    const { getByTestId } = await renderHome();
    expect(text(getByTestId("academy-expert-count-line"))).toBe(
      "3 проекта в производстве · 12 экспертов",
    );
  });

  it("029 EARS-3: zero projects in production drop that segment; no line when both segments drop", async () => {
    // Scenario «Zero projects in production drop that segment».
    stubPlatform({ ...BACKGROUND, running: 0 });
    let view = await renderHome();
    expect(text(view.getByTestId("academy-expert-count-line"))).toBe(
      "12 экспертов",
    );
    view.unmount();

    stubPlatform({ ...BACKGROUND, running: "fail", experts: 0 });
    view = await renderHome();
    expect(view.queryByTestId("academy-expert-count-line")).toBeNull();
    // The page still renders every other section.
    expect(
      view.container.querySelector('[data-academy-section="personas"]'),
    ).not.toBeNull();
  });

  it("029 EARS-3: publishing an expert changes the next read", async () => {
    // Scenario «Publishing an expert changes the next read».
    stubPlatform(BACKGROUND);
    let view = await renderHome();
    expect(text(view.getByTestId("academy-expert-count-line"))).toBe(
      "3 проекта в производстве · 12 экспертов",
    );
    view.unmount();

    stubPlatform({ ...BACKGROUND, experts: 13 });
    view = await renderHome();
    expect(text(view.getByTestId("academy-expert-count-line"))).toBe(
      "3 проекта в производстве · 13 экспертов",
    );
  });

  it("029 EARS-5: the «Партнёрам» card reads the organisation count, and «Прозрачная модель» alone when it fails", async () => {
    stubPlatform(BACKGROUND);
    let view = await renderHome();
    expect(text(view.getByTestId("academy-partner-count-line"))).toBe(
      "14 партнёров · прозрачная модель",
    );
    view.unmount();

    // Scenario «A count the platform cannot give is left out».
    stubPlatform({ ...BACKGROUND, partners: "fail" });
    view = await renderHome();
    expect(text(view.getByTestId("academy-partner-count-line"))).toBe(
      "Прозрачная модель",
    );
    expect(text(view.getByTestId("academy-expert-count-line"))).toBe(
      "3 проекта в производстве · 12 экспертов",
    );
    expect(
      view.container.querySelectorAll(
        '[data-testid="academy-home-sections"] > [data-academy-section]',
      ),
    ).toHaveLength(5);
  });

  it("029 EARS-3: the catalog is read once per render", async () => {
    const fetchMock = stubPlatform(BACKGROUND);
    await renderHome();
    const projectReads = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith("/v1/public/projects"),
    );
    expect(projectReads).toHaveLength(1);
  });

  it("029 EARS-6: «Кто мы» shows the kicker, heading, text and the «Миссия» / «Эволюционная цель» panels", async () => {
    stubPlatform(BACKGROUND);
    const { container } = await renderHome();
    const who = container.querySelector('[data-academy-section="who"]');

    expect(text(who)).toContain("Академия");
    expect(text(who!.querySelector("h2"))).toBe("Кто мы");
    expect(text(who)).toContain(
      "Doctor.School создаёт децентрализованное образование для врачей — образование, в развитии которого может участвовать каждый: и эксперт, и компания.",
    );
    const panel = (name: string) =>
      Array.from(
        who!.querySelectorAll(`[data-who-panel="${name}"] > *`),
        (node) => text(node),
      );
    expect(panel("mission")).toEqual([
      "Миссия",
      "Создать равную свободную среду для самореализации врачей, где талант важнее связей, а качественное образование доступно каждому. Сделать медобразование децентрализованным и открытым и минимизировать врачебные ошибки.",
    ]);
    expect(panel("goal")).toEqual([
      "Эволюционная цель",
      "Создаём децентрализованное медицинское образование",
    ]);
    expect(text(who)).not.toContain("готовится");
  });

  it("029 EARS-7: «Ближайшие эфиры» mounts the shared EventsFeed with the Academy config, limit 3 and the Academy block retry", async () => {
    stubPlatform(BACKGROUND);
    const { container } = await renderHome();
    const events = container.querySelector('[data-academy-section="events"]');

    expect(text(events)).toContain("Эфиры");
    expect(text(events!.querySelector("h3"))).toBe("Ближайшие эфиры");
    expect(
      events!.querySelector('[data-testid="events-feed-block"]'),
    ).not.toBeNull();
    expect(vi.mocked(EventsFeed)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(EventsFeed).mock.calls[0]![0]).toEqual({
      config: ACADEMY_EVENTS_STOREFRONT,
      limit: 3,
      retry: retryAcademyEventsBlock,
    });
    // The home holds no event list or card of its own.
    expect(events!.querySelectorAll("article, li")).toHaveLength(0);
  });

  it("029 EARS-8: both «Как это работает» actions lead to /investors and the home has no partnership form", async () => {
    stubPlatform(BACKGROUND);
    const { container } = await renderHome();

    const partnerCard = container.querySelector('[data-hero-card="partners"]');
    expect(
      within(partnerCard as HTMLElement)
        .getByRole("link", { name: "Как это работает" })
        .getAttribute("href"),
    ).toBe("/investors");

    const investors = container.querySelector('[data-persona="investors"]');
    expect(text(investors)).toContain("Инвесторам");
    expect(text(investors!.querySelector("h3"))).toBe(
      "Внимание врачей для вашего бренда — этично и прозрачно",
    );
    expect(text(investors)).toContain(
      "Организация участвует в проектах рядом с экспертами: партнёрский материал всегда помечен, модель открыта.",
    );
    expect(
      within(investors as HTMLElement)
        .getByRole("link", { name: "Как это работает" })
        .getAttribute("href"),
    ).toBe("/investors");

    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input, textarea, select")).toBeNull();
  });

  it("029 EARS-9: the «Экспертам» persona block leads to /apply, next to «Инвесторам»", async () => {
    stubPlatform(BACKGROUND);
    const { container } = await renderHome();
    const personas = container.querySelector(
      '[data-academy-section="personas"]',
    );

    const blocks = Array.from(
      personas!.querySelectorAll("[data-persona]"),
    ).map((block) => block.getAttribute("data-persona"));
    expect(blocks).toEqual(["experts", "investors"]);

    const experts = personas!.querySelector('[data-persona="experts"]');
    expect(text(experts)).toContain("Экспертам");
    expect(text(experts!.querySelector("h3"))).toBe(
      "Ваше имя — в проектах Академии",
    );
    expect(text(experts)).toContain(
      "Участвуйте в подкасте, создайте курс или школу, выступите на конгрессе. К проекту эксперт присоединяется как автор или соавтор — с командой производства.",
    );
    expect(
      within(experts as HTMLElement)
        .getByRole("link", { name: "Подать заявку на участие в проекте" })
        .getAttribute("href"),
    ).toBe("/apply");
  });
});
