"use server";

import type { ReactNode } from "react";
import {
  type EventsBlockRetryInput,
  renderEventsBlock,
} from "@ds/events-storefront/retry";

import { ACADEMY_EVENTS_STOREFRONT } from "../../lib/events-storefront.host-config";

/**
 * 019 EARS-9 (#2832) — the Academy listing's block retry: «Повторить» in a
 * failed block re-runs only that block's read and answers that block alone.
 * The package decides; this host only names its config.
 */
export async function retryAcademyEventsBlock(
  input: EventsBlockRetryInput,
): Promise<ReactNode> {
  return renderEventsBlock(ACADEMY_EVENTS_STOREFRONT, retryAcademyEventsBlock, input);
}
