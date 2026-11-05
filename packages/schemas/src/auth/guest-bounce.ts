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
 * Where the document lives: its origin, and the platform's URL resolution
 * against it (`(href) => new URL(href, location.origin).origin` in the
 * browser). Injected because this package stays platform-free — `URL` is a
 * runtime global absent from its lib set (ADR-0002 §3).
 */
export interface GuestBounceBase {
  origin: string;
  originOf(href: string): string;
}

/**
 * The bounce the current document declares, or `null` for a route that renders
 * a guest view. Read at re-check time, so a client navigation that left the
 * bouncing route also left its marker behind.
 *
 * The value is followed with `location.assign`, so only a same-origin
 * absolute-path reference is accepted: a single leading `/` (never `//…`, the
 * protocol-relative form, nor `/\…`, which browsers read the same way), no
 * backslash, space or control character (the URL parser rewrites or strips
 * them, so `/\t/x` would become `//x`), no scheme in its path, and its
 * resolution against `base.origin` must stay on that origin. Anything else is
 * `null` — the caller falls back to the in-place `router.refresh()`, never to
 * a foreign target.
 */
export function declaredGuestBounce(
  root: GuestBounceRoot,
  base: GuestBounceBase,
): string | null {
  const value = root
    .querySelector(`[${GUEST_BOUNCE_ATTRIBUTE}]`)
    ?.getAttribute(GUEST_BOUNCE_ATTRIBUTE);
  return isSameOriginBounce(value, base) ? value : null;
}

function isSameOriginBounce(
  value: string | null | undefined,
  base: GuestBounceBase,
): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === "\\" || code <= 0x20 || code === 0x7f) return false;
  }
  const path = value.split(/[?#]/, 1)[0] ?? "";
  if (path.includes(":")) return false;
  try {
    return base.originOf(value) === base.origin;
  } catch {
    return false;
  }
}
