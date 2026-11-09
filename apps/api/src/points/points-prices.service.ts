import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  type DrizzleHandle,
  events,
  type PointsPriceRow,
  pointsPrices,
  users,
} from "@ds/db";
import {
  POINTS_ITEM_KINDS,
  type PointsGatingDecision,
  type PointsGatingMode,
  type PointsItemKind,
  type PointsPrice,
  PUL_UNIT,
  PutPointsPriceRequestSchema,
  type PutPointsPriceRequest,
} from "@ds/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { eventEconomyFacts } from "../events/event-economy-facts.js";
import { HoldBook } from "./engine/holds.js";
import { PointsEngine } from "./engine/points-engine.service.js";
import { PointsLedgerError } from "./points.errors.js";

type Db = DrizzleHandle["db"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 025 EARS-26 — the price list (admin write) and EARS-13 — the gating
 * decision (doctor read, `quote` of a draft sign-up). 025-design production
 * amendment A, D, E, F.
 */
@Injectable()
export class PointsPricesService {
  private readonly holds = new HoldBook();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(PointsEngine) private readonly engine: PointsEngine,
  ) {}

  /**
   * EARS-26 — set an item's price-list row. Any mode for a priceable kind;
   * only `open` for a lesson, a module or an НМО-accredited event
   * (`points-gating-invalid`); an `event` row names an existing event.
   * Audited through the request audit context and the row-audit trigger
   * (0061). A hold keeps the price it was reserved at, so the row applies to
   * reserves and debits created afterwards only.
   */
  async put(
    itemRef: string,
    input: PutPointsPriceRequest,
    actorSub: string | null,
  ): Promise<PointsPrice> {
    const body = PutPointsPriceRequestSchema.parse(input);
    const refuse = (path: string, message: string) =>
      new PointsLedgerError("POINTS_GATING_INVALID", message, [{ path, message }]);
    if (!POINTS_ITEM_KINDS[body.itemKind].priceable && body.mode !== "open") {
      throw refuse("mode", `a ${body.itemKind} is always open`);
    }
    if (body.itemKind === "event") {
      const [event] = UUID.test(itemRef)
        ? await this.db
            .select({ id: events.id })
            .from(events)
            .where(eq(events.id, itemRef))
        : [];
      if (!event) throw refuse("itemRef", "no such event");
      // The ONE reading of an event's НМО accreditation (020/019 share it).
      if (eventEconomyFacts().nmo && body.mode !== "open") {
        throw refuse("mode", "an НМО-accredited event is always open");
      }
    }
    const row = await withRequestAuditContext(this.db, async (tx) => {
      const [actor] = actorSub
        ? await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.zitadelSub, actorSub), isNull(users.deactivatedAt)))
        : [];
      const values = {
        itemKind: body.itemKind,
        mode: body.mode,
        pulCost: body.pulCost,
        limitedSeats: body.limitedSeats,
        updatedAt: new Date(),
        updatedBy: actor?.id ?? null,
      };
      const [stored] = await tx
        .insert(pointsPrices)
        .values({ itemRef, ...values })
        .onConflictDoUpdate({ target: pointsPrices.itemRef, set: values })
        .returning();
      return stored!;
    });
    return toPrice(row);
  }

  /**
   * EARS-13 — the calling doctor's gating decision on `itemRef`: `quote`
   * (EARS-41) of a draft `registration.created`, so the advertised decision
   * is the one the sign-up's `record` enforces. Never a negative number. A
   * refusal the decision cannot express (`points-phone-unverified`,
   * `points-reserve-limit`) is raised as its problem. The
   * `reserve-with-advance` branch and the advance part of `pulToEarn` land
   * with the advance slice (#3811).
   */
  async gating(personId: string, itemRef: string): Promise<PointsGatingDecision> {
    const price = await this.holds.priceOf(this.db, itemRef);
    const quoted = await this.engine.quote(personId, {
      type: "registration.created",
      eventId: `quote:${randomUUID()}`,
      ref: itemRef,
      occurredAt: new Date(),
      attributes: { registrationId: randomUUID() },
    });
    const base = {
      itemRef,
      mode: (price?.mode ?? "open") as PointsGatingMode,
      pulCost: price?.pulCost ?? 0,
      unit: PUL_UNIT,
      reservedFromBalance: 0,
      coveredByAdvance: 0,
      shortfall: 0,
    };
    if (quoted.refusal) {
      if (quoted.refusal.errorCode !== "POINTS_THRESHOLD_SHORT" || !quoted.refusal.short) {
        throw quoted.refusal;
      }
      return {
        ...base,
        decision: "short",
        shortfall: quoted.refusal.short.shortfall,
        earnHint: quoted.refusal.short.earnHint,
      };
    }
    const reserve = quoted.applied.find((a) => a.effect === "reserve");
    if (reserve) {
      const held = reserve.legs
        .filter((l) => l.leg === "reserve:balance")
        .reduce((n, l) => n + l.amount, 0);
      return { ...base, decision: "reserve", reservedFromBalance: held };
    }
    return { ...base, decision: "open" };
  }
}

function toPrice(row: PointsPriceRow): PointsPrice {
  return {
    itemRef: row.itemRef,
    itemKind: row.itemKind as PointsItemKind,
    mode: row.mode as PointsGatingMode,
    pulCost: row.pulCost,
    unit: PUL_UNIT,
    limitedSeats: row.limitedSeats,
    updatedAt: row.updatedAt.toISOString(),
  };
}
