import type { EventsFilterHost } from "@ds/design-system/blocks";

import type { PluralNoun } from "./model/event-count";
import type { EventsStorefrontAdapter } from "./model/feed";

/**
 * What a storefront states about itself so the shared events listing can serve
 * it (wave-2 entry gate §4.4, ADR-0013 A1). DATA only — routes and copy; no
 * lifecycle callback, resolver or predicate (plan §2 L39). A host's
 * `*.host-config.ts` is checked against this type with `satisfies`.
 *
 * The fields are the §4.4 draft's: the one page reads its feed, month and
 * per-month counts from `contentSet`, renders the facet set `filterSet` names,
 * and states its copy from the package defaults plus `headerCopy` / `copy`.
 */
export type EventsStorefrontHostConfig = {
  /** The host's content set — the endpoints its reads call (019 `contentSet`). */
  contentSet: {
    /** The feed read (gate row 12). */
    feedPath: string;
    /** One month's entries — the month grid's pills (row 14): `?month=YYYY-MM` + the facets. */
    monthPath: string;
    /** The per-month counts of the picker (row 54): `?year=YYYY` + the facets. */
    countsPath: string;
    /**
     * The name the feed read takes the tense under: the codec's `tense` on the
     * doctor read, `timeframe` on the Academy listing read (gate row 32, D2).
     */
    tenseParam: "tense" | "timeframe";
    /** The one cookie the feed read forwards (row 13); unset = no cookie header. */
    relayCookie?: string;
    /** The «Идёт сейчас» read, same-origin path the browser re-reads too (row 43, D5). */
    livePath: string;
    /** The viewer's «Мои события» read (gate row 15, §4.3 D8). */
    myEventsPath: string;
    /** The one adapter of §4.5: the feed read's DTO → the feed page model. */
    adapt: EventsStorefrontAdapter;
  };
  /** The facet set the panel renders — the design-system `EventsFilter` `host` (row 58, #2578). */
  filterSet: EventsFilterHost;
  /**
   * The page head (gate row 19, 019 `headerCopy`). The subline is either fixed
   * copy, or the counted form «N <eventNoun> · M <schoolNoun>» over the read's
   * upcoming events and their distinct schools — the host states the nouns only.
   */
  headerCopy: {
    title: string;
    subline: string | { schoolNoun: PluralNoun };
  };
  /** Deep-partial copy overrides (gate row 5). */
  copy?: {
    /** The event noun of every count; «событие» by default. */
    eventNoun?: PluralNoun;
  };
  /** Route table. */
  routes: {
    /** The listing route — the base of every week/month listing href (row 17). */
    listing: string;
    /** The event page base: an event's page is `${eventPage}/${slug}`. */
    eventPage: string;
    /** The door a guest is sent to, carrying the return target (row 24). */
    login: string;
    /** The «Мои события» page — the guest's return target and the tab base (row 24). */
    accountEvents: string;
  };
};

/**
 * The part of the host config the «Мои события» page reads (gate rows 24–27): a
 * host that mounts only that page states only these fields; the page head and
 * the copy overrides belong to the listing.
 */
export type MyEventsHostConfig = {
  contentSet: Pick<EventsStorefrontHostConfig["contentSet"], "myEventsPath">;
  routes: EventsStorefrontHostConfig["routes"];
};

/** An event's page on the host. */
export function eventPageHref(
  config: { routes: Pick<EventsStorefrontHostConfig["routes"], "eventPage"> },
  slug: string,
): string {
  return `${config.routes.eventPage}/${slug}`;
}
