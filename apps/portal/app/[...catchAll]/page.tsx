import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NOT_FOUND_PAGE_METADATA } from "@ds/storefront-shell/not-found";

export const metadata: Metadata = {
  title: NOT_FOUND_PAGE_METADATA.title,
  robots: NOT_FOUND_PAGE_METADATA.robots,
};

/**
 * #2478 — every address no other route answers. Next renders an unmatched URL
 * through its bare `/_not-found` tree, which mounts no parallel slot, so the
 * `@chrome` header would be missing from the not-found page. Matching the
 * address here and throwing `notFound()` renders the root `not-found.tsx` in
 * the ordinary route tree instead — the `@chrome` catch-all draws the header,
 * the root layout the footer — with HTTP 404. The lowest-priority route:
 * every concrete route, and the `/v1/*` BFF rewrite, match before it.
 */
export default function UnknownAddress(): never {
  notFound();
}
