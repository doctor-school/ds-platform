import { headers } from "next/headers";
import { Button } from "@ds/design-system/button";
import { EventList } from "@ds/design-system/blocks";
import {
  DOCTOR_EVENTS_FEED_COPY,
  toEventListItems,
} from "@/lib/events-feed-cards";
import { fetchDoctorEventsFeed, showMoreHref } from "@/lib/events-feed";
import { toDoctorEventsMonthPane } from "@/lib/events-month-grid";
import { fetchDoctorEventsMonthGrid } from "@/lib/events-month";
import { DoctorEventsMonthPaneView } from "./month-pane";

/**
 * 019 EARS-3 (#1518) — `doctor.school/events`, the day-grouped, specialty-
 * targeted feed.
 *
 * This route is deliberately THIN. It reads the feed on the server (forwarding
 * the cookie so 017's remembered specialty reaches the targeting resolver),
 * projects the payload onto the shared `EventList` item shape, and renders that
 * unit. Grouping, card anatomy and every card state live in
 * `@ds/design-system`; targeting, the horizon and the ordering live behind
 * `GET /v1/storefront/doctor/events`. Nothing between the two is re-implemented
 * here (EARS-15).
 *
 * Release 1 reads the «Будущие» tense ONLY (LD-10) — hence
 * `tenseControl="none"`: the shared unit drops its tense row rather than the
 * route re-assembling a day-grouped list without one. `paginationMode="none"`
 * for the same reason: the horizon is bounded by the URL and «показать ещё» is
 * a LINK that widens `to=`, so the extended range is shareable and the back
 * button walks the feed's own states (EARS-8, LD-2).
 *
 * 019 EARS-4 (#1519) adds the SECOND half of F-019-2 Б: the month calendar
 * stands BESIDE the day feed at the desktop breakpoint, acting as navigation
 * over the SAME targeted read. The two reads are issued in parallel and decode
 * their facets with one codec, so the grid's day counts are the feed's own
 * day-group sizes. No «Неделя / Месяц» switch is rendered — under Б there is no
 * one-view-at-a-time control to build. The month read is deliberately
 * non-fatal: an unavailable month drops the navigation pane, never the body.
 *
 * Scope: the rest of the canvas composition of this screen — 017's shell
 * breadcrumbs, the facet sidebar and the «Идёт сейчас» block — belongs to
 * EARS-1 (#1516), EARS-7 (#1523) and EARS-6 (#1521). The route stays `deferred`
 * in `tools/lint/prod-surface-manifest.yaml` until those land.
 */
export default async function DoctorEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const requestHeaders = await headers();
  // One round trip, not two: the calendar is navigation over the same read and
  // must never make the body wait on it.
  const [result, month] = await Promise.all([
    fetchDoctorEventsFeed(requestHeaders, raw),
    fetchDoctorEventsMonthGrid(requestHeaders, raw),
  ]);

  if (!result.ok) {
    return (
      <section className="mx-auto w-full max-w-5xl px-4 py-10">
        <h1 className="text-heading font-extrabold">
          {DOCTOR_EVENTS_FEED_COPY.title}
        </h1>
        <p className="mt-6 border-2 border-border bg-card p-4">
          {DOCTOR_EVENTS_FEED_COPY.errorTitle}.{" "}
          {DOCTOR_EVENTS_FEED_COPY.errorDescription}
        </p>
      </section>
    );
  }

  const { feed } = result;
  const moreHref = showMoreHref(raw, feed);
  const pane = month.ok ? toDoctorEventsMonthPane(month.grid, raw) : null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 lg:flex lg:items-start lg:gap-8">
    <section
      className="w-full min-w-0 lg:flex-1"
      data-events-feed=""
      data-feed-from={feed.from}
      data-feed-to={feed.to}
    >
      <h1 className="text-heading font-extrabold">
        {DOCTOR_EVENTS_FEED_COPY.title}
      </h1>
      <EventList
        items={toEventListItems(feed)}
        selectedTab="upcoming"
        tenseControl="none"
        paginationMode="none"
        labels={{
          emptyTitle: DOCTOR_EVENTS_FEED_COPY.emptyTitle,
          emptyDescription: DOCTOR_EVENTS_FEED_COPY.emptyDescription,
        }}
        footer={
          moreHref === null ? null : (
            // The forward affordance is a design-system primitive wrapping the
            // LINK (`asChild`), never a hand-assembled anchor: the offset cast,
            // the hover-translate, the press-flatten and the focus ring all come
            // from `Button`'s `outline` variant (AGENTS.md section 6).
            <Button
              asChild
              className="mt-8 no-underline"
              size="lg"
              variant="outline"
            >
              <a data-testid="events-feed-show-more" href={moreHref}>
                {DOCTOR_EVENTS_FEED_COPY.showMore}
              </a>
            </Button>
          )
        }
      />
    </section>

      {/* EARS-4: the calendar appears at the DESKTOP breakpoint only — below it
          the day feed is the whole surface and the month grid would be a second
          scroll target rather than navigation. `sticky` keeps it in view while
          the feed body scrolls, which is the entire point of «shown at once». */}
      {pane === null ? null : (
        <aside className="hidden lg:sticky lg:top-8 lg:block lg:w-80 lg:shrink-0">
          <DoctorEventsMonthPaneView pane={pane} />
        </aside>
      )}
    </div>
  );
}
