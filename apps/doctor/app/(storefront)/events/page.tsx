import { EventsListingPage } from "@ds/events-storefront/listing";

import { DOCTOR_EVENTS_STOREFRONT } from "../../../lib/events-storefront.host-config";

/**
 * 019 EARS-3 — `doctor.school/events`, the one events page of both
 * storefronts (`@ds/events-storefront`, wave-2 entry gate §2.5) mounted with
 * the doctor host config only: the feed, the month view, the column and the
 * facet panel all live in the package.
 *
 * `dynamic` cannot live in the package: every read is uncached and
 * lifecycle-sensitive, so a static prerender would go stale.
 */
export const dynamic = "force-dynamic";

export default async function DoctorEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <EventsListingPage
      config={DOCTOR_EVENTS_STOREFRONT}
      searchParams={searchParams}
    />
  );
}
