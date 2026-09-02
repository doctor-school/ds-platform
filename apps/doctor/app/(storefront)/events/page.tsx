import { headers } from "next/headers";
import { EventList } from "@ds/design-system/blocks";
import {
  DOCTOR_EVENTS_FEED_COPY,
  toEventListItems,
} from "@/lib/events-feed-cards";
import { fetchDoctorEventsFeed, showMoreHref } from "@/lib/events-feed";

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
 * Scope: the full canvas composition of this screen — 017's shell breadcrumbs,
 * the facet sidebar, the month grid beside the feed and the «Идёт сейчас» block
 * — belongs to EARS-1 (#1516), EARS-7 (#1523) and EARS-6 (#1521). The route
 * stays `deferred` in `tools/lint/prod-surface-manifest.yaml` until those land.
 */
export default async function DoctorEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const result = await fetchDoctorEventsFeed(await headers(), raw);

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

  return (
    <section
      className="mx-auto w-full max-w-5xl px-4 py-10"
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
            <a
              className="mt-8 inline-flex border-2 border-foreground bg-card px-6 py-3 font-extrabold no-underline outline-none focus-visible:shadow-focus"
              data-testid="events-feed-show-more"
              href={moreHref}
            >
              {DOCTOR_EVENTS_FEED_COPY.showMore}
            </a>
          )
        }
      />
    </section>
  );
}
