"use client";

import * as React from "react";
import type { FeedCard as FeedCardData, PublicFeedPage } from "@ds/schemas";

import { cn } from "../lib/utils";
import { Button } from "../primitives/button";
import { EmptyState } from "./empty-state";
import { FeedCard, FeedCardSkeleton } from "./feed-card";

/**
 * `<FeedRail>` — 048 EARS-14 / EARS-15 / EARS-16 (#3516): the Academy home
 * section «Новости, блог и видео», built from `design-source/academy-home.dc.html`
 * (`scope` = «срез 1»). It owns the whole section body the canvas draws: the
 * header row (kicker / title / line and the ← / → buttons), the rail, the live
 * region and the loading / empty / error states.
 *
 * Registry research (build-ui step 5): shadcn/ui `carousel` (Embla), Intent UI /
 * JollyUI and Kibo UI carousels are transform-based single-row sliders behind a
 * new dependency; the canvas draws a native-overflow two-row grid with cursor
 * paging, region semantics and no auto-motion — so the rail is bespoke over the
 * adopted `Button`, `EmptyState`, `Skeleton` and `Card` primitives.
 *
 * Data-agnostic: the host passes `loadPage` (no fetching, URL or api-client
 * here). Nothing moves or plays by itself; programmatic scrolling honours
 * `prefers-reduced-motion`.
 */

export const FEED_RAIL_COPY = {
  kicker: "Соцсети и блог",
  title: "Новости, блог и видео",
  lead: "Что выходит в Академии и в наших соцсетях",
  prev: "Назад к более новым материалам",
  next: "Дальше, к более ранним материалам",
  railLabel:
    "Новости, блог и видео: листайте влево и вправо, стрелки клавиатуры — по одной карточке",
  railRoleDescription: "лента",
  emptyTitle: "Записей пока нет.",
  emptyText: "Здесь появятся новости Академии и публикации из наших соцсетей.",
  error: "Не удалось загрузить новости.",
  retry: "Повторить",
  loadingMore: "Загружаем более ранние материалы",
  loaded: "Загружено материалов: ",
  allLoaded: "Это все материалы.",
  loadMoreFailed: "Не удалось загрузить более ранние материалы",
};
export type FeedRailCopy = typeof FEED_RAIL_COPY;

/** Lead decision 17 — page sizes and placeholder counts from the canvas script. */
export const FEED_RAIL_SIZES = {
  firstPage: 12,
  nextPage: { desktop: 8, phone: 6 },
  firstPlaceholders: { desktop: 10, phone: 3 },
  morePlaceholders: { desktop: 4, phone: 2 },
} as const;

/** The canvas phone breakpoint of the rail (`(max-width:1023px)`). */
const PHONE_QUERY = "(max-width: 1023px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type FeedRailPage = Pick<PublicFeedPage, "data" | "nextCursor">;

export interface FeedRailProps {
  /**
   * A first page the host already holds (the showcase and tests pass one);
   * when absent — as on the Academy home — the rail reads it itself.
   */
  initialPage?: FeedRailPage | undefined;
  /** Reads one feed page — the host binds it to `GET /v1/public/feed`. */
  loadPage: (args: {
    cursor: string | null;
    limit: number;
  }) => Promise<FeedRailPage>;
  /** Copy overrides; the defaults are the canvas strings verbatim. */
  copy?: Partial<FeedRailCopy> | undefined;
  /** «Now» for the card year rule; injectable for tests. */
  now?: Date | undefined;
  /** The Academy logo mark of the news cards (host-supplied asset). */
  logo?: React.ReactNode;
  className?: string | undefined;
}

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  };
}

function useMedia(query: string): boolean {
  const subscribe = React.useMemo(() => subscribeMedia(query), [query]);
  return React.useSyncExternalStore(
    subscribe,
    () => !!window.matchMedia?.(query).matches,
    () => false,
  );
}

/**
 * #4191 — the desktop row rule: two rows (filled by column) only when even
 * the two-row grid overflows the rail's content box; otherwise the cards take
 * ONE row in feed order — every card fits it, or it scrolls while a two-row
 * grid would leave part of the section empty. With nothing measured yet
 * (`inner` / `column` 0, the server render) the rail keeps the canvas two
 * rows.
 */
export function feedRailRows({
  count,
  inner,
  column,
  gap,
}: {
  count: number;
  inner: number;
  column: number;
  gap: number;
}): 1 | 2 {
  if (inner <= 0 || column <= 0) return 2;
  const columns = Math.ceil(count / 2);
  // Half a pixel of tolerance for fractional track widths.
  return columns * column + Math.max(0, columns - 1) * gap > inner + 0.5
    ? 2
    : 1;
}

export interface FeedRailGeometry {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  padStart: number;
  padEnd: number;
  column: number;
  gap: number;
}

/**
 * #4191 — where a ← / → page starts: one page of whole visible columns,
 * snapped to a column start. → begins the page at the first column not yet
 * fully shown, ← shows the whole columns before the first fully visible one.
 * The goal ignores how many cards are loaded yet, so a → past the loaded
 * cards keeps the same step while the next feed page loads.
 */
export function feedRailPageGoal(g: FeedRailGeometry, dir: 1 | -1): number {
  const slot = g.column + g.gap;
  if (slot <= 0)
    return dir > 0 ? Math.max(0, g.scrollWidth - g.clientWidth) : 0;
  const inner = g.clientWidth - g.padStart - g.padEnd;
  const perPage = Math.max(1, Math.floor((inner + g.gap + 0.5) / slot));
  // The first column whose start is at or right of the left gutter.
  const first = Math.ceil(g.scrollLeft / slot - 0.01);
  return Math.max(0, (first + dir * perPage) * slot);
}

/**
 * #4191 — where ← / → take the rail over the cards laid out now: the page
 * goal, clamped to the scroll end, where the last column meets the right
 * gutter.
 */
export function feedRailPageTarget(g: FeedRailGeometry, dir: 1 | -1): number {
  return Math.min(
    Math.max(0, g.scrollWidth - g.clientWidth),
    feedRailPageGoal(g, dir),
  );
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.(REDUCED_MOTION_QUERY).matches ? "auto" : "smooth";
}

type Phase = "loading" | "error" | "ready";
type More = "idle" | "loading" | "failed";

export function FeedRail({
  initialPage,
  loadPage,
  copy: copyOverride,
  now,
  logo,
  className,
}: FeedRailProps) {
  const copy = { ...FEED_RAIL_COPY, ...copyOverride };
  const phone = useMedia(PHONE_QUERY);
  const headingId = React.useId();
  const railId = React.useId();
  const railRef = React.useRef<HTMLDivElement>(null);

  const [phase, setPhase] = React.useState<Phase>(
    initialPage ? "ready" : "loading",
  );
  const [items, setItems] = React.useState<FeedCardData[]>(
    initialPage?.data ?? [],
  );
  const [cursor, setCursor] = React.useState<string | null>(
    initialPage?.nextCursor ?? null,
  );
  const [more, setMore] = React.useState<More>("idle");
  const moreRef = React.useRef<More>("idle");
  const [liveMsg, setLiveMsg] = React.useState("");
  const [edges, setEdges] = React.useState({ atStart: true, atEnd: false });
  const [dragging, setDragging] = React.useState(false);
  const dragMoved = React.useRef(false);
  const dragTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = React.useRef(true);
  const started = React.useRef(false);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // The drag-flag timer never outlives the rail.
      if (dragTimer.current !== null) clearTimeout(dragTimer.current);
      dragTimer.current = null;
    };
  }, []);

  const readFirstPage = React.useCallback(() => {
    setPhase("loading");
    loadPage({ cursor: null, limit: FEED_RAIL_SIZES.firstPage }).then(
      (page) => {
        if (!alive.current) return;
        setItems(page.data);
        setCursor(page.nextCursor);
        setEdges({ atStart: true, atEnd: false });
        setPhase("ready");
      },
      () => {
        if (alive.current) setPhase("error");
      },
    );
  }, [loadPage]);

  React.useEffect(() => {
    if (started.current || initialPage) return;
    started.current = true;
    readFirstPage();
  }, [initialPage, readFirstPage]);

  const loadMore = () => {
    if (phase !== "ready" || cursor === null || moreRef.current !== "idle")
      return;
    moreRef.current = "loading";
    setMore("loading");
    setLiveMsg(copy.loadingMore);
    const limit = phone
      ? FEED_RAIL_SIZES.nextPage.phone
      : FEED_RAIL_SIZES.nextPage.desktop;
    loadPage({ cursor, limit }).then(
      (page) => {
        if (!alive.current) return;
        moreRef.current = "idle";
        setItems((prev) => [...prev, ...page.data]);
        setCursor(page.nextCursor);
        setMore("idle");
        setLiveMsg(
          copy.loaded +
            page.data.length +
            (page.nextCursor === null ? `. ${copy.allLoaded}` : ""),
        );
      },
      () => {
        if (!alive.current) return;
        moreRef.current = "failed";
        setMore("failed");
        setLiveMsg(copy.loadMoreFailed);
      },
    );
  };

  const retryMore = () => {
    moreRef.current = "idle";
    loadMore();
  };

  /** The rail's own laid-out sizes: column track, gap and inline padding. */
  const railBox = (rail: HTMLElement) => {
    const style = getComputedStyle(rail);
    const slot = rail.querySelector<HTMLElement>("[data-slot]");
    return {
      column: slot ? slot.offsetWidth : 300,
      gap: parseFloat(style.columnGap) || 0,
      padStart: parseFloat(style.paddingLeft) || 0,
      padEnd: parseFloat(style.paddingRight) || 0,
    };
  };

  /** One slot (card + column gap) as laid out now. */
  const slotWidth = (rail: HTMLElement) => {
    const box = railBox(rail);
    return box.column + box.gap;
  };

  const [fitRows, setFitRows] = React.useState<1 | 2>(2);

  /**
   * #4191 — the row rule against the rail's observed content box. Returns
   * false while the laid-out rows are about to change (this layout is stale).
   */
  const measureRows = (): boolean => {
    const rail = railRef.current;
    if (!rail) return true;
    // The first-page placeholders keep the canvas two rows (`data = load`).
    if (phase === "loading") {
      setFitRows(2);
      return fitRows === 2;
    }
    const box = railBox(rail);
    const next = feedRailRows({
      count: rail.querySelectorAll("[data-slot]").length,
      inner: rail.clientWidth - box.padStart - box.padEnd,
      column: box.column,
      gap: box.gap,
    });
    setFitRows((prev) => (prev === next ? prev : next));
    return next === fitRows;
  };

  /**
   * #4191 — a → page whose goal lies past the loaded cards while the feed has
   * more: the rail scrolls as far as the laid-out cards allow and goes on to
   * the goal as the next feed pages land, so every → keeps the same step.
   * `issued` is the last scroll target sent, so a re-render does not restart
   * a running smooth scroll.
   */
  const pendingPage = React.useRef<{ goal: number; issued: number } | null>(
    null,
  );

  const followPendingPage = () => {
    const rail = railRef.current;
    const pending = pendingPage.current;
    if (!rail || !pending || phase !== "ready") return;
    const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const left = Math.min(max, pending.goal);
    if (
      pending.goal > max + 0.5 &&
      cursor !== null &&
      moreRef.current === "idle"
    )
      loadMore();
    // Reached, the whole feed is in, or the next page failed: the loaded
    // cards are as far as this page goes.
    if (moreRef.current !== "loading") pendingPage.current = null;
    if (Math.abs(left - pending.issued) > 0.5) {
      pending.issued = left;
      rail.scrollTo({ left, behavior: scrollBehavior() });
    }
  };

  /** The viewer takes the rail over: a pending page no longer applies. */
  const dropPendingPage = () => {
    pendingPage.current = null;
  };

  const measure = (): boolean => {
    const rail = railRef.current;
    const rowsSettled = measureRows();
    if (!rail || phase !== "ready") return rowsSettled;
    const max = rail.scrollWidth - rail.clientWidth;
    const atStart = rail.scrollLeft < 4;
    const atEnd =
      cursor === null &&
      moreRef.current !== "loading" &&
      rail.scrollLeft >= max - 4;
    setEdges((prev) =>
      prev.atStart === atStart && prev.atEnd === atEnd
        ? prev
        : { atStart, atEnd },
    );
    // EARS-15 — within one and a half cards of the end.
    if (
      rail.scrollLeft + rail.clientWidth >=
      rail.scrollWidth - slotWidth(rail) * 1.5
    )
      loadMore();
    return rowsSettled;
  };

  const measureRef = React.useRef(measure);
  measureRef.current = measure;
  const followRef = React.useRef(followPendingPage);
  followRef.current = followPendingPage;
  const railShown =
    phase !== "error" && !(phase === "ready" && items.length === 0);
  // A layout effect, so the row rule lands before the browser paints the
  // cards (no two-row flash for a few cards once the first page is in).
  // A pending → page follows once the appended cards are laid out in their
  // final rows.
  useIsomorphicLayoutEffect(() => {
    if (measureRef.current()) followRef.current();
  }, [items, phase, cursor, more, phone, fitRows]);
  React.useEffect(() => {
    const onResize = () => measureRef.current();
    window.addEventListener("resize", onResize);
    // The rail's own box can change without a window resize (container,
    // fonts); the row rule follows the observed size.
    const rail = railRef.current;
    const observer =
      rail && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(onResize)
        : null;
    if (rail) observer?.observe(rail);
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [railShown]);

  /** ← / → — one page of whole columns; arrow keys — one card. */
  const page = (dir: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    const pending = pendingPage.current;
    pendingPage.current = null;
    const geometry = {
      // A press while a page is still on its way pages on from that page.
      scrollLeft: pending ? pending.goal : rail.scrollLeft,
      scrollWidth: rail.scrollWidth,
      clientWidth: rail.clientWidth,
      ...railBox(rail),
    };
    const goal = feedRailPageGoal(geometry, dir);
    const left = feedRailPageTarget(geometry, dir);
    rail.scrollTo({ left, behavior: scrollBehavior() });
    if (goal > left + 0.5 && cursor !== null && moreRef.current !== "failed") {
      pendingPage.current = { goal, issued: left };
      loadMore();
    }
  };

  const step = (dir: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: dir * slotWidth(rail), behavior: scrollBehavior() });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail || e.target !== e.currentTarget) return;
    if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key))
      dropPendingPage();
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "Home")
      rail.scrollTo({ left: 0, behavior: scrollBehavior() });
    else if (e.key === "End")
      rail.scrollTo({ left: rail.scrollWidth, behavior: scrollBehavior() });
    else return;
    e.preventDefault();
  };

  // Mouse drag only — touch and pen keep the native swipe.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dropPendingPage();
    const rail = railRef.current;
    if (!rail || e.pointerType !== "mouse" || e.button !== 0) return;
    const x0 = e.clientX;
    const s0 = rail.scrollLeft;
    dragMoved.current = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!dragMoved.current && Math.abs(dx) > 5) {
        dragMoved.current = true;
        setDragging(true);
      }
      if (dragMoved.current) rail.scrollLeft = s0 - dx;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragMoved.current) return;
      const slot = slotWidth(rail);
      setDragging(false);
      rail.scrollTo({
        left: Math.round(rail.scrollLeft / slot) * slot,
        behavior: scrollBehavior(),
      });
      // As on the canvas: the flag lives only for the click that ends this
      // drag (swallowed in `onClickCapture`); a zero-delay timeout clears it
      // so a drag released outside the rail never swallows the next
      // activation.
      if (dragTimer.current !== null) clearTimeout(dragTimer.current);
      dragTimer.current = setTimeout(() => {
        dragTimer.current = null;
        dragMoved.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (!dragMoved.current) return;
    e.preventDefault();
    e.stopPropagation();
    dragMoved.current = false;
  };

  const loading = phase === "loading";
  const empty = phase === "ready" && items.length === 0;
  const error = phase === "error";
  const showRail = !empty && !error;
  const showArrows = !phone && showRail;
  const busy = loading || more === "loading";
  const sizeKey = phone ? "phone" : "desktop";
  const rows = phone ? 1 : fitRows;

  return (
    <section
      aria-labelledby={headingId}
      className={cn("w-full max-w-full min-w-0 overflow-x-clip", className)}
    >
      <div className="px-gutter">
        <div className="mb-4.5 flex items-end justify-between gap-4.5 border-t-2 border-border pt-4">
          <div className="min-w-0">
            <div className="mb-2 text-2xs font-extrabold tracking-micro text-primary-action uppercase">
              {copy.kicker}
            </div>
            <h3
              id={headingId}
              className="m-0 text-xl font-extrabold tracking-tight text-foreground lg:text-2xl"
            >
              {copy.title}
            </h3>
            <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {copy.lead}
            </div>
          </div>
          {showArrows ? (
            <div className="flex flex-none gap-2.5 max-lg:hidden">
              <Button
                variant="outline"
                size="icon"
                aria-label={copy.prev}
                aria-controls={railId}
                disabled={loading || edges.atStart}
                onClick={() => page(-1)}
              >
                <span aria-hidden="true">←</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={copy.next}
                aria-controls={railId}
                disabled={loading || edges.atEnd}
                onClick={() => page(1)}
              >
                <span aria-hidden="true">→</span>
              </Button>
            </div>
          ) : null}
        </div>
        {empty ? (
          <EmptyState
            variant="no-records"
            title={copy.emptyTitle}
            description={copy.emptyText}
          />
        ) : null}
        {error ? (
          <EmptyState
            variant="error"
            title={copy.error}
            action={
              <Button variant="outline" onClick={readFirstPage}>
                {copy.retry}
              </Button>
            }
          />
        ) : null}
      </div>
      {showRail ? (
        <div
          id={railId}
          ref={railRef}
          tabIndex={0}
          role="region"
          aria-roledescription={copy.railRoleDescription}
          aria-label={copy.railLabel}
          aria-busy={busy}
          data-rows={String(rows)}
          onScroll={measure}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onWheel={(e) => {
            // A horizontal wheel or trackpad swipe, not a page scroll.
            if (e.deltaX !== 0 || e.shiftKey) dropPendingPage();
          }}
          onClickCapture={onClickCapture}
          onDragStart={(e) => e.preventDefault()}
          className={cn(
            "box-border grid w-full max-w-full contain-inline-size grid-flow-col overscroll-x-contain px-gutter pt-1.5 pb-4 [scrollbar-width:none] scroll-pl-gutter focus-visible:shadow-focus focus-visible:outline-none [&::-webkit-scrollbar]:hidden",
            "auto-cols-[clamp(260px,calc((100vw_-_var(--spacing-gutter)_-_80px)/4.5),340px)] gap-5",
            rows === 1 ? "grid-rows-1" : "grid-rows-2",
            "max-lg:auto-cols-[min(400px,calc((100vw_-_var(--spacing-gutter)_-_12px)/1.25))] max-lg:grid-rows-1 max-lg:gap-3",
            loading ? "overflow-x-hidden" : "overflow-x-auto",
            dragging
              ? "cursor-grabbing snap-none select-none"
              : "cursor-grab snap-x snap-mandatory",
          )}
        >
          {loading
            ? Array.from(
                { length: FEED_RAIL_SIZES.firstPlaceholders[sizeKey] },
                (_, i) => (
                  <div
                    key={`ph-${i}`}
                    data-slot=""
                    className="min-w-0 snap-start"
                  >
                    <FeedCardSkeleton />
                  </div>
                ),
              )
            : items.map((card) => (
                <div key={card.id} data-slot="" className="min-w-0 snap-start">
                  <FeedCard card={card} now={now} logo={logo} />
                </div>
              ))}
          {more === "loading"
            ? Array.from(
                { length: FEED_RAIL_SIZES.morePlaceholders[sizeKey] },
                (_, i) => (
                  <div
                    key={`more-${i}`}
                    data-slot=""
                    className="min-w-0 snap-start"
                  >
                    <FeedCardSkeleton />
                  </div>
                ),
              )
            : null}
          {more === "failed" ? (
            <div data-slot="" className="flex min-w-0 snap-start">
              <EmptyState
                variant="error"
                role={undefined}
                className="w-full"
                title={copy.loadMoreFailed}
                action={
                  <Button variant="outline" onClick={retryMore}>
                    {copy.retry}
                  </Button>
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {liveMsg}
      </span>
    </section>
  );
}
