import { EventsListingPage } from "@ds/events-storefront/listing";

import { ACADEMY_EVENTS_STOREFRONT } from "../../lib/events-storefront.host-config";
import { retryAcademyEventsBlock } from "./retry-block-action";

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
      retry={retryAcademyEventsBlock}
    >
      <p>Академия: только для врачей</p>
    </EventsListingPage>
  );
}
