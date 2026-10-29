import type { Metadata } from "next";

import { ENTRY_REFUSAL_COPY } from "@ds/auth-flow/copy";
import { StorefrontEntryRefusalRoute } from "@ds/auth-flow/refusal/route";

import { DOCTOR_AUTH_FLOW } from "@/lib/auth-flow.host-config";

export const metadata: Metadata = {
  title: ENTRY_REFUSAL_COPY.pageTitle,
  robots: { index: false, follow: false },
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
