import { EventPage } from "@ds/event-page/page";

import { ACADEMY_EVENT_PAGE } from "../../../../lib/events-storefront.host-config";

/**
 * 020 EARS-1 / EARS-18 — the Academy event page at `/webinars/:slug`, mounted
 * from `@ds/event-page` with the Academy host config (wave-3 gate §4 PR 3.1).
 *
 * `dynamic` cannot live in the package, so it is declared here: the page
 * reflects a live read model whose lifecycle state can change, so a static
 * prerender would go stale, and the participation answer is per-viewer
 * (`private, no-store`).
 */
export const dynamic = "force-dynamic";

export default async function WebinarEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  return (
    <EventPage
      config={ACADEMY_EVENT_PAGE}
      params={params}
      searchParams={searchParams}
    />
  );
}
