"use server";

import type { ReactNode } from "react";
import { renderHomeEventsBlock } from "@ds/events-storefront/home";

import {
  DOCTOR_EVENTS_STOREFRONT,
  DOCTOR_HOME_EVENTS,
} from "../../lib/events-storefront.host-config";

/**
 * 017 EARS-9 (#1485) — the doctor home's nearest-events retry: «Обновить» in
 * the failed block re-runs only its feed read and answers that block alone.
 * The package decides; this host only names its config.
 */
export async function retryDoctorHomeEvents(): Promise<ReactNode> {
  return renderHomeEventsBlock(
    DOCTOR_EVENTS_STOREFRONT,
    DOCTOR_HOME_EVENTS,
    retryDoctorHomeEvents,
  );
}
