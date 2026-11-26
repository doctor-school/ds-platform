"use client";

import * as React from "react";
import type {
  FeedCard as FeedCardData,
  FeedPostCard,
  FeedVideoCard,
} from "@ds/schemas";

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
 * Slice 3 (048 EARS-49, #4006) adds the VK form of `post` (`source` = vk) and
 * the `video` variant (`source` = «vk-видео»), with the same lead corrections.
 * A VK preview is referenced on VK's servers (048-design «Preview (slice 3)»):
 * it is requested with no referrer, and one that fails to load leaves the card
 * in its no-image layout. Nothing plays inside the card.
 *
 * The whole card is ONE link — no nested interactive element: own cards open
 * in the same tab, a `post` or `video` opens its original in a new tab with
 * `rel="noopener noreferrer"`. The frame presses its offset shadow
 * `shadow-lg` → `shadow-md` on hover and shows `shadow-focus` on keyboard
 * focus.
 */

/** U+FE0E — keeps ▶ / ↗ in text presentation (Stage A correction 4). */
const TEXT_GLYPH = "\uFE0E";

export const FEED_CARD_COPY = {
  kinds: { news: "Новость", column: "Колонка эксперта" },
  /** The news source line (canvas `SRC['академия'].name`). */
  academy: "Академия",
  partner: (name: string) => `Партнёрский материал · ${name}`,
  /** The doctor content card's done mark (canvas `unit-content-card` «✓ Завершено»). */
  done: "✓ Завершено",
  /** The `post` network (canvas `SRC.telegram`): field mark, chip, mark. */
  telegram: {
    net: "Telegram",
    chip: "TG",
    newTab: ", откроется в новой вкладке на площадке Telegram",
  },
  /** The VK `post` (canvas `SRC.vk`). */
  vk: {
    net: "VK",
    chip: "VK",
    newTab: ", откроется в новой вкладке на площадке VK",
  },
  /** The `video` (canvas `SRC['vk-видео']`). */
  vkVideo: {
    net: "VK Видео",
    chip: `VK▶${TEXT_GLYPH}`,
    newTab: ", откроется в новой вкладке на площадке VK Видео",
  },
} as const;

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

/**
 * The doctor content card, variant Б «типографская» of
 * `design-source/unit-content-card.dc.html` (018 #1497; first used by the 023
 * school's course list): a metric column (a count and its label), the kicker
 * and scope, the title, the description, a facts line, the done mark, the
 * partner mark and the call to action. Every text is the caller's data or
 * copy; the card prints no number of its own.
 */
export interface FeedContentCardData {
  kind: "content";
  href: string;
  /** «Курс», «Урок» … — the content's kind word. */
  kicker: string;
  /** Where it belongs (the school); null for none. */
  scope: string | null;
  title: string;
  description: string | null;
  /** The metric column: a count and its word («18» «уроков»). */
  metric: { value: string; label: string };
  /** Extra facts in one line, joined with « · ». */
  facts: readonly string[];
  /** The viewer's state; null for a guest or not started. */
  state: "done" | "started" | null;
  partner: { name: string } | null;
  cta: string;
}

/**
 * The doctor content row, variant В «строка» of
 * `design-source/unit-content-card.dc.html` (023 school's over-six list): the
 * kicker, the title, one meta line and the arrow. Every text is the caller's.
 */
export interface FeedContentRowData {
  kind: "content-row";
  href: string;
  kicker: string;
  title: string;
  /** One meta line («6 уроков»). */
  meta: string;
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
  /** One card of the public feed page (`FeedCardSchema`), or a doctor content card or row. */
  card: FeedCardData | FeedContentCardData | FeedContentRowData;
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
  if (card.kind === "content") {
    return <FeedContentCard card={card} className={className} />;
  }
  if (card.kind === "content-row") {
    return <FeedContentRow card={card} className={className} />;
  }
  const link = cn(
    "relative block text-inherit no-underline shadow-lg transition-shadow duration-150 hover:shadow-md focus-visible:shadow-focus focus-visible:outline-none",
    className,
  );
  if (card.kind === "post" || card.kind === "video") {
    return (
      <FeedNetworkCardView card={card} now={now} logo={logo} link={link} />
    );
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
              "text-lg leading-title font-bold tracking-title wrap-break-word text-pretty text-foreground",
              clamp,
            )}
          >
            {card.title}
          </div>

          <div className="mt-auto flex flex-col gap-2">
            {card.partner ? (
              <div className="border-t border-hairline pt-2 text-xs leading-label font-semibold text-muted-foreground">
                {FEED_CARD_COPY.partner(card.partner.name)}
              </div>
            ) : null}
            <div className="text-sm leading-label font-semibold text-muted-foreground tabular-nums">
              <span>{formatFeedCardDate(card.publishedAt, now)}</span>
            </div>
          </div>
        </div>
      </FeedCardFrame>
    </a>
  );
}

/**
 * Variant Б: the metric column beside the body from the `layout` breakpoint
 * (the canvas `m` switch, 900px), stacked above it below; below it the card
 * has no frame — no border and no offset shadow (canvas `border:0;box-shadow:none`).
 */
function FeedContentCard({
  card,
  className,
}: {
  card: FeedContentCardData;
  className?: string | undefined;
}) {
  return (
    <a
      href={card.href}
      data-feed-card="content"
      className={cn(
        "group flex flex-col border-0 border-border bg-card text-inherit no-underline shadow-none transition duration-150 focus-visible:shadow-focus focus-visible:outline-none layout:flex-row layout:border-2 layout:shadow-lg layout:hover:translate-x-px layout:hover:translate-y-px layout:hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-baseline gap-3 bg-tint px-4 py-3 layout:w-36 layout:flex-none layout:flex-col layout:justify-center layout:gap-2 layout:border-r-2 layout:border-border layout:px-4 layout:py-5">
        <span className="text-3xl leading-none font-extrabold tracking-tight text-tint-foreground tabular-nums">
          {card.metric.value}
        </span>
        <span className="text-eyebrow font-extrabold tracking-eyebrow text-tint-foreground uppercase">
          {card.metric.label}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 layout:px-6 layout:py-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-extrabold tracking-eyebrow text-primary-action uppercase">
            {card.kicker}
          </span>
          {card.scope ? (
            <span className="font-bold text-faint">· {card.scope}</span>
          ) : null}
          {card.state === "done" ? (
            <span className="ml-auto text-sm font-extrabold whitespace-nowrap text-success-text">
              {FEED_CARD_COPY.done}
            </span>
          ) : null}
        </div>
        <div className="text-lg leading-title font-extrabold tracking-tight text-pretty text-foreground group-hover:text-primary-action">
          {card.title}
        </div>
        {card.description ? (
          <p className="m-0 max-w-prose text-sm text-muted-foreground">
            {card.description}
          </p>
        ) : null}
        {card.facts.length > 0 ? (
          <div className="text-sm font-bold text-tint-foreground">
            {card.facts.join(" · ")}
          </div>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
          {card.partner ? (
            <span className="border border-hairline px-2 py-1 text-xs font-extrabold tracking-wide text-faint uppercase">
              {FEED_CARD_COPY.partner(card.partner.name)}
            </span>
          ) : null}
          <span className="ml-auto text-sm font-extrabold whitespace-nowrap text-primary-action underline decoration-2 underline-offset-4">
            {card.cta}
          </span>
        </div>
      </div>
    </a>
  );
}

/**
 * Variant В: one row, the whole row the link. On a phone rows are separated by
 * a hairline; from the `layout` breakpoint each row is framed (canvas `vRow`).
 */
function FeedContentRow({
  card,
  className,
}: {
  card: FeedContentRowData;
  className?: string | undefined;
}) {
  return (
    <a
      href={card.href}
      data-feed-card="content-row"
      className={cn(
        "group flex items-center gap-3.5 border-b border-hairline bg-card px-3.5 py-3 text-inherit no-underline transition-colors duration-150 hover:bg-section focus-visible:shadow-focus focus-visible:outline-none layout:border-2 layout:border-border layout:px-4.5",
        className,
      )}
    >
      <span className="w-20 flex-none text-eyebrow font-extrabold tracking-eyebrow text-primary-action uppercase">
        {card.kicker}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-snug font-bold tracking-tight text-foreground group-hover:text-primary-action group-hover:underline group-hover:underline-offset-4">
        {card.title}
      </span>
      <span className="flex-none text-xs font-bold whitespace-nowrap text-faint tabular-nums">
        {card.meta}
      </span>
      <span
        aria-hidden="true"
        className="flex-none text-sm font-extrabold text-primary-action"
      >
        →
      </span>
    </a>
  );
}

const MEDIA =
  "relative aspect-video overflow-hidden border-b-2 border-border bg-section";

function FeedCardImage({
  url,
  referenced = false,
  onBroken,
}: {
  url: string;
  /** A preview on the platform's servers (VK): no referrer, a load error reported. */
  referenced?: boolean;
  onBroken?: () => void;
}) {
  const ref = React.useRef<HTMLImageElement>(null);
  // An image of a server-rendered page can fail before React attaches
  // `onError`: a finished load with no pixels is that missed error.
  React.useEffect(() => {
    const img = ref.current;
    if (onBroken && img?.complete && img.naturalWidth === 0) onBroken();
  }, [url, onBroken]);
  return (
    <img
      ref={ref}
      src={url}
      alt=""
      referrerPolicy={referenced ? "no-referrer" : undefined}
      onError={onBroken}
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
      <span className="text-3xl leading-none font-extrabold tracking-display text-balance text-primary-action">
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
 * The network variants: `post` (canvas `source` = telegram / vk) and `video`
 * (canvas `source` = «vk-видео»). Canvas clamp math: 148px of text room (no
 * kind mark, never a partner) over a 24px post line or a 23px title line → 6.
 */
function FeedNetworkCardView({
  card,
  now,
  logo,
  link,
}: {
  card: FeedPostCard | FeedVideoCard;
  now: Date | undefined;
  logo: React.ReactNode;
  link: string;
}) {
  const copy =
    card.kind === "video"
      ? FEED_CARD_COPY.vkVideo
      : card.source.platform === "vk"
        ? FEED_CARD_COPY.vk
        : FEED_CARD_COPY.telegram;
  // EARS-49 — a referenced VK preview that fails to load: the no-image layout.
  const referenced = card.source.platform === "vk";
  const [brokenUrl, setBrokenUrl] = React.useState<string | null>(null);
  const image = card.image && card.image.url !== brokenUrl ? card.image : null;
  return (
    <a
      href={card.href}
      target="_blank"
      rel="noopener noreferrer"
      className={link}
    >
      <FeedCardFrame>
        <div className={MEDIA}>
          {image ? (
            <>
              <FeedCardImage
                url={image.url}
                referenced={referenced}
                {...(referenced
                  ? { onBroken: () => setBrokenUrl(image.url) }
                  : {})}
              />
              {card.duration !== null ? (
                <>
                  <span
                    aria-hidden="true"
                    data-feed-card-play=""
                    className="absolute top-1/2 left-1/2 flex size-12 -translate-1/2 items-center justify-center bg-foreground text-lead text-background shadow-btn"
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
              className="shrink-0 border-2 border-border px-1 py-px text-eyebrow leading-label font-extrabold tracking-wide text-foreground"
            >
              {copy.chip}
            </span>
          </div>

          {card.kind === "video" ? (
            <div className="line-clamp-6 text-lg leading-title font-bold tracking-title wrap-break-word text-pretty text-foreground">
              {card.title}
            </div>
          ) : card.text ? (
            <div
              data-feed-card-text=""
              className="line-clamp-6 text-base leading-normal wrap-break-word text-pretty text-foreground"
            >
              {card.text}
            </div>
          ) : null}

          <div className="mt-auto flex items-center justify-between gap-2 text-sm leading-label font-semibold text-muted-foreground tabular-nums">
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
            <Skeleton className="h-4 w-7/12" />
          </div>
          <Skeleton className="h-6 w-2/5" />
          <Skeleton className="h-5" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="mt-auto h-4 w-1/3" />
        </div>
      </FeedCardFrame>
    </div>
  );
}
