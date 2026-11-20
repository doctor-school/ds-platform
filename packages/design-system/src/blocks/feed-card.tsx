import * as React from "react";
import type { FeedCard as FeedCardData, FeedPostCard } from "@ds/schemas";

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
 * Slice 2 (048 EARS-34, #3997) adds the `post` variant — `source` =
 * telegram, `media` = «картинка» / «видео» / «нет» — with the Stage A lead
 * corrections (#3997 comment 6941007863): the source line wraps, never
 * truncates; no partner line; a video without a copied preview takes the plain
 * no-image layout (not the canvas «Превью видео» placeholder); ▶ and ↗ carry
 * U+FE0E so they render as text glyphs, not colour emoji.
 *
 * The whole card is ONE link — no nested interactive element: own cards open
 * in the same tab, a `post` opens its original in a new tab with
 * `rel="noopener noreferrer"`. The frame presses its offset shadow
 * `shadow-lg` → `shadow-md` on hover and shows `shadow-focus` on keyboard
 * focus.
 */

export const FEED_CARD_COPY = {
  kinds: { news: "Новость", column: "Колонка эксперта" },
  /** The news source line (canvas `SRC['академия'].name`). */
  academy: "Академия",
  partner: (name: string) => `Партнёрский материал · ${name}`,
  /** The `post` network (canvas `SRC.telegram`): field mark, chip, mark. */
  telegram: {
    net: "Telegram",
    chip: "TG",
    newTab: ", откроется в новой вкладке на площадке Telegram",
  },
} as const;

/** U+FE0E — keeps ▶ / ↗ in text presentation (Stage A correction 4). */
const TEXT_GLYPH = "\uFE0E";

/**
 * A video duration in whole seconds as `m:ss`, `h:mm:ss` from one hour
 * (048 EARS-34).
 */
export function formatFeedDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

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
  const link = cn(
    "relative block text-inherit no-underline shadow-lg transition-shadow duration-150 hover:shadow-md focus-visible:shadow-focus focus-visible:outline-none",
    className,
  );
  if (card.kind === "post") {
    return <FeedPostCardView card={card} now={now} logo={logo} link={link} />;
  }

  const isNews = card.kind === "news";
  const kindMark = FEED_CARD_COPY.kinds[card.kind];
  const sourceName = isNews ? FEED_CARD_COPY.academy : card.source.name;
  // Canvas clamp math: 148px of text room − the kind mark 36 − the partner
  // mark 34, over a 23px title line → 4 lines, 3 with a partner.
  const clamp = card.partner ? "line-clamp-3" : "line-clamp-4";

  return (
    <a href={card.href} className={link}>
      <FeedCardFrame>
        <div className={MEDIA}>
          {card.image ? (
            <FeedCardImage url={card.image.url} />
          ) : (
            <FeedCardFieldMark mark={kindMark} />
          )}
        </div>

        <div className={BODY}>
          <div className="flex min-w-0 items-center gap-2">
            {isNews ? (
              <FeedCardLogoAvatar logo={logo} />
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
              "text-lg leading-title font-bold tracking-tight wrap-break-word text-pretty text-foreground",
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

const MEDIA =
  "relative aspect-video overflow-hidden border-b-2 border-border bg-section";

function FeedCardImage({ url }: { url: string }) {
  return (
    <img
      src={url}
      alt=""
      className="absolute inset-0 block size-full object-cover"
    />
  );
}

/** The no-image layout: the field mark set large at the bottom-left. */
function FeedCardFieldMark({ mark }: { mark: string }) {
  return (
    <div
      data-feed-card-media="none"
      className="absolute inset-0 flex items-end p-4"
    >
      <span className="text-3xl leading-none font-extrabold tracking-tight text-balance text-primary-action">
        {mark}
      </span>
    </div>
  );
}

function FeedCardLogoAvatar({ logo }: { logo: React.ReactNode }) {
  return (
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
  );
}

/**
 * The `post` variant (canvas `source` = telegram). Canvas clamp math: 148px
 * of text room (no kind mark, never a partner) over a 24px body line → 6.
 */
function FeedPostCardView({
  card,
  now,
  logo,
  link,
}: {
  card: FeedPostCard;
  now: Date | undefined;
  logo: React.ReactNode;
  link: string;
}) {
  const copy = FEED_CARD_COPY.telegram;
  return (
    <a
      href={card.href}
      target="_blank"
      rel="noopener noreferrer"
      className={link}
    >
      <FeedCardFrame>
        <div className={MEDIA}>
          {card.image ? (
            <>
              <FeedCardImage url={card.image.url} />
              {card.duration !== null ? (
                <>
                  <span
                    aria-hidden="true"
                    data-feed-card-play=""
                    className="absolute top-1/2 left-1/2 flex size-13 -translate-1/2 items-center justify-center bg-foreground text-lg text-background shadow-btn"
                  >
                    {`▶${TEXT_GLYPH}`}
                  </span>
                  <span
                    data-feed-card-duration=""
                    className="absolute right-2 bottom-2 bg-foreground px-1.5 py-0.5 text-xs font-bold text-background tabular-nums"
                  >
                    {formatFeedDuration(card.duration)}
                  </span>
                </>
              ) : null}
            </>
          ) : (
            <FeedCardFieldMark mark={copy.net} />
          )}
        </div>

        <div className={BODY}>
          <div className="flex min-w-0 items-center gap-2">
            <FeedCardLogoAvatar logo={logo} />
            <span className="min-w-0 flex-1 text-sm font-semibold wrap-break-word text-foreground">
              {card.source.name}
            </span>
            <span
              role="img"
              aria-label={copy.net}
              title={copy.net}
              className="shrink-0 border-2 border-border px-1 text-xs leading-4 font-extrabold tracking-wide text-foreground"
            >
              {copy.chip}
            </span>
          </div>

          {card.text ? (
            <div
              data-feed-card-text=""
              className="line-clamp-6 text-base leading-normal wrap-break-word text-pretty text-foreground"
            >
              {card.text}
            </div>
          ) : null}

          <div className="mt-auto flex items-center justify-between gap-2 text-sm font-semibold text-muted-foreground tabular-nums">
            <span>{formatFeedCardDate(card.publishedAt, now)}</span>
            <span
              data-feed-card-external=""
              className="font-bold text-foreground"
            >
              <span aria-hidden="true">{`${copy.net} ↗${TEXT_GLYPH}`}</span>
              <span className="sr-only">{copy.newTab}</span>
            </span>
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
