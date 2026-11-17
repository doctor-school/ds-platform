// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoursePath } from "./course-path";
import { buildPathView, keepTokensWhole, lessonInView } from "./path-view";
import { CONFIG, coursePath, multiModulePath, stubFetch, stubMatchMedia } from "./__tests__/fixtures";

// 024 EARS-14 — the course path at the volume of `design-source/doctor-course.dc.html`
// v16 (multi-module by default; one module is the exception): module plates,
// the outline with ONE module open — the one in view — and the lesson in view
// highlighted, «Продолжить» that jumps to the «Вы здесь» step deep in the path,
// and node labels that wrap at word and separator boundaries only.

const outline = () => within(screen.getByRole("navigation", { name: "Модули и уроки" }));
const moduleRow = (n: number) => outline().getByRole("button", { name: new RegExp(`^Модуль ${n}\\. `) });

/** jsdom has no layout: each path node's top comes from `tops` (by element id). */
function stubLayout(tops: (id: string) => number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = tops(this.id);
    return { top, bottom: top + 56, left: 0, right: 0, width: 0, height: 56, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

describe("024 EARS-14 — node labels wrap at word and separator boundaries", () => {
  it("EARS-14: a short token with an inner hyphen stays whole («CHA₂DS₂-VA», «HAS-BLED»)", () => {
    expect(keepTokensWhole("Памятка: шкала CHA₂DS₂-VA и HAS-BLED")).toEqual([
      { text: "Памятка: шкала ", nowrap: false },
      { text: "CHA₂DS₂-VA", nowrap: true },
      { text: " и ", nowrap: false },
      { text: "HAS-BLED", nowrap: true },
    ]);
    expect(keepTokensWhole("Фибрилляция предсердий")).toEqual([{ text: "Фибрилляция предсердий", nowrap: false }]);
  });

  it("EARS-14: the kicker breaks only after «·» — «1,2 МБ» never splits from its number", () => {
    const view = buildPathView(coursePath());
    const memo = view.sections[0]!.nodes.find((n) => n.title === "Памятка по ЭКГ")!;
    expect(memo.kickerParts).toEqual(["Материал для скачивания", "PDF", "1,2 МБ"]);
    stubMatchMedia(false);
    stubFetch({});
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    const part = screen.getByText("1,2 МБ", { selector: "span" });
    expect(part).toHaveClass("whitespace-nowrap");
    vi.unstubAllGlobals();
  });

  it("EARS-14: a long title is clamped to two lines inside the 96 px row and keeps its full text as a hint", () => {
    stubMatchMedia(false);
    stubFetch({});
    const long = "Фибрилляция предсердий: ЭКГ-диагностика, шкала CHA₂DS₂-VA и выбор антикоагулянтной терапии";
    const path = coursePath();
    path.modules[0]!.lessons[0]!.steps[0]!.title = long;
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={path} />);
    const title = document.querySelector(`[title="${long}"]`);
    expect(title).not.toBeNull();
    expect(title).toHaveClass("line-clamp-2");
    // The label column never squeezes the title below its lines (a wrapped
    // kicker + a reason must not clip the clamp's second line).
    for (const part of title!.parentElement!.children) expect(part).toHaveClass("shrink-0");
    vi.unstubAllGlobals();
  });
});

describe("024 EARS-14 — the scroll-spy line", () => {
  it("EARS-14: the lesson in view is the last whose first step passed the line; none before the first", () => {
    expect(lessonInView([900, 1000, 1100], 450)).toBe(0);
    expect(lessonInView([-300, 200, 449, 451], 450)).toBe(3);
    // A missing node stops the walk (the canvas `break`).
    expect(lessonInView([-300, null, -100], 450)).toBe(1);
  });
});

describe("024 EARS-14 — the course path at 6 and 26 modules", () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    stubMatchMedia(false);
    stubFetch({});
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    scrollIntoView.mockReset();
  });

  it("EARS-14: every module has its plate on the path and its row in the outline", () => {
    render(<CoursePath courseSlug="k" config={CONFIG} initial={multiModulePath(6, 3, 8)} />);
    for (let m = 1; m <= 6; m++) {
      expect(screen.getByRole("heading", { level: 3, name: `Модуль ${m}. Раздел ${m}` })).toBeInTheDocument();
      expect(moduleRow(m)).toBeInTheDocument();
    }
  });

  it("EARS-14: the outline opens ONE module — the one holding «Вы здесь» — and marks that lesson in view", () => {
    // Lesson 8 of 3-per-module → module 3.
    render(<CoursePath courseSlug="k" config={CONFIG} initial={multiModulePath(6, 3, 8)} />);
    for (let m = 1; m <= 6; m++) {
      expect(moduleRow(m)).toHaveAttribute("aria-expanded", m === 3 ? "true" : "false");
    }
    expect(outline().getByRole("link", { name: /^Урок 8\. / })).toHaveAttribute("aria-current", "true");
    expect(outline().getByRole("link", { name: /^Урок 7\. / })).toHaveAttribute("aria-current", "false");
    // A collapsed module's lessons are out of the tab order.
    // (A hidden element has no accessible name, so the row is found by its label.)
    expect(document.querySelector('nav[aria-label="Модули и уроки"] a[aria-label^="Урок 1. "]')).not.toBeVisible();
  });

  it("EARS-14: the outline carries each module's club row and the document row last", () => {
    render(<CoursePath courseSlug="k" config={CONFIG} initial={multiModulePath(6, 3, 8)} />);
    const rows = [...document.querySelectorAll('nav[aria-label="Модули и уроки"] a')];
    expect(rows.filter((a) => a.getAttribute("aria-label")?.startsWith("Клуб модуля · живой эфир"))).toHaveLength(6);
    expect(rows.at(-1)).toHaveAccessibleName(/^Документ по итогам/);
  });

  it("EARS-14: a module row opens that module and scrolls to its plate", () => {
    render(<CoursePath courseSlug="k" config={CONFIG} initial={multiModulePath(26, 4, 2)} />);
    fireEvent.click(moduleRow(17));
    expect(moduleRow(17)).toHaveAttribute("aria-expanded", "true");
    expect(moduleRow(1)).toHaveAttribute("aria-expanded", "false");
    const target = scrollIntoView.mock.contexts.at(-1) as Element;
    expect(target.id).toMatch(/^module-/);
    expect(within(target as HTMLElement).getByRole("heading", { name: /^Модуль 17\. / })).toBeInTheDocument();
  });

  it("EARS-14: scrolling the path moves the open module and the lesson in view (scroll-spy)", () => {
    const path = multiModulePath(26, 4, 2);
    const view = buildPathView(path);
    // Lessons 1…57 have passed the middle of the viewport; lesson 58 (module 15) is below it.
    const firstStep = new Map(view.outline.flatMap((m) => m.lessons).map((l) => [`node-${l.firstStepId}`, l.number]));
    stubLayout((id) => {
      const n = firstStep.get(id);
      return n === undefined ? 0 : n <= 57 ? -100 : 2_000;
    });
    vi.stubGlobal("innerHeight", 900);
    render(<CoursePath courseSlug="k" config={CONFIG} initial={path} />);
    expect(moduleRow(1)).toHaveAttribute("aria-expanded", "true");
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(moduleRow(15)).toHaveAttribute("aria-expanded", "true");
    expect(moduleRow(1)).toHaveAttribute("aria-expanded", "false");
    expect(outline().getByRole("link", { name: /^Урок 57\. / })).toHaveAttribute("aria-current", "true");
  });

  it("EARS-14: a lesson row selects its first step and scrolls the path to it", () => {
    const path = multiModulePath(6, 3, 8);
    render(<CoursePath courseSlug="k" config={CONFIG} initial={path} />);
    fireEvent.click(outline().getByRole("link", { name: /^Урок 9\. / }));
    const step = path.modules[2]!.lessons[2]!.steps[0]!;
    expect(screen.getByRole("button", { name: /^Урок 9, шаг 1\./ })).toHaveAttribute("aria-pressed", "true");
    expect((scrollIntoView.mock.contexts.at(-1) as Element).id).toBe(`node-${step.id}`);
  });

  it("EARS-14: «Продолжить — урок N» jumps to the «Вы здесь» step deep in the course and selects it", () => {
    const path = multiModulePath(26, 4, 83);
    render(<CoursePath courseSlug="k" config={CONFIG} initial={path} />);
    fireEvent.click(screen.getByRole("button", { name: /^Урок 1, шаг 1\./ }));
    const go = screen.getByRole("link", { name: "Продолжить — урок 83" });
    expect(go).toHaveAttribute("href", `#node-${path.current!.stepId}`);
    fireEvent.click(go);
    expect(screen.getByRole("button", { name: /^Урок 83, шаг 1\..*Вы здесь/ })).toHaveAttribute("aria-pressed", "true");
    expect((scrollIntoView.mock.contexts.at(-1) as Element).id).toBe(`node-${path.current!.stepId}`);
    // Lesson 83 of 4-per-module → module 21 opens.
    expect(moduleRow(21)).toHaveAttribute("aria-expanded", "true");
  });

  it("EARS-14: after «Продолжить» the outline keeps «Вы здесь» marked while the jump scrolls; the spy resumes once it settles", () => {
    // Short lessons: once lesson 60 sits at the top, lesson 61's first step is
    // already above the spy line — the jump must not hand the mark to 61.
    const path = multiModulePath(26, 4, 60);
    const view = buildPathView(path);
    const firstStep = new Map(view.outline.flatMap((m) => m.lessons).map((l) => [`node-${l.firstStepId}`, l.number]));
    stubLayout((id) => {
      const n = firstStep.get(id);
      return n === undefined ? 0 : n <= 60 ? 64 - (60 - n) * 160 : n === 61 ? 224 : 2_000;
    });
    vi.stubGlobal("innerHeight", 900);
    // Frames run when the test flushes them, as in a browser (one per frame).
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    const scrollFrame = (...events: string[]) =>
      act(() => {
        for (const type of events) window.dispatchEvent(new Event(type));
        frames.splice(0).forEach((cb) => cb(0));
      });
    render(<CoursePath courseSlug="k" config={CONFIG} initial={path} />);
    fireEvent.click(screen.getByRole("link", { name: "Продолжить — урок 60" }));
    scrollFrame("scroll");
    expect(outline().getByRole("link", { name: /^Урок 60\. / })).toHaveAttribute("aria-current", "true");
    // The outline column settling its own scroll is not the page's jump landing.
    act(() => {
      document.querySelector("aside")!.dispatchEvent(new Event("scrollend", { bubbles: true }));
    });
    scrollFrame("scroll");
    expect(outline().getByRole("link", { name: /^Урок 60\. / })).toHaveAttribute("aria-current", "true");
    scrollFrame("scrollend", "scroll");
    expect(outline().getByRole("link", { name: /^Урок 61\. / })).toHaveAttribute("aria-current", "true");
  });

  it("EARS-14: at 26 modules the outline column scrolls the open module into its view (summary stays when it fits)", () => {
    vi.useFakeTimers();
    try {
      // The column shows 0…800; module 15 (lesson 60 → «Вы здесь») sits far below the fold.
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const box = (top: number, height: number) =>
          ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
        if (this.tagName === "ASIDE") return box(0, 800);
        // The open module's block (its row + 4 lessons + club row): module 15 of 26.
        if (this instanceof HTMLElement && this.dataset.outlineModule === "open") return box(916, 228);
        return box(0, 0);
      });
      render(<CoursePath courseSlug="k" config={CONFIG} initial={multiModulePath(26, 4, 60)} />);
      const aside = document.querySelector("aside")!;
      const scrollTo = vi.fn();
      aside.scrollTo = scrollTo as unknown as typeof aside.scrollTo;
      act(() => {
        vi.advanceTimersByTime(400);
      });
      // Its block ends at 916 + 228 = 1144: the column scrolls by 1144 − 800 = 344
      // so the whole open module shows and the summary above keeps what fits.
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 344, behavior: "smooth" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("EARS-14: the progress band names the module of «Вы здесь» on a multi-module course only", () => {
    const { unmount } = render(<CoursePath courseSlug="k" config={CONFIG} initial={multiModulePath(6, 3, 8)} />);
    expect(screen.getAllByText("Пройдено 7 уроков из 18 · модуль 3").length).toBeGreaterThan(0);
    unmount();
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(screen.getAllByText("Пройдено 1 урок из 3").length).toBeGreaterThan(0);
  });
});

describe("024 EARS-14 — the server HTML on a phone before the narrow switch", () => {
  it("EARS-14: the outline column and the desktop grid apply only from the desktop width, so a phone never scrolls sideways before hydration", () => {
    stubFetch({});
    const html = renderToString(<CoursePath courseSlug="k" config={CONFIG} initial={multiModulePath(26, 4, 60)} />);
    const host = document.createElement("div");
    host.innerHTML = html;
    const aside = host.querySelector("aside")!;
    expect(aside.classList).toContain("hidden");
    expect(aside.classList).toContain("lg:flex");
    const grid = aside.parentElement!;
    expect(grid.classList).toContain("block");
    expect(grid.classList).toContain("lg:grid");
    vi.unstubAllGlobals();
  });
});

describe("024 EARS-14 — one module is the canvas's exception", () => {
  beforeEach(() => {
    stubMatchMedia(false);
    stubFetch({});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("EARS-14: a single-module course shows no module plate and no module row — the outline lists its lessons", () => {
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    expect(screen.queryByRole("heading", { level: 3, name: /^Модуль 1\. / })).toBeNull();
    expect(outline().queryByRole("button", { name: /^Модуль 1\. / })).toBeNull();
    expect(outline().getByRole("link", { name: /^Урок 3\. / })).toBeVisible();
  });
});
