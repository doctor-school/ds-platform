"use client";

import Link from "next/link";
import { DayAgenda } from "@ds/design-system/blocks";
import { Link as DsLink } from "@ds/design-system/link";
import type { MyEventItem } from "@ds/schemas";

import { FEED_COPY } from "../copy/feed-copy";
import type { EventsStorefrontHostConfig } from "../host-config";
import { myEventsCut } from "../model/feed";
import { useViewerZone } from "./use-viewer-zone";

/**
 * The «Мои события» cut above the feed (019 EARS-11 as amended 2026-10-05; gate
 * row 46): the nearest three registered upcoming events as compact rows and
 * «Все мои события →» into the host's «Мои события» page. Absent when empty.
 */
export function MyEventsCut({
  events,
  routes,
}: {
  events: readonly MyEventItem[];
  routes: Pick<
    EventsStorefrontHostConfig["routes"],
    "eventPage" | "accountEvents"
  >;
}) {
  const viewerZone = useViewerZone();
  const rows = myEventsCut(events, { viewerZone, routes, copy: FEED_COPY });
  if (rows.length === 0) return null;
  return (
    <section data-feed-block="my-events" data-testid="events-my-events">
      <DayAgenda title={FEED_COPY.my.title} rows={rows} emptyText="" />
      <div className="mt-4">
        <DsLink asChild className="font-bold">
          <Link href={routes.accountEvents}>{FEED_COPY.my.all}</Link>
        </DsLink>
      </div>
    </section>
  );
}
