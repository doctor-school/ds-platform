/**
 * 003 EARS-73 — the declaration a route core that bounces guests makes for the
 * storefront shell's return re-check (design amendment 2026-11-05).
 *
 * A route that requires sign-in (`/account/**`) redirects a guest on the server
 * to its own guest bounce. When its signed-in render is returned to after the
 * session ended, the shell's re-check must take that SAME bounce as a top-level
 * document navigation — `router.refresh()` would commit the server `redirect()`
 * as an empty page, the flash EARS-74 removes. The route core therefore renders
 * one inert marker carrying the very href its `redirect()` uses, and the shell
 * reads it at re-check time; a route without a marker renders a guest view and
 * is refreshed in place.
 *
 * The contract lives here because the two sides may not import each other
 * (one-code-two-storefronts plan §4 graph): `@ds/storefront-shell` sees only the
 * base packages, and the bouncing cores (`@ds/account`, `@ds/events-storefront`,
 * `@ds/congress-submissions`) never import the shell. Both see `@ds/schemas`.
 */
export const GUEST_BOUNCE_ATTRIBUTE = "data-guest-bounce";

/** The props of the inert marker element (`<span {...guestBounceMarker(href)} />`). */
export function guestBounceMarker(href: string): {
  "data-guest-bounce": string;
  hidden: true;
} {
  return { [GUEST_BOUNCE_ATTRIBUTE]: href, hidden: true };
}

/** The slice of a DOM `ParentNode` the read needs (this package builds without the DOM lib). */
export interface GuestBounceRoot {
  querySelector(
    selectors: string,
  ): { getAttribute(name: string): string | null } | null;
}

/**
 * The bounce the current document declares, or `null` for a route that renders
 * a guest view. Read at re-check time, so a client navigation that left the
 * bouncing route also left its marker behind.
 */
export function declaredGuestBounce(root: GuestBounceRoot): string | null {
  return (
    root
      .querySelector(`[${GUEST_BOUNCE_ATTRIBUTE}]`)
      ?.getAttribute(GUEST_BOUNCE_ATTRIBUTE) ?? null
  );
}
