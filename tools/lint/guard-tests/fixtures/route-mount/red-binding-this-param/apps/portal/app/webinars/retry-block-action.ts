"use server";

import type { ReactNode } from "react";
import {
  type EventsBlockRetryInput,
  renderEventsBlock,
} from "@ds/events-storefront/retry";

import { ACADEMY_EVENTS_STOREFRONT } from "../../lib/events-storefront.host-config";

export async function retryAcademyEventsBlock(
  this: unknown,
  input: EventsBlockRetryInput,
): Promise<ReactNode> {
  return renderEventsBlock(ACADEMY_EVENTS_STOREFRONT, retryAcademyEventsBlock, input);
}
