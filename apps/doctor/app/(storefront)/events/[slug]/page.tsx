import { EventPage } from "@ds/event-page/page";

import { DOCTOR_EVENT_PAGE } from "../../../../lib/events-storefront.host-config";

/**
 * 020 EARS-1 / EARS-18 — the doctor storefront's event page at `/events/:slug`,
 * mounted from `@ds/event-page` with the doctor host config (wave-3 gate §4
 * PR 3.2).
 *
 * `dynamic` cannot live in the package, so it is declared here: the page
 * reflects a live read model whose lifecycle state can change, so a static
 * prerender would go stale, and the participation answer is per-viewer
 * (`private, no-store`).
 */
export const dynamic = "force-dynamic";

export default async function DoctorEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  return (
    <EventPage
      config={DOCTOR_EVENT_PAGE}
      params={params}
      searchParams={searchParams}
    />
  );
}
