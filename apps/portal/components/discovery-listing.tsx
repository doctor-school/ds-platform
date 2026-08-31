import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { PastBroadcastCard } from "@ds/schemas";
import { Link as DsLink } from "@ds/design-system/link";
import { fetchEventListingWithCursorFallback } from "@/lib/public-events";
import { fetchMyEvents } from "@/lib/my-events";
import {
  formatMskDayLabel,
  formatMskMonth,
  formatMskParts,
  formatMskWeekdayShort,
  mskDayKey,
  mskMonthKey,
} from "@/lib/msk";
import { buildWebinarsHref, type WebinarsQueryInput } from "@/lib/webinars-url";
import { CalendarShell } from "./calendar-shell";
import { EventListRouter } from "./event-list-router";
import { ViewSwitcher } from "./view-switcher";

async function fetchRegisteredSlugs(): Promise<ReadonlySet<string>> {
  const h = await headers();
  try {
    const result = await fetchMyEvents({
      cookie: h.get("cookie") ?? "",
      userAgent: h.get("user-agent") ?? "",
      acceptLanguage: h.get("accept-language") ?? "",
    });
    // `MyEvents` is an envelope per tab (014 EARS-9); the public listing's
    // «вы записаны» marker is about the caller's UPCOMING registrations, which
    // is the read's default tab — the rows live under `.data`.
    return new Set(
      result.authenticated ? result.events.data.map((event) => event.slug) : [],
    );
  } catch {
    return new Set();
  }
}

/** Academy host projection around the shared, controlled and fetch-free EventList. */
export default async function DiscoveryListing({
  monthViewHref,
  weekViewHref = "/webinars",
  timeframe = "upcoming",
  cursor,
  page = 1,
  queryParams,
}: {
  monthViewHref: string;
  weekViewHref?: string;
  timeframe?: "upcoming" | "past";
  cursor?: string;
  page?: number;
  /** The route's raw query, so a rejected cursor can be stripped from the URL itself. */
  queryParams?: WebinarsQueryInput;
}) {
  const t = await getTranslations("webinars");
  const [{ listing, cursorRejected }, registeredSlugs] = await Promise.all([
    fetchEventListingWithCursorFallback({ timeframe, cursor }),
    fetchRegisteredSlugs(),
  ]);
  // #1640: a `?cursor=` the api could not decode (shared, truncated or stale
  // link) degrades to the first page rather than a 500. Pagination state is
  // THREE params — `cursor`, `cursorTrail` and `page` — and `cursorTrail` is
  // read by the client router straight from the URL, so resetting only the two
  // props would leave a stale back-stack behind: "next" then "previous" would
  // pop a foreign cursor and show later-page content under the page-1 label.
  // So redirect to the canonical stripped URL through the repo's single reset
  // (`resetFeedPage`): all three clear atomically, the visitor keeps a clean
  // shareable link, and no reload re-issues the doomed upstream request.
  if (cursorRejected && queryParams) {
    redirect(
      buildWebinarsHref(queryParams, { view: "week", resetFeedPage: true }),
    );
  }
  const effectiveCursor = cursorRejected ? undefined : cursor;
  const effectivePage = cursorRejected ? 1 : page;
  const items = listing.data.map((card) => {
    const parts = formatMskParts(card.startsAt);
    const recording =
      "recording" in card ? (card as PastBroadcastCard).recording : null;
    return {
      id: card.id,
      groupKey:
        timeframe === "past"
          ? mskMonthKey(card.startsAt)
          : mskDayKey(card.startsAt),
      groupLabel:
        timeframe === "past"
          ? formatMskMonth(card.startsAt)
          : formatMskDayLabel(card.startsAt),
      href: `/webinars/${card.slug}`,
      time: parts.time,
      tzLabel: t("cardTz"),
      dateLabel: t("cardDate", {
        date: parts.date,
        weekday: formatMskWeekdayShort(card.startsAt),
      }),
      school: card.school,
      title: card.title,
      specialties: card.specialties,
      speakers: card.speakers,
      live: card.state === "live",
      liveLabel: t("live"),
      recordingLabel: recording ? t(`recording.${recording.state}`) : undefined,
      variant: timeframe === "past" ? ("past" as const) : ("upcoming" as const),
      ctaHref: timeframe === "past" ? `/webinars/${card.slug}` : undefined,
      ctaLabel: timeframe === "past" ? t("recordingCta") : undefined,
      registered: registeredSlugs.has(card.slug),
      registeredLabel: t("registered"),
    };
  });

  const toolbar = (
    <>
      <div
        className="flex flex-wrap items-stretch gap-2.5 layout:gap-3"
        data-testid="week-toolbar"
      >
        <span className="hidden flex-1 layout:block" />
        <div className="hidden layout:block">
          <ViewSwitcher
            active="week"
            weekHref={weekViewHref}
            monthHref={monthViewHref}
            weekLabel={t("month.viewWeek")}
            monthLabel={t("month.viewMonth")}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between layout:hidden">
        <span
          aria-current="page"
          className="text-caption font-extrabold text-tint-foreground"
        >
          {t("month.viewWeek")}
        </span>
        <DsLink
          asChild
          variant="inline"
          className="text-caption font-bold text-tint-foreground"
        >
          <Link href={monthViewHref}>
            {t("month.viewMonth")}
            <span aria-hidden="true"> →</span>
          </Link>
        </DsLink>
      </div>
    </>
  );

  return (
    <CalendarShell
      title={t("title")}
      subtitle={
        timeframe === "past"
          ? t("archiveSubtitle", { count: listing.counts.past })
          : t("subtitle")
      }
      taglineTop={t("taglineTop")}
      taglineBottom={t("taglineBottom")}
      toolbar={null}
    >
      <div className="-mt-16 layout:mt-0" data-testid="week-listbody">
        <EventListRouter
          items={items}
          selectedTab={timeframe}
          counts={listing.counts}
          labels={{
            upcoming: t("tabs.upcoming"),
            past: t("tabs.past"),
            emptyTitle: t(
              timeframe === "past" ? "pastEmpty.title" : "empty.title",
            ),
            emptyDescription: t(
              timeframe === "past" ? "pastEmpty.body" : "empty.body",
            ),
            pagination: t("pagination.label"),
            previous: t("pagination.previous"),
            next: t("pagination.next"),
            pagePrefix: t("pagination.page"),
          }}
          cursor={effectiveCursor}
          nextCursor={listing.pagination.nextCursor}
          hasMore={listing.pagination.hasMore}
          page={effectivePage}
          toolbar={timeframe === "upcoming" ? toolbar : undefined}
        />
      </div>
    </CalendarShell>
  );
}
