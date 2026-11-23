import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { FeedCard, PublicFeedPage } from "@ds/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FeedRail,
  feedRailPageGoal,
  feedRailPageTarget,
  feedRailRows,
} from "./feed-rail";

// 048 V-8 — the Academy home rail of `design-source/academy-home.dc.html`
// section «Новости, блог и видео» (EARS-14, EARS-15, EARS-16). jsdom has no
// layout, so the rail geometry (scroll position, widths, one 300px slot) and
// the two media queries are stubbed.

const NOW = new Date("2026-11-11T09:00:00Z");
const PREV = "Назад к более новым материалам";
const NEXT = "Дальше, к более ранним материалам";

const geom = { scrollLeft: 0, scrollWidth: 3000, clientWidth: 1000 };
let phone = false;
let reducedMotion = false;
const scrollBy = vi.fn();
const scrollTo = vi.fn();
const restore: Array<() => void> = [];

function stub<K extends keyof HTMLElement>(
  key: K,
  descriptor: PropertyDescriptor,
) {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const prev = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
  Object.defineProperty(proto, key, { configurable: true, ...descriptor });
  restore.push(() => {
    if (prev) Object.defineProperty(proto, key, prev);
    else delete proto[key as string];
  });
}

beforeEach(() => {
  Object.assign(geom, { scrollLeft: 0, scrollWidth: 3000, clientWidth: 1000 });
  phone = false;
  reducedMotion = false;
  scrollBy.mockReset();
  scrollTo.mockReset();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width")
        ? phone
        : query.includes("prefers-reduced-motion")
          ? reducedMotion
          : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  stub("scrollLeft", {
    get: () => geom.scrollLeft,
    set: (v: number) => {
      geom.scrollLeft = v;
    },
  });
  stub("scrollWidth", { get: () => geom.scrollWidth });
  stub("clientWidth", { get: () => geom.clientWidth });
  stub("offsetWidth", { get: () => 300 });
  stub("scrollBy", { value: scrollBy, writable: true });
  stub("scrollTo", { value: scrollTo, writable: true });
});

afterEach(() => {
  while (restore.length) restore.pop()?.();
});

function cards(n: number, from = 0): FeedCard[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(from + i).padStart(12, "0")}`,
    kind: "news" as const,
    title: `Материал ${from + i}`,
    publishedAt: "2026-10-01T10:00:00Z",
    image: null,
    source: { platform: "academy" as const, name: "Академия" },
    partner: null,
    href: `/materials/m-${from + i}`,
  }));
}

function page(n: number, nextCursor: string | null, from = 0): PublicFeedPage {
  return { data: cards(n, from), nextCursor };
}

const rail = () => screen.getByRole("region", { name: /листайте/ });
const live = (c: HTMLElement) =>
  c.querySelector('[aria-live="polite"]')?.textContent ?? "";
const placeholders = (c: HTMLElement) =>
  c.querySelectorAll("[data-feed-card-skeleton]").length;

function scrollRailTo(left: number) {
  geom.scrollLeft = left;
  fireEvent.scroll(rail());
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("FeedRail", () => {
  it("048 EARS-14: system shall render the section header, the canvas rail semantics and the cards of the first page", () => {
    render(
      <FeedRail initialPage={page(12, null)} loadPage={vi.fn()} now={NOW} />,
    );
    expect(screen.getByText("Соцсети и блог")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Новости, блог и видео" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Что выходит в Академии и в наших соцсетях"),
    ).toBeTruthy();
    const region = rail();
    expect(region.getAttribute("aria-roledescription")).toBe("лента");
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(screen.getAllByRole("link")).toHaveLength(12);
    const prev = screen.getByRole("button", { name: PREV });
    expect(prev.getAttribute("aria-controls")).toBe(region.id);
  });

  it("048 EARS-14: ← shall be disabled at the start and → disabled at the end once nothing more is to load", () => {
    render(
      <FeedRail initialPage={page(12, null)} loadPage={vi.fn()} now={NOW} />,
    );
    const prev = screen.getByRole("button", { name: PREV });
    const next = screen.getByRole("button", { name: NEXT });
    expect(prev).toHaveProperty("disabled", true);
    expect(next).toHaveProperty("disabled", false);
    scrollRailTo(2000);
    expect(prev).toHaveProperty("disabled", false);
    expect(next).toHaveProperty("disabled", true);
  });

  it("048 EARS-14: each press shall move the rail by one page of whole visible columns", () => {
    render(
      <FeedRail initialPage={page(12, null)} loadPage={vi.fn()} now={NOW} />,
    );
    fireEvent.click(screen.getByRole("button", { name: NEXT }));
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: 900,
      behavior: "smooth",
    });
    scrollRailTo(900);
    fireEvent.click(screen.getByRole("button", { name: PREV }));
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: 0,
      behavior: "smooth",
    });
  });

  it("048 EARS-14 (#4191): when two rows would not fill the rail, the desktop rail shall render one row", () => {
    // 4 cards in two rows are 2 columns (600 px) in a 1000 px rail.
    render(
      <FeedRail initialPage={page(4, null)} loadPage={vi.fn()} now={NOW} />,
    );
    expect(rail().getAttribute("data-rows")).toBe("1");
  });

  it("048 EARS-14 (#4191): when every card fits one row, the desktop rail shall render one row", () => {
    // 3 slots of 300 px in a 1000 px rail fit one row.
    render(
      <FeedRail initialPage={page(3, null)} loadPage={vi.fn()} now={NOW} />,
    );
    expect(rail().getAttribute("data-rows")).toBe("1");
    expect(rail().className).toContain("grid-rows-1");
    expect(rail().className).not.toContain("grid-rows-2");
  });

  it("048 EARS-14 (#4191): when the cards overflow the rail even in two rows, the desktop rail shall render two rows", () => {
    // 7 cards in two rows are 4 columns of 300 px — over a 1000 px rail.
    render(
      <FeedRail initialPage={page(7, null)} loadPage={vi.fn()} now={NOW} />,
    );
    expect(rail().getAttribute("data-rows")).toBe("2");
    expect(rail().className).toContain("grid-rows-2");
  });

  it("048 EARS-14: ArrowLeft / ArrowRight shall move one card and Home / End to the ends", () => {
    render(
      <FeedRail initialPage={page(12, null)} loadPage={vi.fn()} now={NOW} />,
    );
    const region = rail();
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(scrollBy).toHaveBeenLastCalledWith({
      left: 300,
      behavior: "smooth",
    });
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(scrollBy).toHaveBeenLastCalledWith({
      left: -300,
      behavior: "smooth",
    });
    fireEvent.keyDown(region, { key: "End" });
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: 3000,
      behavior: "smooth",
    });
    fireEvent.keyDown(region, { key: "Home" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "smooth" });
  });

  it("048 EARS-14: under reduced motion the rail shall scroll without animation", () => {
    reducedMotion = true;
    render(
      <FeedRail initialPage={page(12, null)} loadPage={vi.fn()} now={NOW} />,
    );
    fireEvent.keyDown(rail(), { key: "ArrowRight" });
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 300, behavior: "auto" });
  });

  it("048 EARS-14: a mouse drag shall move the rail and a touch pointer shall not be taken over", () => {
    render(
      <FeedRail initialPage={page(12, null)} loadPage={vi.fn()} now={NOW} />,
    );
    const region = rail();
    fireEvent.pointerDown(region, {
      pointerType: "touch",
      button: 0,
      clientX: 500,
    });
    fireEvent.pointerMove(window, { pointerType: "touch", clientX: 300 });
    fireEvent.pointerUp(window, { pointerType: "touch" });
    expect(geom.scrollLeft).toBe(0);
    fireEvent.pointerDown(region, {
      pointerType: "mouse",
      button: 0,
      clientX: 500,
    });
    fireEvent.pointerMove(window, { pointerType: "mouse", clientX: 300 });
    expect(geom.scrollLeft).toBe(200);
    fireEvent.pointerUp(window, { pointerType: "mouse" });
  });

  it("048 EARS-14: when a mouse drag ends outside the rail, system shall let the next card activation through", () => {
    vi.useFakeTimers();
    try {
      render(
        <FeedRail initialPage={page(12, null)} loadPage={vi.fn()} now={NOW} />,
      );
      const region = rail();
      fireEvent.pointerDown(region, {
        pointerType: "mouse",
        button: 0,
        clientX: 500,
      });
      fireEvent.pointerMove(window, { pointerType: "mouse", clientX: 300 });
      // Released outside the rail: no click reaches the rail for this drag.
      fireEvent.pointerUp(window, { pointerType: "mouse" });
      act(() => {
        vi.runAllTimers();
      });
      // The next activation (keyboard Enter / touch tap) dispatches a click.
      const link = screen.getAllByRole("link")[0]!;
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("048 EARS-14: on a phone the rail shall show one row and no buttons", () => {
    phone = true;
    render(
      <FeedRail initialPage={page(12, null)} loadPage={vi.fn()} now={NOW} />,
    );
    expect(screen.queryByRole("button", { name: PREV })).toBeNull();
    expect(screen.queryByRole("button", { name: NEXT })).toBeNull();
    expect(rail().getAttribute("data-rows")).toBe("1");
  });

  it("048 EARS-14: the rail shall never move by itself", async () => {
    render(
      <FeedRail initialPage={page(12, null)} loadPage={vi.fn()} now={NOW} />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(scrollBy).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(rail().getAttribute("data-rows")).toBe("2");
  });

  it("048 EARS-15.1: near the end the rail shall request the next 8 cards on a desktop, show placeholders, mark itself busy and announce the load", async () => {
    const next = deferred<PublicFeedPage>();
    const loadPage = vi.fn().mockReturnValue(next.promise);
    const { container } = render(
      <FeedRail initialPage={page(12, "c1")} loadPage={loadPage} now={NOW} />,
    );
    expect(loadPage).not.toHaveBeenCalled();
    scrollRailTo(1600);
    expect(loadPage).toHaveBeenCalledWith({ cursor: "c1", limit: 8 });
    expect(rail().getAttribute("aria-busy")).toBe("true");
    expect(placeholders(container)).toBe(4);
    expect(live(container)).toBe("Загружаем более ранние материалы");
    geom.scrollWidth = 6000;
    await act(async () => next.resolve(page(8, "c2", 12)));
    expect(screen.getAllByRole("link")).toHaveLength(20);
    expect(placeholders(container)).toBe(0);
    expect(rail().getAttribute("aria-busy")).toBe("false");
    expect(live(container)).toBe("Загружено материалов: 8");
  });

  it("048 EARS-15.2: on a phone the next page shall be 6 cards and the last page shall announce «Это все материалы.»", async () => {
    phone = true;
    const loadPage = vi.fn().mockResolvedValue(page(6, null, 12));
    const { container } = render(
      <FeedRail initialPage={page(12, "c1")} loadPage={loadPage} now={NOW} />,
    );
    scrollRailTo(1600);
    expect(loadPage).toHaveBeenCalledWith({ cursor: "c1", limit: 6 });
    await waitFor(() =>
      expect(live(container)).toBe(
        "Загружено материалов: 6. Это все материалы.",
      ),
    );
    expect(screen.getAllByRole("link")).toHaveLength(18);
  });

  it("048 EARS-15.3: when the next page fails, system shall keep every card, announce the failure and offer «Повторить» that retries the same cursor", async () => {
    const loadPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(page(8, null, 12));
    const { container } = render(
      <FeedRail initialPage={page(12, "c1")} loadPage={loadPage} now={NOW} />,
    );
    scrollRailTo(1600);
    const retry = await screen.findByRole("button", { name: "Повторить" });
    expect(screen.getAllByRole("link")).toHaveLength(12);
    expect(live(container)).toBe("Не удалось загрузить более ранние материалы");
    expect(rail().contains(retry)).toBe(true);
    scrollRailTo(1700);
    expect(loadPage).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    expect(loadPage).toHaveBeenLastCalledWith({ cursor: "c1", limit: 8 });
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(20));
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
  });

  it("048 EARS-16.1: while the first page loads, system shall show 10 placeholder cards on a desktop with both buttons disabled", () => {
    const loadPage = vi.fn().mockReturnValue(new Promise(() => {}));
    const { container } = render(<FeedRail loadPage={loadPage} now={NOW} />);
    expect(loadPage).toHaveBeenCalledWith({ cursor: null, limit: 12 });
    expect(placeholders(container)).toBe(10);
    expect(rail().getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: PREV })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: NEXT })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("048 EARS-16.1 (#4191): the desktop placeholders shall keep the canvas two rows even where they would fit one", () => {
    geom.clientWidth = 4000;
    render(
      <FeedRail loadPage={vi.fn().mockReturnValue(new Promise(() => {}))} />,
    );
    expect(rail().getAttribute("data-rows")).toBe("2");
  });

  it("048 EARS-16.1: while the first page loads on a phone, system shall show 3 placeholder cards", () => {
    phone = true;
    const loadPage = vi.fn().mockReturnValue(new Promise(() => {}));
    const { container } = render(<FeedRail loadPage={loadPage} now={NOW} />);
    expect(placeholders(container)).toBe(3);
  });

  it("048 EARS-16.2: when the feed has no entry, system shall show the empty text with no rail and no buttons", () => {
    render(
      <FeedRail initialPage={page(0, null)} loadPage={vi.fn()} now={NOW} />,
    );
    expect(screen.getByText("Записей пока нет.")).toBeTruthy();
    expect(
      screen.getByText(
        "Здесь появятся новости Академии и публикации из наших соцсетей.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: /листайте/ })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("048 EARS-16.3: when the first page cannot be read, system shall show the alert with «Повторить» that reads the first page again", async () => {
    const loadPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce(page(3, null));
    render(<FeedRail loadPage={loadPage} now={NOW} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Не удалось загрузить новости.");
    expect(screen.queryByRole("region", { name: /листайте/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(loadPage).toHaveBeenLastCalledWith({ cursor: null, limit: 12 });
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(3));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// #4191 — the row rule and the page arithmetic, on the 1440 px geometry of
// the rail: gutter 48 px, column 292 px, gap 20 px (slot 312 px), so the
// content box (1344 px) holds four whole columns.
describe("feedRailRows", () => {
  const box = { inner: 1344, column: 292, gap: 20 };

  it("048 EARS-14 (#4191): cards that fit the content box shall take one row", () => {
    expect(feedRailRows({ count: 1, ...box })).toBe(1);
    expect(feedRailRows({ count: 3, ...box })).toBe(1);
    // 4 × 292 + 3 × 20 = 1228 ≤ 1344.
    expect(feedRailRows({ count: 4, ...box })).toBe(1);
  });

  it("048 EARS-14 (#4191): a two-row grid that would not fill the width shall stay one row", () => {
    // 6 cards in two rows are 3 columns (916 px) — half the section empty.
    expect(feedRailRows({ count: 6, ...box })).toBe(1);
    // 8 cards in two rows are 4 columns (1228 px ≤ 1344).
    expect(feedRailRows({ count: 8, ...box })).toBe(1);
  });

  it("048 EARS-14 (#4191): cards whose two-row grid overflows the content box shall take two rows", () => {
    // 9 cards in two rows are 5 columns: 5 × 292 + 4 × 20 = 1540 > 1344.
    expect(feedRailRows({ count: 9, ...box })).toBe(2);
    expect(feedRailRows({ count: 37, ...box })).toBe(2);
    expect(feedRailRows({ count: 200, ...box })).toBe(2);
  });

  it("048 EARS-14 (#4191): with no layout measured yet, the rail shall keep two rows", () => {
    expect(feedRailRows({ count: 3, inner: 0, column: 0, gap: 0 })).toBe(2);
  });
});

describe("feedRailPageTarget", () => {
  // 19 columns (37 cards in two rows): 48 + 19 × 312 − 20 + 48 = 6004.
  const geometry = {
    clientWidth: 1440,
    scrollWidth: 6004,
    padStart: 48,
    padEnd: 48,
    column: 292,
    gap: 20,
  };
  const forward = (left: number) =>
    feedRailPageTarget({ ...geometry, scrollLeft: left }, 1);
  const back = (left: number) =>
    feedRailPageTarget({ ...geometry, scrollLeft: left }, -1);

  it("048 EARS-14 (#4191): → shall move by four whole columns each press, in equal steps", () => {
    expect(forward(0)).toBe(1248);
    expect(forward(1248)).toBe(2496);
    expect(forward(2496)).toBe(3744);
  });

  it("048 EARS-14 (#4191): the last → shall stop with the last column at the right gutter", () => {
    // max scroll = 6004 − 1440 = 4564: the last column ends at 1440 − 48.
    expect(forward(3744)).toBe(4564);
    expect(forward(4564)).toBe(4564);
  });

  it("048 EARS-14 (#4191): ← shall show the whole columns before the first fully visible one, snapped to a column start", () => {
    // At the end the first fully visible column is 15 (15 × 312 = 4680 ≥ 4564).
    expect(back(4564)).toBe(11 * 312);
    expect(back(11 * 312)).toBe(7 * 312);
    expect(back(7 * 312)).toBe(3 * 312);
    expect(back(3 * 312)).toBe(0);
    expect(back(0)).toBe(0);
  });

  it("048 EARS-14 (#4191): a position between columns (after a swipe) shall page from the next whole column", () => {
    expect(forward(100)).toBe(5 * 312);
    expect(back(1300)).toBe(312);
  });

  it("048 EARS-14 (#4191): the → goal shall keep the whole-page step past the loaded cards, which only the scroll target clamps", () => {
    // A first page of 12 cards: 6 columns, max scroll 48 + 6 × 312 − 20 + 48 − 1440 = 508.
    const firstPage = { ...geometry, scrollWidth: 1948, scrollLeft: 0 };
    expect(feedRailPageGoal(firstPage, 1)).toBe(1248);
    expect(feedRailPageTarget(firstPage, 1)).toBe(508);
    // ← is never past the start.
    expect(feedRailPageGoal({ ...firstPage, scrollLeft: 312 }, -1)).toBe(0);
  });

  it("048 EARS-14 (#4191): a rail narrower than one slot shall still move by one column", () => {
    expect(
      feedRailPageTarget(
        {
          ...geometry,
          clientWidth: 300,
          padStart: 0,
          padEnd: 0,
          scrollLeft: 0,
        },
        1,
      ),
    ).toBe(312);
  });
});
