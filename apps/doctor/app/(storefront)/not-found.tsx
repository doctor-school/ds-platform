import type { Metadata } from "next";

import { NOT_FOUND_PAGE_METADATA, StorefrontNotFound } from "@ds/storefront-shell/not-found";

export const metadata: Metadata = {
  title: NOT_FOUND_PAGE_METADATA.title,
  robots: NOT_FOUND_PAGE_METADATA.robots,
};

/**
 * #2478 — the not-found page for a route's own `notFound()` inside the
 * `(storefront)` group (an unknown event slug, …): it renders inside the
 * group layout, which already draws the storefront frame, so it mounts the
 * not-found state alone. An address no route matches never reaches this
 * group; the root `app/not-found.tsx` mounts the frame for it.
 */
export default function StorefrontGroupNotFound() {
  return <StorefrontNotFound />;
}
