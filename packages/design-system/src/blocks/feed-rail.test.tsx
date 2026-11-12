import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { FeedCard, PublicFeedPage } from "@ds/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeedRail } from "./feed-rail";

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

  it("048 EARS-14: each press shall move the rail by the visible width", () => {
    render(
      <FeedRail initialPage={page(12, null)} loadPage={vi.fn()} now={NOW} />,
    );
    fireEvent.click(screen.getByRole("button", { name: NEXT }));
    expect(scrollBy).toHaveBeenLastCalledWith({
      left: 900,
      behavior: "smooth",
    });
    scrollRailTo(900);
    fireEvent.click(screen.getByRole("button", { name: PREV }));
    expect(scrollBy).toHaveBeenLastCalledWith({
      left: -900,
      behavior: "smooth",
    });
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
      const click = new MouseEvent("click", { bubbles: true, cancelable: true });
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
