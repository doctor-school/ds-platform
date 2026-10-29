import type { Metadata } from "next";

import {
  ENTRY_REFUSAL_PAGE_METADATA,
  StorefrontEntryRefusalRoute,
} from "@ds/auth-flow/refusal/route";

import { DOCTOR_AUTH_FLOW } from "../../../../lib/auth-flow.host-config";

export const metadata: Metadata = {
  title: ENTRY_REFUSAL_PAGE_METADATA.title,
  robots: ENTRY_REFUSAL_PAGE_METADATA.robots,
};

/**
 * 003 EARS-72 — the doctor storefront's refusal page: the path the storefront
 * gate rewrites a refused door to, mounted inside the storefront shell
 * (`app/(storefront)/layout.tsx`). The page is the package's; this host
 * supplies its config and home.
 */
export default function DoctorEntryRefusalPage() {
  return <StorefrontEntryRefusalRoute config={DOCTOR_AUTH_FLOW} homeHref="/" />;
}
