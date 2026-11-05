import type { ReactNode } from "react";
import { DoctorStorefrontFrame } from "@/components/storefront-frame";

/**
 * 017 EARS-1 — THE storefront shell layout.
 *
 * This route-group layout mounts the single definition of the doctor
 * storefront's header, navigation and footer (design §1,
 * {@link DoctorStorefrontFrame}). Every doctor-facing route of 017 and of
 * features 018–021 lives under `app/(storefront)/` and therefore renders inside
 * it; a screen-local re-implementation of any of the three is a defect, not a
 * variation. The group `(storefront)` adds no URL segment — `/` stays `/`. The
 * root not-found page (#2478) mounts the same frame.
 */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return <DoctorStorefrontFrame>{children}</DoctorStorefrontFrame>;
}
