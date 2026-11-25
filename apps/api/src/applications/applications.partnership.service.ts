import { Inject, Injectable } from "@nestjs/common";
import { applications, type DrizzleHandle } from "@ds/db";
import {
  ApplicationProblemCodes,
  type PartnershipRequestIntake,
  type PartnershipRequestIntakeResult,
} from "@ds/schemas";
import { and, eq, sql } from "drizzle-orm";

import { withRequestAuditContext } from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { canonicalJson } from "../taxonomy/idempotency.service.js";
import { APPLICATION_KIND_TABLE } from "./applications.kinds.js";
import { defined, refusal } from "./applications.service.js";
import {
  APPLICATIONS_CLOCK,
  type ApplicationsClock,
} from "./applications.tokens.js";

type Db = DrizzleHandle["db"];

/**
 * 033 EARS-18 — the guest intake of the `partnership` kind: the Academy home's
 * partnership form (033-design «Request kinds», «Endpoints»).
 *
 * No account stands behind the request, so no `consent_records` row exists for
 * it: the row itself carries the consent purpose and the form's fixed version
 * tag, the same stamp every imported interim record carries (EARS-19). The
 * home form promises no letter, so the receipt is `not_applicable` from the
 * start; the team notice stays `pending` for the notifications slice (#4029).
 */
@Injectable()
export class ApplicationsPartnershipService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(APPLICATIONS_CLOCK) private readonly clock: ApplicationsClock,
  ) {}

  /**
   * One transaction: a per-key advisory lock, the replay lookup, then — for a
   * new key — the consent tag check and one `applications` row. A replay with
   * the same body answers the stored id and writes nothing; any other reuse of
   * the key is `422 IDEMPOTENCY_KEY_REUSED`.
   */
  async submit(
    idempotencyKey: string,
    body: PartnershipRequestIntake,
  ): Promise<PartnershipRequestIntakeResult> {
    const kind = APPLICATION_KIND_TABLE.partnership;
    const {
      consentVersion,
      contact: emailOrTelegram,
      companyOrClinic,
      ...rest
    } = body;
    const payload = defined(
      kind.payloadSchema.parse(
        defined({ ...rest, companyOrClinic: companyOrClinic || undefined }),
      ),
    );
    const contact = kind.contactSchema.parse({ emailOrTelegram });

    return withRequestAuditContext(this.db, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`applications:partnership:${idempotencyKey}`}, 0))`,
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
            eq(applications.kind, "partnership"),
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
        return { id: stored.id };
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
          kind: "partnership",
          payload,
          contact,
          subjectLine: kind.subjectLine(payload),
          consentPurpose: kind.consentPurpose,
          consentVersionTag: kind.consentVersionTag,
          idempotencyKey,
          submittedAt: this.clock(),
          receiptNotice: "not_applicable",
        })
        .returning({ id: applications.id });
      return { id: created!.id };
    });
  }
}
