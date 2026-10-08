import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { Link as DsLink } from "@ds/design-system/link";
import { MONTH_PARAM } from "@ds/schemas";

import { FEED_COPY } from "../copy/feed-copy";
import type { EventsStorefrontHostConfig } from "../host-config";
import { canonicalFeedRedirect } from "../model/feed-url";
import {
  buildListingHref,
  type ListingQueryInput,
} from "../model/listing-href";
import { EventsFeedView } from "./events-feed-view";
import { MonthCalendarView } from "./month-calendar-view";

/**
 * The events listing page a host route file mounts with its host config
 * (wave-2 entry gate §2.2 row 16, §2.4). The default render is the one feed
 * view of both storefronts (`EventsFeedView`, the #2076 canvas); `?view=month`
 * renders the month pane until PR 2.5 replaces it with the same-page month view
 * (row 51). A legacy Academy URL (`tab`, `cursor`, `cursorTrail`, `page`)
 * answers a permanent redirect to its canonical feed URL (§4.3 D1); `view` and
 * `month` pass through it unchanged.
 *
 * Both views read an uncached lifecycle-sensitive projection, so the mounting
 * route declares `dynamic = "force-dynamic"` (segment config cannot live here).
 */
export async function EventsListingPage({
  config,
  searchParams,
}: {
  config: EventsStorefrontHostConfig;
  searchParams: Promise<ListingQueryInput>;
}) {
  const params = await searchParams;
  const canonical = canonicalFeedRedirect(config.routes.listing, params);
  if (canonical !== null) permanentRedirect(canonical);

  const value = (key: string) => {
    const found = params[key];
    return Array.isArray(found) ? found[0] : found;
  };
  if (value("view") === "month") {
    // Validate `month` at the boundary (EARS-17): an absent/malformed value
    // falls back to the current МСК month, so the page never emits a malformed
    // API param.
    const month = value("month");
    return (
      <MonthCalendarView
        config={config}
        month={month && MONTH_PARAM.test(month) ? month : undefined}
        queryParams={params}
      />
    );
  }
  return (
    <EventsFeedView
      config={config}
      query={params}
      headAction={
        <DsLink asChild tone="on-primary">
          <Link
            data-testid="events-month-view-link"
            href={buildListingHref(config.routes.listing, params, {
              view: "month",
            })}
          >
            {FEED_COPY.monthView}
          </Link>
        </DsLink>
      }
    />
  );
}
