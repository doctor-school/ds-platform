import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle } from "@ds/db";
import {
  accrualDedupeKey,
  accrualRuleId,
  type PointsAccrualAction,
  type PointsAccrualFact,
  PointsAccrualFactSchema,
  type PointsCreditedEvent,
  type PointsDenomination,
  type PointsPosting,
  type PointsPostingLeg,
} from "@ds/schemas";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { PointsEventsPublisher } from "./points-events.js";
import { PointsLedgerService } from "./points-ledger.service.js";
import { RuleBookService } from "./rule-book.service.js";

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const DENOMINATIONS: readonly PointsDenomination[] = ["pul", "bre", "con"];

/**
 * The intake's answer (EARS-3 / EARS-4).
 *  - `posted` — the postings written, and the `PointsCredited` event of them;
 *  - `duplicate` — the fact (by event id or dedupe key) was already recorded;
 *    nothing written, the original postings referenced, no event;
 *  - `nothing-to-credit` — the active rule version credits zero in every
 *    denomination; nothing written, no posting key, no event.
 */
export type PointsIntakeOutcome =
  | {
      status: "posted";
      postings: PointsPosting[];
      credited: PointsCreditedEvent;
    }
  | { status: "duplicate"; postings: PointsPosting[] }
  | { status: "nothing-to-credit"; ruleId: string; ruleVersion: number };

/**
 * `PointsFactIntake` (025-design §4) — the one entry point for an
 * accrual-source fact. It evaluates the rule `accrual.<action>` version active
 * at the fact's `occurredAt`, builds one leg `accrual:<denomination>` issuance
 * → person per non-zero denomination with the PRD dedupe key
 * `<personId>:<contentRef>:<action>`, and posts them through the ledger core in
 * one transaction; then it publishes `PointsCredited`.
 *
 * Not here (later slices, design §4): the `obligation-settle:pul` leg netting
 * new Pul against an open advance (#3811), the per-action award conditions
 * (offline/open learning without Pul, presence share — #3809) and the
 * referral monthly cap (#3816). The engagement cap of EARS-10 needs no
 * state: the dedupe key per (person, event, action) is the cap.
 */
@Injectable()
export class PointsFactIntake {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(RuleBookService) private readonly rules: RuleBookService,
    @Inject(PointsLedgerService) private readonly ledger: PointsLedgerService,
    @Inject(PointsEventsPublisher)
    private readonly events: PointsEventsPublisher,
  ) {}

  /**
   * Accept one accrual fact. Without `tx` the intake owns the transaction and
   * publishes `PointsCredited` after it committed. With a producer's `tx`
   * (design §1: producers post inside their own transaction; the fact runs in
   * a savepoint) the commit is the producer's, so the intake cannot publish:
   * the producer calls {@link publishCommitted} with the outcome once its
   * transaction committed.
   */
  async accept(
    input: PointsAccrualFact,
    tx?: Tx,
  ): Promise<PointsIntakeOutcome> {
    const fact = PointsAccrualFactSchema.parse(input);
    const outcome = tx
      ? await this.evaluateAndPost(fact, tx)
      : await withRequestAuditContext(this.db, (own) =>
          this.evaluateAndPost(fact, own),
        );
    if (!tx) await this.publishCommitted(outcome);
    return outcome;
  }

  /** Publish the event of a committed `posted` outcome; a duplicate or a zero credit publishes nothing. */
  async publishCommitted(outcome: PointsIntakeOutcome): Promise<void> {
    if (outcome.status === "posted") {
      await this.events.publishCredited(outcome.credited);
    }
  }

  private async evaluateAndPost(
    fact: PointsAccrualFact,
    tx: Tx,
  ): Promise<PointsIntakeOutcome> {
    const rule =
      await this.rules.activeVersion<`accrual.${PointsAccrualAction}`>(
        accrualRuleId(fact.action),
        fact.occurredAt,
        tx,
      );
    const legs: PointsPostingLeg[] = DENOMINATIONS.filter(
      (denomination) => rule.parameters[denomination] > 0,
    ).map((denomination) => ({
      leg: `accrual:${denomination}`,
      debit: { kind: "system", code: "issuance" },
      credit: { kind: "person", personId: fact.personId },
      denomination,
      amount: rule.parameters[denomination],
      ruleId: rule.ruleId,
      ruleVersion: rule.version,
      action: fact.action,
      ...(fact.projectId ? { projectId: fact.projectId } : {}),
      ...(fact.output
        ? { outputType: fact.output.type, outputId: fact.output.id }
        : {}),
      ...(fact.attribution?.organisationId
        ? { attributedOrganisationId: fact.attribution.organisationId }
        : {}),
      ...(fact.attribution?.memberId
        ? { attributedMemberId: fact.attribution.memberId }
        : {}),
    }));
    if (legs.length === 0) {
      return {
        status: "nothing-to-credit",
        ruleId: rule.ruleId,
        ruleVersion: rule.version,
      };
    }
    const posted = await this.ledger.post(
      {
        eventId: fact.eventId,
        dedupeKey: accrualDedupeKey(fact),
        occurredAt: fact.occurredAt,
        legs,
      },
      tx,
    );
    if (posted.status === "duplicate") return posted;
    return {
      status: "posted",
      postings: posted.postings,
      credited: {
        personId: fact.personId,
        eventId: fact.eventId,
        postings: posted.postings.map((p) => ({
          denomination: p.denomination,
          amount: p.amount,
        })),
      },
    };
  }
}
