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
  /** The first page read on the server; when absent the rail reads it itself. */
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
  const alive = React.useRef(true);
  const started = React.useRef(false);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
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

  /** One slot (card + column gap) as laid out now. */
  const slotWidth = (rail: HTMLElement) => {
    const slot = rail.querySelector<HTMLElement>("[data-slot]");
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
    return (slot ? slot.offsetWidth : 300) + gap;
  };

  const measure = () => {
    const rail = railRef.current;
    if (!rail || phase !== "ready") return;
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
  };

  const measureRef = React.useRef(measure);
  measureRef.current = measure;
  React.useEffect(() => {
    measureRef.current();
  }, [items, phase, cursor, more]);
  React.useEffect(() => {
    const onResize = () => measureRef.current();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const step = (dir: 1 | -1, screen: boolean) => {
    const rail = railRef.current;
    if (!rail) return;
    const slot = slotWidth(rail);
    const padLeft = parseFloat(getComputedStyle(rail).paddingLeft) || 0;
    const n = screen
      ? Math.max(1, Math.floor((rail.clientWidth - padLeft) / slot))
      : 1;
    rail.scrollBy({ left: dir * n * slot, behavior: scrollBehavior() });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail || e.target !== e.currentTarget) return;
    if (e.key === "ArrowRight") step(1, false);
    else if (e.key === "ArrowLeft") step(-1, false);
    else if (e.key === "Home")
      rail.scrollTo({ left: 0, behavior: scrollBehavior() });
    else if (e.key === "End")
      rail.scrollTo({ left: rail.scrollWidth, behavior: scrollBehavior() });
    else return;
    e.preventDefault();
  };

  // Mouse drag only — touch and pen keep the native swipe.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
      // `dragMoved` stays set for the click that ends this drag (swallowed in
      // `onClickCapture`); the next press resets it.
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
                onClick={() => step(-1, true)}
              >
                <span aria-hidden="true">←</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={copy.next}
                aria-controls={railId}
                disabled={loading || edges.atEnd}
                onClick={() => step(1, true)}
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
          data-rows={phone ? "1" : "2"}
          onScroll={measure}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
          onDragStart={(e) => e.preventDefault()}
          className={cn(
            "box-border grid w-full max-w-full contain-inline-size grid-flow-col overscroll-x-contain px-gutter pt-1.5 pb-4 [scrollbar-width:none] scroll-pl-gutter focus-visible:shadow-focus focus-visible:outline-none [&::-webkit-scrollbar]:hidden",
            "auto-cols-[clamp(260px,calc((100vw_-_var(--spacing-gutter)_-_80px)/4.5),340px)] grid-rows-2 gap-5",
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
