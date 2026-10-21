"use server";

import type { ReactNode } from "react";
import {
  type EventsBlockRetryInput,
  renderEventsBlock,
} from "@ds/events-storefront/retry";

import { ACADEMY_EVENTS_STOREFRONT } from "../../lib/events-storefront.host-config";

import { readSession } from "@/lib/session";

export async function retryAcademyEventsBlock(
  input: EventsBlockRetryInput,
): Promise<ReactNode> {
  return renderEventsBlock(ACADEMY_EVENTS_STOREFRONT, retryAcademyEventsBlock, input);
}
