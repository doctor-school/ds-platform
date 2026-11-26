import { Inject, Injectable } from "@nestjs/common";
import { applications, type DrizzleHandle } from "@ds/db";
import {
  ApplicationProblemCodes,
  type InvestorRequestIntake,
  type InvestorRequestIntakeResult,
} from "@ds/schemas";
import { and, eq, sql } from "drizzle-orm";

import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { canonicalJson } from "../taxonomy/idempotency.service.js";
import { ApplicationNotices } from "./application-notices.js";
import { APPLICATION_KIND_TABLE } from "./applications.kinds.js";
import { defined, refusal } from "./applications.service.js";
import {
  APPLICATIONS_CLOCK,
  type ApplicationsClock,
} from "./applications.tokens.js";

type Db = DrizzleHandle["db"];

/** An empty optional form field is stored absent, never `""`. */
const present = (value: string | undefined) => value || undefined;

/**
 * 034 EARS-4, EARS-6, EARS-9 — the guest intake of the `investor` kind: the
 * Academy «Инвесторам» page's «Обсудить проект» form (034-design «Placement»,
 * «Intake and notification sequence»).
 *
 * No account stands behind the request, so — as for the 033 `partnership`
 * kind — no `consent_records` row exists: the row carries the consent purpose
 * `investor-request-personal-data`, the current version tag and the
 * submission time. The committed row fires both 033 notices after the commit
 * (#4029): the team notice and «Заявка получена» to `contact.email`
 * (`receiptTo: "contact-email"`); their outcomes never change the answer.
 */
@Injectable()
export class ApplicationsInvestorService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(APPLICATIONS_CLOCK) private readonly clock: ApplicationsClock,
    @Inject(ApplicationNotices) private readonly notices: ApplicationNotices,
  ) {}

  /**
   * One transaction: a per-key advisory lock, the replay lookup, then — for a
   * new key — the consent tag check and one `applications` row. A replay with
   * the same body answers the stored id and writes nothing; any other reuse of
   * the key is `422 IDEMPOTENCY_KEY_REUSED`.
   */
  async submit(
    idempotencyKey: string,
    body: InvestorRequestIntake,
  ): Promise<InvestorRequestIntakeResult> {
    const kind = APPLICATION_KIND_TABLE.investor;
    const contact = kind.contactSchema.parse(
      defined({
        ...body.contact,
        role: present(body.contact.role),
        phone: present(body.contact.phone),
      }),
    );
    const payload = kind.payloadSchema.parse(
      defined({ task: present(body.payload.task) }),
    );
    const consentVersion = body.consent.versionTag;

    const outcome = await withRequestAuditContext(this.db, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`applications:investor:${idempotencyKey}`}, 0))`,
      );
      const [stored] = await tx
        .select({
          id: applications.id,
          payload: applications.payload,
          contact: applications.contact,
          consentVersionTag: applications.consentVersionTag,
        })
        .from(applications)
        .where(
          and(
            eq(applications.kind, "investor"),
            eq(applications.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (stored) {
        const same =
          stored.consentVersionTag === consentVersion &&
          canonicalJson(stored.payload) === canonicalJson(payload) &&
          canonicalJson(stored.contact) === canonicalJson(contact);
        if (!same)
          throw refusal(422, ApplicationProblemCodes.idempotencyKeyReused);
        return { created: false as const, id: stored.id };
      }

      if (consentVersion !== kind.consentVersionTag)
        throw refusal(
          400,
          ApplicationProblemCodes.consentVersionStale,
          "consent",
        );

      const [created] = await tx
        .insert(applications)
        .values({
          kind: "investor",
          payload,
          contact,
          subjectLine: kind.subjectLine(payload, contact),
          consentPurpose: kind.consentPurpose,
          consentVersionTag: kind.consentVersionTag,
          idempotencyKey,
          submittedAt: this.clock(),
        })
        .returning({
          id: applications.id,
          submittedAt: applications.submittedAt,
        });
      return {
        created: true as const,
        id: created!.id,
        submittedAt: created!.submittedAt,
      };
    });
    if (outcome.created)
      this.notices.afterCommit({
        id: outcome.id,
        kind: "investor",
        submittedAt: outcome.submittedAt,
        applicantUserId: null,
        contact,
      });
    return { id: outcome.id };
  }
}
