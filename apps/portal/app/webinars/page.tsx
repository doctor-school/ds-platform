import { EventsListingPage } from "@ds/events-storefront/listing";

import { ACADEMY_EVENTS_STOREFRONT } from "../../lib/events-storefront.host-config";

/**
 * 004 EARS-7 / EARS-19 — the public listing at `/webinars`, mounted from
 * `@ds/events-storefront` with the Academy host config (gate §2.2 row 16).
 *
 * `dynamic` cannot live in the package, so it is declared here: both panes read
 * an uncached lifecycle-sensitive projection, so a static prerender would go
 * stale.
 */
export const dynamic = "force-dynamic";

export default async function WebinarsListingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <EventsListingPage
      config={ACADEMY_EVENTS_STOREFRONT}
      searchParams={searchParams}
    />
  );
}
