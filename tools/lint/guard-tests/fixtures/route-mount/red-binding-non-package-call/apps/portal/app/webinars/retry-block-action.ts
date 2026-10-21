"use server";

import type { ReactNode } from "react";
import {
  type EventsBlockRetryInput,
  renderEventsBlock,
} from "@ds/events-storefront/retry";

import { ACADEMY_EVENTS_STOREFRONT } from "../../lib/events-storefront.host-config";

async function renderLocally(
  config: typeof ACADEMY_EVENTS_STOREFRONT,
  input: EventsBlockRetryInput,
): Promise<ReactNode> {
  return renderEventsBlock(config, retryAcademyEventsBlock, input);
}

export async function retryAcademyEventsBlock(
  input: EventsBlockRetryInput,
): Promise<ReactNode> {
  return renderLocally(ACADEMY_EVENTS_STOREFRONT, input);
}
