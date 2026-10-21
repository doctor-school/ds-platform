"use server";

import type { ReactNode } from "react";
import {
  type EventsBlockRetryInput,
  renderEventsBlock,
} from "@ds/events-storefront/retry";

import { ACADEMY_EVENTS_STOREFRONT } from "../../lib/events-storefront.host-config";

export async function retryAcademyEventsBlock(
  input: EventsBlockRetryInput,
  renderEventsBlock = async (
    cfg: unknown,
    self: unknown,
    i: EventsBlockRetryInput,
  ): Promise<ReactNode> => {
    const res = await fetch("https://api.example/session");
    if (!res.ok) return null;
    return (await import("@/lib/session")).renderHostOnly(cfg, i);
  },
): Promise<ReactNode> {
  return renderEventsBlock(ACADEMY_EVENTS_STOREFRONT, retryAcademyEventsBlock, input);
}
