import type { PluralNoun } from "./model/event-count";

/**
 * What a storefront states about itself so the shared events listing can serve
 * it (wave-2 entry gate §4.4, ADR-0013 A1). DATA only — routes and copy; no
 * lifecycle callback, resolver or predicate (plan §2 L39). A host's
 * `*.host-config.ts` is checked against this type with `satisfies`.
 *
 * The fields are the ones whose consumers are in the package today; the rest of
 * the §4.4 draft (the listing reads of `contentSet`, `filterSet`) lands with the
 * PR that mounts its consumer.
 */
export type EventsStorefrontHostConfig = {
  /** The host's content set — the endpoints its reads call (019 `contentSet`). */
  contentSet: {
    /** The viewer's «Мои события» read (gate row 15, §4.3 D8). */
    myEventsPath: string;
  };
  /** The page head (gate row 19, 019 `headerCopy`). */
  headerCopy: { title: string; subline: string };
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
export type MyEventsHostConfig = Pick<
  EventsStorefrontHostConfig,
  "contentSet" | "routes"
>;

/** An event's page on the host. */
export function eventPageHref(
  config: { routes: Pick<EventsStorefrontHostConfig["routes"], "eventPage"> },
  slug: string,
): string {
  return `${config.routes.eventPage}/${slug}`;
}
