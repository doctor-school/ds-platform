import Link from "next/link";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { PastBroadcastCard } from "@ds/schemas";
import { Link as DsLink } from "@ds/design-system/link";
import { fetchEventListing } from "@/lib/public-events";
import { fetchMyEvents } from "@/lib/my-events";
import {
  formatMskDayLabel,
  formatMskParts,
  formatMskWeekdayShort,
  mskDayKey,
} from "@/lib/msk";
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
    return new Set(
      result.authenticated ? result.events.map((event) => event.slug) : [],
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
}: {
  monthViewHref: string;
  weekViewHref?: string;
  timeframe?: "upcoming" | "past";
  cursor?: string;
  page?: number;
}) {
  const t = await getTranslations("webinars");
  const [listing, registeredSlugs] = await Promise.all([
    fetchEventListing({ timeframe, cursor }),
    fetchRegisteredSlugs(),
  ]);
  const items = listing.data.map((card) => {
    const parts = formatMskParts(card.startsAt);
    const recording =
      "recording" in card ? (card as PastBroadcastCard).recording : null;
    return {
      id: card.id,
      groupKey: mskDayKey(card.startsAt),
      groupLabel: formatMskDayLabel(card.startsAt),
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
      subtitle={t("subtitle")}
      taglineTop={t("taglineTop")}
      taglineBottom={t("taglineBottom")}
      toolbar={toolbar}
    >
      <div className="layout:mt-14" data-testid="week-listbody">
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
          cursor={cursor}
          nextCursor={listing.pagination.nextCursor}
          hasMore={listing.pagination.hasMore}
          page={page}
        />
      </div>
    </CalendarShell>
  );
}
