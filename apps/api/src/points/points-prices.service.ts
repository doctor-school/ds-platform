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
  PointsGatingBlockedReasonSchema,
  PointsItemRefSchema,
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
    assertItemRef(itemRef);
    const body = PutPointsPriceRequestSchema.parse(input);
    const refuse = (path: string, message: string) =>
      new PointsLedgerError("POINTS_GATING_INVALID", message, [
        { path, message },
      ]);
    if (!POINTS_ITEM_KINDS[body.itemKind].priceable && body.mode !== "open") {
      throw refuse("mode", `a ${body.itemKind} is always open`);
    }
    // The ref must resolve as the declared kind, so no row can price an
    // event under another kind and skip the event checks below. Only `event`
    // has a platform table today; every other kind is refused until its owning
    // feature ships one (025 EARS-26).
    if (body.itemKind !== "event") {
      throw refuse(
        "itemRef",
        `no ${body.itemKind} can be priced yet: the platform has no ${body.itemKind} catalog`,
      );
    }
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
    const row = await withRequestAuditContext(this.db, async (tx) => {
      const [actor] = actorSub
        ? await tx
            .select({ id: users.id })
            .from(users)
            .where(
              and(eq(users.zitadelSub, actorSub), isNull(users.deactivatedAt)),
            )
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
   * is the one the sign-up's `record` enforces. Never a negative number. The
   * read answers every valid request with a decision: a refusal for the
   * account's state (`points-phone-unverified`, `points-reserve-limit`,
   * `points-account-closed`) is the `blocked` decision with that slug as its
   * `reason`; only a malformed `itemRef` is refused (400). A reserve with an
   * advance part (EARS-15) is `reserve-with-advance`.
   */
  async gating(
    personId: string,
    itemRef: string,
  ): Promise<PointsGatingDecision> {
    assertItemRef(itemRef);
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
      const { refusal } = quoted;
      if (refusal.errorCode === "POINTS_THRESHOLD_SHORT" && refusal.short) {
        return {
          ...base,
          decision: "short",
          shortfall: refusal.short.shortfall,
          earnHint: refusal.short.earnHint,
        };
      }
      const reason = PointsGatingBlockedReasonSchema.safeParse(refusal.problem);
      // A refusal no account state explains is a defect, not a decision.
      if (!reason.success) throw refusal;
      return { ...base, decision: "blocked", reason: reason.data };
    }
    const reserve = quoted.applied.find((a) => a.effect === "reserve");
    if (reserve) {
      const part = (leg: string) =>
        reserve.legs
          .filter((l) => l.leg === leg)
          .reduce((n, l) => n + l.amount, 0);
      const covered = part("reserve:advance");
      return {
        ...base,
        decision: covered > 0 ? "reserve-with-advance" : "reserve",
        reservedFromBalance: part("reserve:balance"),
        coveredByAdvance: covered,
      };
    }
    return { ...base, decision: "open" };
  }
}

/** EARS-13 / EARS-26 — a malformed `:itemRef` is a 400, before any read. */
function assertItemRef(itemRef: string): void {
  const parsed = PointsItemRefSchema.safeParse(itemRef);
  if (!parsed.success) {
    throw new PointsLedgerError(
      "POINTS_ITEM_REF_INVALID",
      "not an item reference",
      [{ path: "itemRef", message: parsed.error.issues[0]!.message }],
    );
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
