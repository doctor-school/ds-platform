import { Suspense } from "react";
import { headers } from "next/headers";
import { forwardedSessionFrom } from "@ds/schemas";

import type { EventsStorefrontHostConfig } from "../host-config";
import type { SpecialtyChoice } from "../model/facets";
import {
  fetchEventsFeed,
  fetchSpecialtyChoices,
  readRequestFrom,
} from "../server";
import type { EventsBlockRetryAction } from "./events-block-retry";
import { FeedSection, FeedSkeleton, readMyEvents } from "./feed-sections";

/**
 * The events page's day feed block (019 EARS-3/EARS-9) mounted outside the
 * events page — a home's nearest events (017 EARS-9, #1485): the same upcoming
 * feed read with no facet (the host's relayed cookie makes it general before a
 * specialty choice and targeted after it), the same registered marks, empty
 * state, «Повторить» and skeleton, capped to `limit` cards with one «Все
 * события» link to the full listing. The host passes its events page's own
 * block-retry action; a failed block's retry stays capped.
 */
export async function EventsFeed({
  config,
  limit,
  retry,
}: {
  config: EventsStorefrontHostConfig;
  limit: number;
  retry: EventsBlockRetryAction;
}) {
  const requestHeaders = await headers();
  const request = readRequestFrom(requestHeaders);
  const feed = fetchEventsFeed(config, {}, request);
  const mine = readMyEvents(
    config.contentSet.myEventsPath,
    forwardedSessionFrom(requestHeaders),
  );
  const specialties: Promise<SpecialtyChoice[]> =
    config.filterSet === "doctor"
      ? fetchSpecialtyChoices()
      : Promise.resolve([]);
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <FeedSection
        config={config}
        query={{}}
        feed={feed}
        mine={mine}
        specialties={specialties}
        kinds={Promise.resolve([])}
        request={request}
        retry={retry}
        limit={limit}
      />
    </Suspense>
  );
}

/** 018 EARS-4 — the specialty feed's nearest-events block (same subpath). */
export { SpecialtyEventsBlock } from "./specialty-events";
