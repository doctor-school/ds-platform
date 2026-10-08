"use client";

import { useCallback, useEffect, useState } from "react";
import { Link as DsLink } from "@ds/design-system/link";
import { LiveEventStrip } from "@ds/design-system/blocks";
import {
  EVENTS_LIVE_REFRESH_SECONDS,
  type EventLiveStrip,
  EventsLiveReadSchema,
  formatEventTime,
} from "@ds/schemas";

import { FEED_COPY } from "../copy/feed-copy";
import type { EventsStorefrontHostConfig } from "../host-config";
import { type BlockRead, liveStripView } from "../model/feed";
import { BlockError } from "./block-error";
import { useViewerZone } from "./use-viewer-zone";

/**
 * «Идёт сейчас» above the feed (019 EARS-6, LD-6; gate rows 43–45). The server
 * read paints first; the block then re-reads the SAME path on a bounded interval
 * and when the tab becomes visible, so it clears itself when the эфир ends. It
 * never derives liveness, never clears on a failed poll (the last answer stays),
 * and renders nothing when nothing is live.
 */
export function LiveBlock({
  initial,
  livePath,
  routes,
}: {
  initial: BlockRead<EventLiveStrip[]>;
  livePath: string;
  routes: Pick<EventsStorefrontHostConfig["routes"], "eventPage">;
}) {
  const [read, setRead] = useState(initial);
  const viewerZone = useViewerZone();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(livePath, {
        credentials: "include",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return;
      const value = EventsLiveReadSchema.parse(await res.json());
      setRead({ ok: true, value });
    } catch {
      // Keep the last answer: a timed-out request did not end the эфир.
    }
  }, [livePath]);

  useEffect(() => {
    const timer = window.setInterval(
      () => void refresh(),
      EVENTS_LIVE_REFRESH_SECONDS * 1000,
    );
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  if (!read.ok) {
    return (
      <BlockError
        title={FEED_COPY.live.errorTitle}
        description={FEED_COPY.live.errorBody}
        testId="events-live-error"
        onRetry={() => void refresh()}
      />
    );
  }
  if (read.value.length === 0) return null;

  const view = liveStripView(read.value, {
    viewerZone,
    routes,
    copy: FEED_COPY,
  });
  const today = formatEventTime({ startsAt: new Date(), viewerZone }).groupDay;
  return (
    <section
      className="flex flex-col gap-4"
      data-feed-block="live"
      data-refresh-seconds={EVENTS_LIVE_REFRESH_SECONDS}
      data-testid="events-live-block"
    >
      {view.strips.map(({ key, ...strip }) => (
        <LiveEventStrip key={key} {...strip} />
      ))}
      {view.moreLabel ? (
        <div>
          <DsLink className="font-bold" href={`#day-${today}`}>
            {view.moreLabel}
          </DsLink>
        </div>
      ) : null}
    </section>
  );
}
