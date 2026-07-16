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
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  return view === "month" ? <MonthCalendarView /> : <DiscoveryListing />;
}
