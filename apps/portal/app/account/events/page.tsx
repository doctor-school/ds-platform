import { MyEventsRoute } from "@ds/events-storefront/my-events";

import { ACADEMY_EVENTS_STOREFRONT } from "../../../lib/events-storefront.host-config";

/**
 * 005 EARS-6 + 014 EARS-9 — «Мои события» at `/account/events`, mounted from
 * `@ds/events-storefront` with the Academy host config (wave-2 entry gate §2.3
 * rows 24–26). The package route reads the viewer's events and sends a guest to
 * the door carrying this page.
 *
 * `dynamic` cannot live in the package: a per-user read whose lifecycle state
 * can change, so a static prerender would go stale (EARS-7).
 */
export const dynamic = "force-dynamic";

export default async function AcademyMyEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <MyEventsRoute
      config={ACADEMY_EVENTS_STOREFRONT}
      searchParams={searchParams}
    />
  );
}
