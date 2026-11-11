import * as React from "react";
import type { FeedCard as FeedCardData } from "@ds/schemas";

import { cn } from "../lib/utils";
import { Avatar } from "../primitives/avatar";
import { Badge } from "../primitives/badge";
import { Card } from "../primitives/card";
import { Skeleton } from "../primitives/skeleton";

/**
 * `<FeedCard>` — 048 EARS-13 / EARS-19 (#3516): the ONE shared feed card,
 * built from `design-source/unit-feed-card.dc.html`. It renders from the card
 * object of the public feed contract alone (`FeedCardSchema`, EARS-10); the
 * variant is selected by `card.kind` (and, in later slices, the network
 * members), never by a second component.
 *
 * Slice 1 draws `source` = «академия» / «колонка», `media` = «картинка» /
 * «нет», `partnerMark` = «нет» / «есть» and the skeleton. No duration and no
 * network mark; the canvas `data-link` text underline is a canvas-runtime
 * artefact and is not built (048-design «Academy — rail and card»).
 *
 * The whole card is ONE same-tab link — no nested interactive element. The
 * frame presses its offset shadow `shadow-lg` → `shadow-md` on hover and
 * shows `shadow-focus` on keyboard focus.
 */

export const FEED_CARD_COPY = {
  kinds: { news: "Новость", column: "Колонка эксперта" },
  /** The news source line (canvas `SRC['академия'].name`). */
  academy: "Академия",
  partner: (name: string) => `Партнёрский материал · ${name}`,
} as const;

const MSK = "Europe/Moscow";
const MSK_DAY_MONTH = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK,
  day: "numeric",
  month: "long",
});
const MSK_YEAR = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK,
  year: "numeric",
});

/**
 * The card date (Lead decision 10): day + month in Moscow time, the year
 * appended when it is not the current Moscow year — «19 августа»,
 * «4 марта 2025».
 */
export function formatFeedCardDate(
  isoInstant: string,
  now: Date = new Date(),
): string {
  const at = new Date(isoInstant);
  const dayMonth = MSK_DAY_MONTH.format(at);
  const year = MSK_YEAR.format(at);
  return year === MSK_YEAR.format(now) ? dayMonth : `${dayMonth} ${year}`;
}

/** Canvas initials: dots dropped, the first letters of the first two words. */
function initialsOf(name: string): string {
  return name
    .replace(/\./g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

/**
 * The card frame shared by the card and its placeholder (and, later, the
 * doctor variant): the `Card` primitive with the offset shadow lifted onto
 * the outer element, as the canvas draws it.
 */
function FeedCardFrame({ children }: { children: React.ReactNode }) {
  return (
    <Card className="block overflow-hidden p-0 shadow-none">{children}</Card>
  );
}

/** Body height of the canvas card (264px) — the title clamp is sized to it. */
const BODY = "flex h-66 flex-col gap-3 overflow-hidden p-4";

export interface FeedCardProps {
  /** One card of the public feed page (`FeedCardSchema`). */
  card: FeedCardData;
  /** «Now» for the year rule; injectable for tests. */
  now?: Date | undefined;
  /**
   * The Academy logo mark drawn in the news source avatar (canvas
   * `assets/ds-logo-icon.svg`); host-supplied like every brand asset.
   */
  logo?: React.ReactNode;
  className?: string | undefined;
}

export function FeedCard({ card, now, logo, className }: FeedCardProps) {
  const isNews = card.kind === "news";
  const kindMark = FEED_CARD_COPY.kinds[card.kind];
  const sourceName = isNews ? FEED_CARD_COPY.academy : card.source.name;
  // Canvas clamp math: 148px of text room − the kind mark 36 − the partner
  // mark 34, over a 23px title line → 4 lines, 3 with a partner.
  const clamp = card.partner ? "line-clamp-3" : "line-clamp-4";

  return (
    <a
      href={card.href}
      className={cn(
        "relative block text-inherit no-underline shadow-lg transition-shadow duration-150 hover:shadow-md focus-visible:shadow-focus focus-visible:outline-none",
        className,
      )}
    >
      <FeedCardFrame>
        <div className="relative aspect-video overflow-hidden border-b-2 border-border bg-section">
          {card.image ? (
            <img
              src={card.image.url}
              alt=""
              className="absolute inset-0 block size-full object-cover"
            />
          ) : (
            <div
              data-feed-card-media="none"
              className="absolute inset-0 flex items-end p-4"
            >
              <span className="text-3xl leading-none font-extrabold tracking-tight text-balance text-primary-action">
                {kindMark}
              </span>
            </div>
          )}
        </div>

        <div className={BODY}>
          <div className="flex min-w-0 items-center gap-2">
            {isNews ? (
              <Avatar
                variant="tint"
                aria-hidden="true"
                data-feed-card-avatar="logo"
                className="shrink-0"
              >
                <span className="flex size-3/5 items-center justify-center [&>*]:size-full [&>*]:object-contain">
                  {logo}
                </span>
              </Avatar>
            ) : (
              <Avatar
                variant="tint"
                aria-hidden="true"
                data-feed-card-avatar="initials"
                className="shrink-0"
              >
                {initialsOf(card.source.name)}
              </Avatar>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {sourceName}
            </span>
          </div>

          <div className="flex">
            <Badge variant="label">{kindMark}</Badge>
          </div>

          <div
            className={cn(
              "text-lg leading-snug font-bold tracking-tight wrap-break-word text-pretty text-foreground",
              clamp,
            )}
          >
            {card.title}
          </div>

          <div className="mt-auto flex flex-col gap-2">
            {card.partner ? (
              <div className="border-t border-hairline pt-2 text-xs font-semibold text-muted-foreground">
                {FEED_CARD_COPY.partner(card.partner.name)}
              </div>
            ) : null}
            <div className="text-sm font-semibold text-muted-foreground tabular-nums">
              <span>{formatFeedCardDate(card.publishedAt, now)}</span>
            </div>
          </div>
        </div>
      </FeedCardFrame>
    </a>
  );
}

/** The placeholder card (canvas `skeleton`) — decorative, no link. */
export function FeedCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-feed-card-skeleton=""
      className={cn("shadow-lg", className)}
    >
      <FeedCardFrame>
        <div className="aspect-video border-b-2 border-border">
          <Skeleton className="size-full" />
        </div>
        <div className={BODY}>
          <div className="flex items-center gap-2">
            <Skeleton className="size-10 shrink-0" />
            <Skeleton className="h-3.5 w-7/12" />
          </div>
          <Skeleton className="h-5.5 w-2/5" />
          <Skeleton className="h-4.5" />
          <Skeleton className="h-4.5 w-4/5" />
          <Skeleton className="h-4.5 w-3/5" />
          <Skeleton className="mt-auto h-3.5 w-1/3" />
        </div>
      </FeedCardFrame>
    </div>
  );
}
