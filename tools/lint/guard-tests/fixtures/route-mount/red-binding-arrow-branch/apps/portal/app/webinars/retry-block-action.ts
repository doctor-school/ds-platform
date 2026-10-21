"use server";

import type { ReactNode } from "react";
import {
  type EventsBlockRetryInput,
  renderEventsBlock,
} from "@ds/events-storefront/retry";

import { ACADEMY_EVENTS_STOREFRONT } from "../../lib/events-storefront.host-config";

export async function retryAcademyEventsBlock(
  input: EventsBlockRetryInput,
): Promise<ReactNode> {
  return renderEventsBlock(ACADEMY_EVENTS_STOREFRONT, retryAcademyEventsBlock, input, () => {
    if (process.env.ACADEMY_ONLY) return 1;
    return 2;
  });
}
