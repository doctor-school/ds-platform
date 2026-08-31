import type { ReactNode } from "react";

/**
 * The doctor storefront's CHROMELESS auth route group.
 *
 * `(auth)` is a route group, so it adds no URL segment — `/register` stays
 * `/register`. What it changes is which layout wraps the route: a route group is
 * a sibling of `(storefront)`, not a child, so nothing under here inherits the
 * 017 shell layout (`app/(storefront)/layout.tsx`) and its header / navigation /
 * footer. That is the whole point of the group.
 *
 * WHY the auth surfaces sit outside the shell. `design-source/auth.dc.html`
 * draws every auth artboard (`#d-register` included) as a full-viewport frame
 * with no site chrome, and the product reason is the one the storefront's own
 * nav would violate: the door is a single-CTA surface, and a header full of
 * onward links leads the doctor away from the form they came to fill. The
 * Academy (`apps/portal`) already renders its auth surfaces this way; this group
 * is the storefront's half of the same rule. The frame itself — wordmark, brand
 * panel, vertically centred card — is `components/auth-shell.tsx`.
 *
 * The layout adds no element of its own: the root layout (`app/layout.tsx`) owns
 * `<html>`/`<body>` and the pre-paint theme guard, and the frame is the page's
 * to compose, so a wrapper here would be a third nesting level that paints
 * nothing. It exists to make the chromeless contract explicit at the group
 * boundary and to be the anchor for the auth routes that follow (login, verify,
 * reset), which must not drift back under the shell.
 *
 * No `headers()` read, unlike the shell layout: nothing on an auth screen is
 * per-visitor, so these routes stay statically renderable.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
