import type { PluralNoun } from "./model/event-count";

/**
 * What a storefront states about itself so the shared events listing can serve
 * it (wave-2 entry gate §4.4, ADR-0013 A1). DATA only — routes and copy; no
 * lifecycle callback, resolver or predicate (plan §2 L39). A host's
 * `*.host-config.ts` is checked against this type with `satisfies`.
 *
 * The fields are the ones whose consumers are in the package today; the rest of
 * the §4.4 draft (`contentSet`, `filterSet`, `routes.login`,
 * `routes.accountEvents`) lands with the PR that mounts its consumer.
 */
export type EventsStorefrontHostConfig = {
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
  };
};

/** An event's page on the host. */
export function eventPageHref(
  config: Pick<EventsStorefrontHostConfig, "routes">,
  slug: string,
): string {
  return `${config.routes.eventPage}/${slug}`;
}
