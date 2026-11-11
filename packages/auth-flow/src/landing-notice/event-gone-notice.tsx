import { Alert } from "@ds/design-system/alert";

import { EVENT_GONE_NOTICE_COPY } from "../copy/event-gone-notice";
import type { AuthFlowHostConfig } from "../host-config";
import { ClearNoticeMarker } from "./clear-notice-marker";
import { hasEventGoneNotice } from "./marker";

type RouteSearchParams = Readonly<
  Record<string, string | string[] | undefined>
>;

/** The default landing a route serves — the key of its `landing.eventGoneNotice` sentence. */
export type EventGoneNoticeLanding = "afterLogin" | "specialtyFeed";

/**
 * 021 EARS-10 (amendment 2026-11-11, #2272; owner pick «А») — the ONE
 * one-time notice both storefronts' default landings mount as the first element
 * of their page body: a doctor whose carried эфир no longer exists reads why
 * they landed here instead. The `@ds/design-system` `Alert` (info, a status
 * region), unrestyled; no dismiss, no storage.
 *
 * Rendered on the server from the route's own `searchParams`, so the first
 * byte of HTML already holds the line (no client flash-in); only the exact
 * marker (`notice=event-gone`) renders it, and the marker is then removed from
 * the address bar. The route passes which landing it is; the second sentence
 * is that landing's host-config value (a host without one states only the
 * first).
 */
export function EventGoneNotice({
  config,
  landing,
  searchParams,
}: {
  config: Pick<AuthFlowHostConfig, "landing">;
  landing: EventGoneNoticeLanding;
  searchParams: RouteSearchParams;
}) {
  if (!hasEventGoneNotice(searchParams)) return null;
  const sentences: Readonly<Record<string, string>> =
    config.landing.eventGoneNotice;
  const detail = sentences[landing] ?? sentences.afterLogin;
  return (
    <div className="px-4 pt-6 layout:px-12">
      <div className="mx-auto w-full max-w-content">
        <Alert variant="info" data-testid="event-gone-notice">
          {EVENT_GONE_NOTICE_COPY.lead}
          {detail ? ` ${detail}` : null}
        </Alert>
      </div>
      <ClearNoticeMarker />
    </div>
  );
}

/**
 * The notice bound to one host's landing, for a landing route that mounts
 * another package's page and hands it this component as that page's leading
 * slot (a mounted route passes bare identifiers only — the Academy listing).
 */
export function bindEventGoneNotice(
  config: Pick<AuthFlowHostConfig, "landing">,
  landing: EventGoneNoticeLanding,
) {
  function BoundEventGoneNotice({
    searchParams,
  }: {
    searchParams: RouteSearchParams;
  }) {
    return (
      <EventGoneNotice
        config={config}
        landing={landing}
        searchParams={searchParams}
      />
    );
  }
  return BoundEventGoneNotice;
}
