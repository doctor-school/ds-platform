import type { EventsStorefrontHostConfig } from "@ds/events-storefront/host-config";

/**
 * What a storefront states about itself so the ONE event page can serve it
 * (wave-3 entry gate §4.4, ADR-0013 A1). DATA only — a read path, routes and
 * one copy word; no callback, resolver or predicate (plan §2, closed adapter
 * list §4.5 = empty). Each host declares its values as a second export of its
 * `lib/events-storefront.host-config.ts`, checked with `satisfies`.
 */
export type EventPageHostConfig = {
  contentSet: Pick<EventsStorefrontHostConfig["contentSet"], "relayCookie"> & {
    /**
     * The event-page read path (gate rows 1, 4): the page reads
     * `${pagePath}/:slug`, participation is `${pagePath}/:slug/participation`.
     */
    pagePath: string;
  };
  routes: Pick<
    EventsStorefrontHostConfig["routes"],
    "listing" | "eventPage" | "login"
  > & {
    /** The recording gate's sign-up door (gate row 24). */
    register: string;
  };
  /** The one word the page varies by host — the breadcrumb (gate row 7). */
  copy: { breadcrumb: string };
};
