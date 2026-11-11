import type { ReactNode } from "react";
import { Alert } from "@ds/design-system/alert";

import { EVENT_GONE_NOTICE_COPY } from "../copy/event-gone-notice";
import type { AuthFlowHostConfig } from "../host-config";
import { ClearNoticeMarker } from "./clear-notice-marker";
import { hasEventGoneNotice } from "./marker";

type RouteSearchParams = Readonly<
  Record<string, string | string[] | undefined>
>;

/** The default landing a route serves — the key of its `landing.eventGoneNotice` sentence. */
export type EventGoneNoticeLanding =
  "afterLogin" | "specialtyFeed" | "eventsFeed";

/**
 * 021 EARS-10 (amendment 2026-11-11, #2272; owner pick «А») — the ONE
 * one-time notice both storefronts' default landings mount as the first element
 * of their content column, below the hero band: a doctor whose carried эфир no
 * longer exists reads why they landed here instead. The `@ds/design-system`
 * `Alert` (info, a status region), unrestyled; no dismiss, no storage.
 *
 * It has no container, width or spacing of its own: the landing frames it with
 * the column container its first block uses (`frame`), so its edges are that
 * column's edges; it never stands between the site header and a full-bleed
 * coloured band (a white strip there splits the one blue top the canvas draws).
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
  frame,
}: {
  config: Pick<AuthFlowHostConfig, "landing">;
  landing: EventGoneNoticeLanding;
  searchParams: RouteSearchParams;
  /**
   * The landing's column container around the notice, rendered only with it —
   * so a landing without the marker gains no empty row, margin or padding.
   * Omitted where the slot already sits inside the column (the Academy listing).
   */
  frame?: (notice: ReactNode) => ReactNode;
}) {
  if (!hasEventGoneNotice(searchParams)) return null;
  const sentences: Readonly<Record<string, string>> =
    config.landing.eventGoneNotice;
  const detail = sentences[landing] ?? sentences.afterLogin;
  const notice = (
    <Alert variant="info" data-testid="event-gone-notice">
      {EVENT_GONE_NOTICE_COPY.lead}
      {detail ? ` ${detail}` : null}
    </Alert>
  );
  return (
    <>
      {frame ? frame(notice) : notice}
      <ClearNoticeMarker />
    </>
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
