import { headers } from "next/headers";
import { EventsFeedView } from "@ds/events-storefront/feed";
import type { RawQueryRecord } from "@ds/schemas";
import { toDoctorEventsMonthPane } from "@/lib/events-month-grid";
import {
  type DoctorEventsMonthResult,
  fetchDoctorEventsMonthGrid,
} from "@/lib/events-month";
import { DOCTOR_EVENTS_STOREFRONT } from "@/lib/events-storefront.host-config";
import { DoctorEventsDayAnchorScroll } from "./day-anchor-scroll";
import { DoctorEventsMonthPaneView } from "./month-pane";

/**
 * 019 EARS-4 (#1519) — the doctor's month band beside the feed, until PR 2.5
 * replaces it with the package's same-page month view (gate §4.1). The month
 * read is non-fatal: an unavailable month drops the navigation band, never the
 * feed. The band's day links widen the horizon against the SERVED window, so it
 * is handed the feed read's own `from`/`to` (EARS-4 + LD-2); selecting a day
 * scrolls the feed to that day's group (`DoctorEventsDayAnchorScroll`). The
 * band shows at the desktop breakpoint only.
 */
async function DoctorEventsMonthBand({
  month,
  raw,
  horizon,
}: {
  month: Promise<DoctorEventsMonthResult>;
  raw: RawQueryRecord;
  horizon: { from: string; to: string };
}) {
  const result = await month;
  const pane = result.ok
    ? toDoctorEventsMonthPane(result.grid, raw, horizon)
    : null;
  return (
    <>
      {pane === null ? null : (
        <div className="hidden lg:block">
          <DoctorEventsMonthPaneView pane={pane} />
        </div>
      )}
      <DoctorEventsDayAnchorScroll day={pane?.selectedDate ?? null} />
    </>
  );
}

/**
 * 019 EARS-3 — `doctor.school/events`, the shared events feed of both
 * storefronts (`@ds/events-storefront/feed`, wave-2 entry gate §2.4) mounted
 * with the doctor host config. Every block, rule and sentence of the feed lives
 * in the package; this route adds only the month band it keeps until PR 2.5.
 */
export default async function DoctorEventsPage({
  searchParams,
}: {
  searchParams: Promise<RawQueryRecord>;
}) {
  const raw = await searchParams;
  // Issued beside the feed read, never after it: the band must never make the
  // feed wait.
  const month = fetchDoctorEventsMonthGrid(await headers(), raw);
  return (
    <EventsFeedView
      config={DOCTOR_EVENTS_STOREFRONT}
      query={raw}
      monthNav={(horizon) => (
        <DoctorEventsMonthBand month={month} raw={raw} horizon={horizon} />
      )}
    />
  );
}
