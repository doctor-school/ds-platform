import type { Metadata } from "next";

import { NOT_FOUND_PAGE_METADATA, StorefrontNotFound } from "@ds/storefront-shell/not-found";

export const metadata: Metadata = {
  title: NOT_FOUND_PAGE_METADATA.title,
  robots: NOT_FOUND_PAGE_METADATA.robots,
};

/**
 * #2478 — the Academy's not-found page: the not-found state of the platform's
 * one error page, inside the Academy shell (the root layout's chrome and
 * footer). HTTP 404.
 */
export default function AcademyNotFound() {
  return <StorefrontNotFound />;
}
