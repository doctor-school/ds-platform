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
 * one transaction; `PointsCredited` is published only after that transaction
 * committed — by {@link PointsFactIntake.accept} itself, or by the producer
 * through the `publishAfterCommit` that {@link PointsFactIntake.acceptWithin}
 * returns.
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
   * Accept one accrual fact in a transaction of the intake's own; once it
   * committed, publish `PointsCredited` (a `posted` outcome only — a duplicate
   * or a zero credit publishes nothing). An invalid fact (`PointsAccrualFactSchema`,
   * e.g. a content-scoped action without `contentRef`) throws its `ZodError`
   * before anything is written.
   */
  async accept(input: PointsAccrualFact): Promise<PointsIntakeOutcome> {
    const fact = PointsAccrualFactSchema.parse(input);
    const outcome = await withRequestAuditContext(this.db, (own) =>
      this.evaluateAndPost(fact, own),
    );
    await this.publishAfterCommit(outcome)();
    return outcome;
  }

  /**
   * Accept one accrual fact inside a producer's transaction (design §1: the
   * fact commits or rolls back with the producer's own write; the ledger runs
   * it in a savepoint). The commit is the producer's, so the intake publishes
   * nothing itself and hands back the obligation instead:
   *
   * **the caller MUST invoke `publishAfterCommit()` after its transaction
   * committed**, and never before; a caller whose transaction rolled back
   * never calls it (nothing was stored, so nothing is published). It publishes
   * `PointsCredited` at most once, and only for a `posted` outcome; the
   * returned promise settles once the subscribers ran (a subscriber failure is
   * logged, never thrown — `PointsEventsPublisher`).
   */
  async acceptWithin(
    tx: Tx,
    input: PointsAccrualFact,
  ): Promise<{
    outcome: PointsIntakeOutcome;
    publishAfterCommit: () => Promise<void>;
  }> {
    const fact = PointsAccrualFactSchema.parse(input);
    const outcome = await this.evaluateAndPost(fact, tx);
    return { outcome, publishAfterCommit: this.publishAfterCommit(outcome) };
  }

  /** The once-only publication of a committed outcome's event. */
  private publishAfterCommit(
    outcome: PointsIntakeOutcome,
  ): () => Promise<void> {
    let published = false;
    return async () => {
      if (published || outcome.status !== "posted") return;
      published = true;
      await this.events.publishCredited(outcome.credited);
    };
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
