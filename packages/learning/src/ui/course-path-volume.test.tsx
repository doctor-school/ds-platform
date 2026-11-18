// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoursePath } from "./course-path";
import { buildPathView, keepTokensWhole, lessonInView, sectionCurves, snakeGeometry } from "./path-view";
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

/**
 * The page layout by lesson: `lessonTop(n)` places lesson n's first step; each
 * module plate sits a plate's height (100 px) above its first lesson's step.
 */
function stubPathLayout(path: ReturnType<typeof multiModulePath>, lessonTop: (n: number) => number) {
  const view = buildPathView(path);
  const firstStep = new Map(view.outline.flatMap((m) => m.lessons).map((l) => [`node-${l.firstStepId}`, l.number]));
  const plate = new Map(view.outline.map((m) => [`module-${m.id}`, m.lessons[0]!.number]));
  stubLayout((id) => {
    const n = firstStep.get(id);
    if (n !== undefined) return lessonTop(n);
    const p = plate.get(id);
    return p === undefined ? 0 : lessonTop(p) - 100;
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

  it("EARS-14: a clamped title on the left of the snake ends with «…» as on the right — a measured clamped left title is left-aligned so the «…» lands inside its box", () => {
    // Chrome right-aligns a clamped line without its «…» and draws the «…»
    // after the line's end — past a right-aligned box's edge, where it is cut.
    // jsdom has no layout: a title is clamped when its `scrollHeight` exceeds
    // its `clientHeight`, stubbed per title here.
    const clamped = new Set(["Чтение ЭКГ"]);
    const title = (el: HTMLElement) => el.getAttribute("title") ?? "";
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return clamped.has(title(this)) ? 60 : 36;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => 36);
    stubMatchMedia(false);
    stubFetch({});
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    // Desktop: node 0 sits right of the axis (its text on the right), node 1 left.
    const right = document.querySelector<HTMLElement>('[title="Сбор анамнеза"]')!;
    const left = document.querySelector<HTMLElement>('[title="Чтение ЭКГ"]')!;
    expect(left.parentElement).toHaveClass("text-right");
    expect(left).toHaveClass("line-clamp-2", "text-left");
    expect(left).not.toHaveClass("pe-3");
    expect(right.parentElement).toHaveClass("text-left");
    expect(right).toHaveClass("line-clamp-2");
    // A left title that fits keeps the column's right alignment; the flag
    // follows the measurement on resize.
    clamped.delete("Чтение ЭКГ");
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(left).not.toHaveClass("text-left");
    clamped.add("Чтение ЭКГ");
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(left).toHaveClass("text-left");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});

describe("024 EARS-14 — a label taller than the 96 px row grows its row", () => {
  it("EARS-14: the snake runs through rows of their own heights — each node at its row's middle, the section as tall as its rows", () => {
    const nodes = buildPathView(coursePath()).sections[0]!.nodes.slice(0, 3);
    const curves = sectionCurves(nodes, 0, snakeGeometry(false), null, null, [96, 160, 96]);
    expect(curves.height).toBe(352);
    const d = curves.done + curves.open + curves.locked;
    // Node 0 at (176, 48), node 1 at (64, 96 + 80), node 2 at (176, 256 + 48).
    expect(d).toContain("M 176 48 C 176 112, 64 112, 64 176 ");
    expect(d).toContain("M 64 176 C 64 240, 176 240, 176 304 ");
    // Without measured heights every row is one pitch (the canvas).
    expect(sectionCurves(nodes, 0, snakeGeometry(false), null, null).height).toBe(288);
  });

  it("EARS-14: a node row is at least one pitch tall and grows with its label; the line follows the measured rows", () => {
    stubMatchMedia(false);
    stubFetch({});
    // jsdom has no layout: the row holding «Чтение ЭКГ» measures 160 px (a
    // label of a two-line kicker, a two-line title, «Вы здесь» and a note).
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const tall = this instanceof HTMLElement && this.dataset.snakeRow !== undefined && this.querySelector('[title="Чтение ЭКГ"]');
      const height = this instanceof HTMLElement && this.dataset.snakeRow !== undefined ? (tall ? 160 : 96) : 0;
      return { top: 0, bottom: height, left: 0, right: 0, width: 0, height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    render(<CoursePath courseSlug="kardio" config={CONFIG} initial={coursePath()} />);
    const rows = [...document.querySelectorAll<HTMLElement>("[data-snake-row]")];
    expect(rows.length).toBe(buildPathView(coursePath()).sections[0]!.nodes.length);
    for (const row of rows) {
      expect(row.style.minHeight).toBe("96px");
      expect(row.style.height).toBe("");
      expect(row).not.toHaveClass("absolute");
    }
    // The label sits in the row's flow (it gives the row its height).
    const label = document.querySelector('[title="Чтение ЭКГ"]')!.parentElement!;
    expect(label).not.toHaveClass("absolute");
    const svg = rows[0]!.parentElement!.querySelector("svg")!;
    expect(svg.getAttribute("height")).toBe(String(96 * (rows.length - 1) + 160));
    vi.restoreAllMocks();
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

  it("EARS-14: a module plate counts its lessons and its club as the canvas does — «3 урока и клуб · …»; no club, no «и клуб»", () => {
    const path = multiModulePath(6, 3, 8);
    path.modules[1]!.club = null;
    render(<CoursePath courseSlug="k" config={CONFIG} initial={path} />);
    const plate = (m: number) =>
      screen.getByRole("heading", { level: 3, name: `Модуль ${m}. Раздел ${m}` }).parentElement!;
    // Three lessons of 15 minutes: 45 minutes = 1 academic hour.
    expect(within(plate(1)).getByText("3 урока и клуб · 1 академический час")).toBeInTheDocument();
    expect(within(plate(2)).getByText("3 урока · 1 академический час")).toBeInTheDocument();
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
    // Lessons 1…57 have passed the spy line near the viewport top; lesson 58 (module 15) is below it.
    stubPathLayout(path, (n) => (n <= 57 ? -100 : 2_000));
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

  it("EARS-14: after «Продолжить» the outline keeps «Вы здесь» marked while the jump scrolls and once it lands — the jumped-to lesson occupies the top", () => {
    // Short lessons: once lesson 60 sits at the top, lesson 61's first step is
    // already above the spy line — the jump must not hand the mark to 61.
    const path = multiModulePath(26, 4, 60);
    stubPathLayout(path, (n) => (n <= 60 ? 64 - (60 - n) * 160 : n === 61 ? 224 : 2_000));
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
    // The jump has landed: lesson 60 occupies the top of the viewport, so the
    // spy keeps it although lesson 61 starts above the middle.
    scrollFrame("scrollend", "scroll");
    expect(outline().getByRole("link", { name: /^Урок 60\. / })).toHaveAttribute("aria-current", "true");
  });

  it("EARS-14: the lesson in view is the one at the top of the viewport; the outline column's own scroll never moves it", () => {
    const path = multiModulePath(26, 4, 60);
    // Lessons are 288 px apart (3 steps); `scrolled` moves them all up.
    let scrolled = 0;
    stubPathLayout(path, (n) => 64 + (n - 60) * 288 - scrolled);
    vi.stubGlobal("innerHeight", 900);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    const frame = (target: EventTarget, ...events: string[]) =>
      act(() => {
        for (const type of events) target.dispatchEvent(new Event(type, { bubbles: true }));
        frames.splice(0).forEach((cb) => cb(0));
      });
    const current = () => outline().getByRole("link", { current: true });
    render(<CoursePath courseSlug="k" config={CONFIG} initial={path} />);
    frame(window, "scroll");
    // Lesson 60 sits at the top, lesson 61 starts at 352 (above the middle).
    expect(current()).toHaveAccessibleName(/^Урок 60\. /);
    // The reader picks lesson 59 in the outline; the page jump lands, then the
    // column settles its own follow-scroll: the pick stands.
    fireEvent.click(outline().getByRole("link", { name: /^Урок 59\. / }));
    frame(window, "scrollend");
    frame(document.querySelector("aside")!, "scroll");
    expect(current()).toHaveAccessibleName(/^Урок 59\. /);
    // Lesson 61's first step reaches the top of the viewport: it is in view.
    scrolled = 260;
    frame(window, "scroll");
    expect(current()).toHaveAccessibleName(/^Урок 61\. /);
  });

  it("EARS-14: once a module's plate passes the spy line, that module is in view — open in the outline with its first lesson marked", () => {
    // Module 16's plate sits at the top of the viewport (20 px); the plate is
    // taller than the line, so lesson 61's first step (module 16) is still below it.
    const path = multiModulePath(26, 4, 2);
    stubPathLayout(path, (n) => (n <= 60 ? -400 - (60 - n) * 288 : n === 61 ? 120 : 2_000));
    vi.stubGlobal("innerHeight", 900);
    render(<CoursePath courseSlug="k" config={CONFIG} initial={path} />);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(moduleRow(16)).toHaveAttribute("aria-expanded", "true");
    expect(moduleRow(15)).toHaveAttribute("aria-expanded", "false");
    expect(outline().getByRole("link", { name: /^Урок 61\. / })).toHaveAttribute("aria-current", "true");
  });

  it("EARS-14: on load the outline column shows its top — the summary and the start of the outline; it follows only once the open module changes", () => {
    vi.useFakeTimers();
    try {
      // The column shows 0…800; the open module's block (its row + 4 lessons +
      // club row) sits far below the fold — module 15 on load (lesson 60 →
      // «Вы здесь»), then module 17 after its row is picked.
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const box = (top: number, height: number) =>
          ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
        if (this.tagName === "ASIDE") return box(0, 800);
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
      // Canvas on load: the column is not scrolled.
      expect(scrollTo).not.toHaveBeenCalled();
      // A pick opens another module: the column scrolls the least distance that
      // shows it whole — its block ends at 916 + 228 = 1144, so by 1144 − 800 = 344.
      fireEvent.click(moduleRow(17));
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 344, behavior: "smooth" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("EARS-14: «Продолжить» right after load brings the open «Вы здесь» module into the outline column; a pick of a lesson in the open module does too", () => {
    vi.useFakeTimers();
    try {
      // On load module 15 (lesson 60, «Вы здесь») is already the open one, its
      // block below the column's fold (916…1144 in a 0…800 column).
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const box = (top: number, height: number) =>
          ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
        if (this.tagName === "ASIDE") return box(0, 800);
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
      expect(scrollTo).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("link", { name: "Продолжить — урок 60" }));
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 344, behavior: "smooth" });
      scrollTo.mockClear();
      fireEvent.click(outline().getByRole("link", { name: /^Урок 59\. / }));
      act(() => {
        vi.advanceTimersByTime(400);
      });
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
