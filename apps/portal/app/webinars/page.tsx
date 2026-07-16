import { MONTH_PARAM } from "@ds/schemas";
import DiscoveryListing from "@/components/discovery-listing";
import { MonthCalendarView } from "@/components/month-calendar-view";

/**
 * 004 EARS-7 / EARS-19 — the public listing at `/webinars`. The default («Неделя»)
 * render is the shared day-grouped `DiscoveryListing` (#982, also the `/`
 * front-door); `?view=month` renders the wave-2 month-calendar pane (design §5.4).
 * The view is presentation state carried in the query param — public, no auth, no
 * mutation, loss-free switching. Only `/webinars` opts into the month pane; the
 * `/` front-door stays the week listing.
 *
 * `dynamic` cannot live on the shared components, so it is re-declared here: both
 * panes read an uncached lifecycle-sensitive projection, so a static prerender
 * would go stale.
 */
export const dynamic = "force-dynamic";

export default async function WebinarsListingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string }>;
}) {
  const { view, month } = await searchParams;
  // Validate `month` at the boundary (EARS-17): an absent/malformed value falls
  // back to the current МСК month, so the page never emits a malformed API param.
  const selectedMonth =
    month && MONTH_PARAM.test(month) ? month : undefined;

  if (view === "month") {
    return <MonthCalendarView month={selectedMonth} />;
  }
  // Week pane: carry the month so the «Месяц» switcher restores it (loss-free
  // round-trip, EARS-18).
  return (
    <DiscoveryListing
      monthViewHref={
        selectedMonth
          ? `/webinars?view=month&month=${selectedMonth}`
          : "/webinars?view=month"
      }
    />
  );
}
