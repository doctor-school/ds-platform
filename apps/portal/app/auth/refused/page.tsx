import type { Metadata } from "next";

import { ENTRY_REFUSAL_COPY } from "@ds/auth-flow/copy";
import { StorefrontEntryRefusalRoute } from "@ds/auth-flow/refusal/route";

import { ACADEMY_AUTH_FLOW } from "../../../lib/auth-flow.host-config";

export const metadata: Metadata = {
  title: ENTRY_REFUSAL_COPY.pageTitle,
  robots: { index: false, follow: false },
};

/**
 * 003 EARS-72 — the Academy's refusal page: the path the storefront gate
 * rewrites a refused door to, mounted inside the Academy shell (the root
 * layout's chrome). The page is the package's; this host supplies its config
 * and home.
 */
export default function AcademyEntryRefusalPage() {
  return <StorefrontEntryRefusalRoute config={ACADEMY_AUTH_FLOW} homeHref="/" />;
}
