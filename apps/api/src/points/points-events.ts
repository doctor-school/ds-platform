import { Injectable, Logger } from "@nestjs/common";
import type { PointsCreditedEvent } from "@ds/schemas";

export type PointsCreditedSubscriber = (
  event: PointsCreditedEvent,
) => void | Promise<void>;

/**
 * 025 EARS-20 — open obligations of `personId` netted by the Pul credits of
 * the fact `eventId`: `settled` Pul in all, `remaining` still owed across the
 * person's open obligations after it.
 */
export interface PointsAdvanceSettledEvent {
  personId: string;
  eventId: string;
  settled: number;
  remaining: number;
}

export type PointsAdvanceSettledSubscriber = (
  event: PointsAdvanceSettledEvent,
) => void | Promise<void>;

/**
 * The 025 engine's in-process event publisher (025-design §4 «Event bus»).
 * apps/api has no event bus, so `PointsCredited` — the only event from which a
 * consumer may state a credited amount (EARS-3) — and `AdvanceSettled`
 * (EARS-20) are published through this one typed provider. The intake publishes AFTER the posting transaction
 * committed, so a subscriber never sees a credit that rolled back. Consumer
 * slices (021, 022, mobile) register with `onCredited` from their own module;
 * this slice registers none.
 *
 * Delivery is in-process and at-most-once: a subscriber failure is logged and
 * never reaches the producer, whose fact is already durable — the postings,
 * not the event, are the record (a consumer that must not miss a credit reads
 * the ledger).
 */
@Injectable()
export class PointsEventsPublisher {
  private readonly logger = new Logger(PointsEventsPublisher.name);
  private readonly credited: PointsCreditedSubscriber[] = [];
  private readonly advanceSettled: PointsAdvanceSettledSubscriber[] = [];

  onCredited(subscriber: PointsCreditedSubscriber): () => void {
    this.credited.push(subscriber);
    return () => {
      const index = this.credited.indexOf(subscriber);
      if (index >= 0) this.credited.splice(index, 1);
    };
  }

  async publishCredited(event: PointsCreditedEvent): Promise<void> {
    for (const subscriber of [...this.credited]) {
      try {
        await subscriber(event);
      } catch (error) {
        this.logger.error(
          `PointsCredited subscriber failed for event ${event.eventId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  onAdvanceSettled(subscriber: PointsAdvanceSettledSubscriber): () => void {
    this.advanceSettled.push(subscriber);
    return () => {
      const index = this.advanceSettled.indexOf(subscriber);
      if (index >= 0) this.advanceSettled.splice(index, 1);
    };
  }

  async publishAdvanceSettled(event: PointsAdvanceSettledEvent): Promise<void> {
    for (const subscriber of [...this.advanceSettled]) {
      try {
        await subscriber(event);
      } catch (error) {
        this.logger.error(
          `AdvanceSettled subscriber failed for event ${event.eventId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
