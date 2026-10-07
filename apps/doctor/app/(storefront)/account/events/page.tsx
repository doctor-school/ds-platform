import type { Metadata } from "next";

import { MyEventsRoute } from "@ds/events-storefront/my-events";

import { DOCTOR_EVENTS_STOREFRONT } from "../../../../lib/events-storefront.host-config";

/**
 * 005 EARS-6 + 014 EARS-9 — `doctor.school/account/events`, «Мои события»: the
 * route-file mount of the shared `@ds/events-storefront` page inside the
 * storefront shell (wave-2 entry gate §2.3 rows 24–27, #1972). The package route
 * reads the viewer's events from this host's endpoint and sends a guest to this
 * host's door carrying this page.
 *
 * `dynamic` cannot live in the package: a per-user read whose lifecycle state
 * can change. Registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * with the rest of the doctor storefront, which opens with #1430.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Мои события — Doctor.School",
  description:
    "Эфиры, на которые вы записаны, и записи прошедших эфиров со статусом записи.",
};

export default async function DoctorMyEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <MyEventsRoute
      config={DOCTOR_EVENTS_STOREFRONT}
      searchParams={searchParams}
    />
  );
}
