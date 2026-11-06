import { Injectable, Logger } from "@nestjs/common";
import type { PointsCreditedEvent } from "@ds/schemas";

export type PointsCreditedSubscriber = (
  event: PointsCreditedEvent,
) => void | Promise<void>;

/**
 * The 025 engine's in-process event publisher (025-design §4 «Event bus»).
 * apps/api has no event bus, so `PointsCredited` — the only event from which a
 * consumer may state a credited amount (EARS-3) — is published through this
 * one typed provider. The intake publishes AFTER the posting transaction
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
}
