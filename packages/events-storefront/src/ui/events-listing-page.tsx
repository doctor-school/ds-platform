import { MONTH_PARAM } from "@ds/schemas";
import type { EventsStorefrontHostConfig } from "../host-config";
import {
  buildListingHref,
  type ListingQueryInput,
} from "../model/listing-href";
import { DiscoveryListing } from "./discovery-listing";
import { MonthCalendarView } from "./month-calendar-view";

/**
 * 004 EARS-7 / EARS-19 — the events listing page a host route file mounts with
 * its host config (wave-2 entry gate §2.2 row 16). The default («Неделя») render
 * is the day-grouped `DiscoveryListing`; `?view=month` renders the month pane
 * (design §5.4). The view is presentation state carried in the query param —
 * public, no auth, no mutation, loss-free switching. PR 2.5 replaces the `view`
 * switch with the same-page month view (row 51).
 *
 * Both panes read an uncached lifecycle-sensitive projection, so the mounting
 * route declares `dynamic = "force-dynamic"` (segment config cannot live here).
 */
export async function EventsListingPage({
  config,
  searchParams,
}: {
  config: EventsStorefrontHostConfig;
  searchParams: Promise<ListingQueryInput>;
}) {
  const params = await searchParams;
  const value = (key: string) => {
    const found = params[key];
    return Array.isArray(found) ? found[0] : found;
  };
  const view = value("view");
  const month = value("month");
  const tab = value("tab") === "past" ? "past" : "upcoming";
  const cursor = value("cursor");
  const rawPage = Number(value("page") ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  // Validate `month` at the boundary (EARS-17): an absent/malformed value falls
  // back to the current МСК month, so the page never emits a malformed API param.
  const selectedMonth = month && MONTH_PARAM.test(month) ? month : undefined;

  if (view === "month") {
    return (
      <MonthCalendarView
        config={config}
        month={selectedMonth}
        queryParams={params}
      />
    );
  }
  // Week pane: carry the month so the «Месяц» switcher restores it (loss-free
  // round-trip, EARS-18).
  return (
    <DiscoveryListing
      config={config}
      monthViewHref={buildListingHref(config.routes.listing, params, {
        view: "month",
        month: selectedMonth ?? null,
      })}
      weekViewHref={buildListingHref(config.routes.listing, params, {
        view: "week",
        month: selectedMonth ?? null,
      })}
      timeframe={tab}
      cursor={cursor}
      page={page}
      queryParams={params}
    />
  );
}
