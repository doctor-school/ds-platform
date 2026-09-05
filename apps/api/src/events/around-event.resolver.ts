import type { AroundEvent, HostFreeEventPageView } from "@ds/schemas";

/**
 * 020 EARS-2 (#1765) — the ONE «вокруг события» link policy.
 *
 * It is the exact sibling of `participation-cta.resolver.ts` and exists for the
 * same reason: WHERE a reader can go from an event page is a decision, and a
 * decision made twice is a decision the two storefronts can disagree about. So
 * the policy lives here once, pure, and each host contributes only its own
 * route table.
 *
 * The rule the whole module encodes is one line long: a route that does not
 * exist yields NO KEY. Never a `null` href, never an empty string, never a
 * disabled control — 020 EARS-2 and EARS-19 both require an impossible
 * destination to be ABSENT rather than dead, and a body that carried `href:
 * null` would push that judgement onto every client instead of settling it at
 * the source.
 *
 * It is a pure function of the event facts plus the host's table: no database,
 * no clock, no viewer. That last one matters — the public page body is
 * `public, max-age=30` and byte-identical for a guest and a signed-in
 * principal (004 EARS-1), which holds precisely because links depend on the
 * HOST that served the request and never on who asked.
 */

/**
 * The host-owned paths this policy turns into links. Each returns `null` when
 * the host mounts no such route, and `null` means the key is dropped.
 */
export interface AroundEventRoutes {
  /** The event's school page on this host, or `null` while none is mounted. */
  schoolPath: (school: string) => string | null;
  /**
   * The public page of ONE speaker, or `null`. It is handed the whole speaker
   * so a host may key on the stable `expertSlug`; a `legacy` speaker carries no
   * identity at all and is never offered here.
   */
  expertPath: (speaker: { slug: string; name: string }) => string | null;
  /** The event's community destination on this host, or `null`. */
  communityPath: (event: HostFreeEventPageView) => string | null;
}

/**
 * Resolve the {@link AroundEvent} link set for one event on one host.
 *
 * Every speaker of the 012 EARS-8 projection is an `expert` since the EARS-24
 * cutover (#1607), so each one carries the stable slug a page route is built
 * from. Names are never compared (012-design §5.2).
 */
export function resolveAroundEvent(
  view: HostFreeEventPageView,
  routes: AroundEventRoutes,
): AroundEvent {
  const links: AroundEvent = { speakerPages: [] };

  const schoolHref = routes.schoolPath(view.school);
  if (schoolHref) links.school = { label: view.school, href: schoolHref };

  for (const speaker of view.speakers) {
    const href = routes.expertPath({
      slug: speaker.expertSlug,
      name: speaker.name,
    });
    if (href) links.speakerPages.push({ speakerKey: speaker.expertSlug, href });
  }

  const communityHref = routes.communityPath(view);
  if (communityHref) links.communityHref = communityHref;

  return links;
}
