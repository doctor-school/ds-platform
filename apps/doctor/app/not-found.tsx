import type { Metadata } from "next";

import { NOT_FOUND_PAGE_METADATA, StorefrontNotFound } from "@ds/storefront-shell/not-found";

import { DoctorStorefrontFrame } from "@/components/storefront-frame";

export const metadata: Metadata = {
  title: NOT_FOUND_PAGE_METADATA.title,
  robots: NOT_FOUND_PAGE_METADATA.robots,
};

/**
 * #2478 — the doctor storefront's not-found page: the not-found state of the
 * platform's one error page, inside the storefront frame (an unknown address
 * matches no route group, so the frame is mounted here too). HTTP 404.
 */
export default function DoctorNotFound() {
  return (
    <DoctorStorefrontFrame>
      <StorefrontNotFound />
    </DoctorStorefrontFrame>
  );
}
