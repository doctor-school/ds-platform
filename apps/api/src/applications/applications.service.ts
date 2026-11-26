import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  applicationNotes,
  applications,
  consentRecords,
  type DrizzleHandle,
  specialtiesMinzdrav,
  users,
} from "@ds/db";
import {
  APPLICATION_NOTE_ERASED_SENTINEL,
  type ApplicationProblemCode,
  ApplicationProblemCodes,
  type ApplicantApplicationList,
  type AuthorApplicationIntake,
  type AuthorApplicationIntakeResult,
  isCanonicalIdempotencyKey,
} from "@ds/schemas";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";

import {
  type AuditedTransaction,
  withRequestAuditContext,
} from "../audit/audit-context.tx.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { canonicalJson } from "../taxonomy/idempotency.service.js";
import { resolveApplicationConsentVersion } from "./applications-consent.js";
import { ApplicationNotices } from "./application-notices.js";
import { APPLICATION_KIND_TABLE } from "./applications.kinds.js";
import {
  APPLICATIONS_CLOCK,
  type ApplicationsClock,
} from "./applications.tokens.js";

type Db = DrizzleHandle["db"];
/** A transaction handle, or the pool for a single-statement caller. */
type Writer = AuditedTransaction | Db;

/** The erasure tombstone of 033-design «Data model» (EARS-20). */
const ERASED_PAYLOAD = { erased: true } as const;

export function refusal(
  status: 400 | 422 | 428 | 503,
  code: ApplicationProblemCode,
  field?: string,
): HttpException {
  const body = { problems: [field ? { code, field } : { code }] };
  if (status === 400) return new BadRequestException(body);
  if (status === 422) return new UnprocessableEntityException(body);
  if (status === 503) return new ServiceUnavailableException(body);
  return new HttpException(body, 428);
}

/** Drop `undefined` members so the stored jsonb and the replay compare equal. */
export function defined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

/**
 * 033 EARS-20 — erase one application's personal data to the tombstone:
 * payload `{"erased": true}`, contact and subject line `null`, the applicant
 * unlinked, every note body the sentinel `[стёрто]`, `pd_erased_at` set; kind,
 * status, outcome and times kept, no row deleted (ADR-0009 §2.3).
 *
 * Runs in the caller's transaction. Returns `false` for an application that is
 * already erased (or does not exist) and changes nothing then — an erased
 * application is never erased again.
 */
export async function eraseApplication(
  tx: Writer,
  id: string,
  now: Date,
): Promise<boolean> {
  const erased = await tx
    .update(applications)
    .set({
      payload: ERASED_PAYLOAD,
      contact: null,
      subjectLine: null,
      applicantUserId: null,
      pdErasedAt: now,
      version: sql`${applications.version} + 1`,
    })
    .where(and(eq(applications.id, id), isNull(applications.pdErasedAt)))
    .returning({ id: applications.id });
  if (erased.length === 0) return false;
  await tx
    .update(applicationNotes)
    .set({ body: APPLICATION_NOTE_ERASED_SENTINEL })
    .where(eq(applicationNotes.applicationId, id));
  return true;
}

/**
 * 033 EARS-24 — the queue's per-table step of the ADR-0009 §2.3 account
 * erasure: every application of `userId` that is not yet erased, whatever its
 * status, gets the EARS-20 tombstone, in the caller's transaction. Idempotent:
 * an erased application no longer carries the user id, so a second run finds
 * nothing. Registered as the `applications` erasure mechanism in the ADR-0009
 * design §3 matrix; the ADR-0009 erasure executor calls it.
 *
 * @returns how many applications it erased.
 */
export async function eraseApplicationsOfAccount(
  userId: string,
  tx: Writer,
  now: Date = new Date(),
): Promise<number> {
  const rows = await tx
    .select({ id: applications.id })
    .from(applications)
    .where(
      and(
        eq(applications.applicantUserId, userId),
        isNull(applications.pdErasedAt),
      ),
    );
  let erased = 0;
  for (const row of rows) if (await eraseApplication(tx, row.id, now)) erased++;
  return erased;
}

/**
 * 033 — the application queue core (033-design «Data model», «Lifecycle»).
 *
 * The author intake (EARS-6, EARS-7) and the two retention steps of the daily
 * purge (EARS-23 expiry, EARS-20 erasure one year after closing). Every write
 * runs in the request audit context, so the 010 trigger attributes it; the
 * queue's PD columns are masked in that ledger (EARS-25).
 */
@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    @Inject(APPLICATIONS_CLOCK) private readonly clock: ApplicationsClock,
    @Inject(ApplicationNotices) private readonly notices: ApplicationNotices,
  ) {}

  /** Absent/blank `Idempotency-Key` is 428, a non-canonical one 400 (012 §6). */
  requireKey(raw: unknown): string {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length === 0)
      throw refusal(428, ApplicationProblemCodes.idempotencyKeyRequired);
    if (!isCanonicalIdempotencyKey(value))
      throw refusal(400, ApplicationProblemCodes.idempotencyKeyInvalid);
    return value;
  }

  /**
   * EARS-6, EARS-7 — `POST /v1/me/applications/author`.
   *
   * One transaction: a per-key advisory lock, the replay lookup, then — for a
   * new key — the consent version and specialty checks, one `consent_records`
   * row and one `applications` row linked to it. A replay of the same key by
   * the same account with the same body answers the stored result and writes
   * nothing; any other reuse of the key is `422 IDEMPOTENCY_KEY_REUSED`.
   * Only a new row, once committed, fires the EARS-11/12 notices; a replay
   * sends nothing again.
   */
  async submitAuthor(
    sub: string,
    idempotencyKey: string,
    body: AuthorApplicationIntake,
  ): Promise<AuthorApplicationIntakeResult> {
    const kind = APPLICATION_KIND_TABLE.author;
    const userId = await this.accountId(sub);
    const { consentVersion, ...rest } = body;
    const payload = defined(kind.payloadSchema.parse(defined(rest)));

    const outcome = await withRequestAuditContext(this.db, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`applications:author:${idempotencyKey}`}, 0))`,
      );
      const [stored] = await tx
        .select({
          id: applications.id,
          submittedAt: applications.submittedAt,
          applicantUserId: applications.applicantUserId,
          payload: applications.payload,
          consentVersionTag: applications.consentVersionTag,
        })
        .from(applications)
        .where(
          and(
            eq(applications.kind, "author"),
            eq(applications.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (stored) {
        const same =
          stored.applicantUserId === userId &&
          stored.consentVersionTag === consentVersion &&
          canonicalJson(stored.payload) === canonicalJson(payload);
        if (!same)
          throw refusal(422, ApplicationProblemCodes.idempotencyKeyReused);
        return {
          created: false as const,
          result: {
            id: stored.id,
            submittedAt: stored.submittedAt.toISOString(),
          },
        };
      }

      const current = resolveApplicationConsentVersion(
        kind.consentDocumentSlug,
      );
      if (!current.ok)
        throw refusal(503, ApplicationProblemCodes.consentUnavailable);
      if (consentVersion !== current.version)
        throw refusal(
          400,
          ApplicationProblemCodes.consentVersionStale,
          "consent",
        );

      if (payload.specialtyCode !== undefined) {
        const [specialty] = await tx
          .select({ id: specialtiesMinzdrav.id })
          .from(specialtiesMinzdrav)
          .where(
            and(
              eq(specialtiesMinzdrav.code, payload.specialtyCode),
              eq(specialtiesMinzdrav.isOther, false),
            ),
          )
          .limit(1);
        if (!specialty)
          throw refusal(
            400,
            ApplicationProblemCodes.specialtyUnknown,
            "specialtyCode",
          );
      }

      const submittedAt = this.clock();
      const [consent] = await tx
        .insert(consentRecords)
        .values({
          userId,
          purpose: kind.consentPurpose,
          version: current.version,
          capturedAt: submittedAt,
        })
        .returning({ id: consentRecords.id });
      const [created] = await tx
        .insert(applications)
        .values({
          kind: "author",
          applicantUserId: userId,
          payload,
          subjectLine: kind.subjectLine(payload),
          consentRecordId: consent!.id,
          consentPurpose: kind.consentPurpose,
          consentVersionTag: current.version,
          idempotencyKey,
          submittedAt,
        })
        .returning({
          id: applications.id,
          submittedAt: applications.submittedAt,
        });
      return {
        created: true as const,
        submittedAt: created!.submittedAt,
        result: {
          id: created!.id,
          submittedAt: created!.submittedAt.toISOString(),
        },
      };
    });
    if (outcome.created)
      this.notices.afterCommit({
        id: outcome.result.id,
        kind: "author",
        submittedAt: outcome.submittedAt,
        applicantUserId: userId,
        contact: null,
      });
    return outcome.result;
  }

  /**
   * EARS-10 — `GET /v1/me/applications?kind=author`: the caller's own author
   * applications that are not `closed`, newest first, each as
   * `{ id, submittedAt, topic, state: "received" }`. An erased application no
   * longer carries the applicant, so it is never read back. The topic comes
   * from the stored payload, never from a column an administrator writes.
   */
  async listOwnAuthor(sub: string): Promise<ApplicantApplicationList> {
    const userId = await this.accountId(sub);
    const rows = await this.db
      .select({
        id: applications.id,
        submittedAt: applications.submittedAt,
        topic: sql<string>`${applications.payload} ->> 'topic'`,
      })
      .from(applications)
      .where(
        and(
          eq(applications.kind, "author"),
          eq(applications.applicantUserId, userId),
          ne(applications.status, "closed"),
          isNull(applications.pdErasedAt),
        ),
      )
      .orderBy(desc(applications.submittedAt), desc(applications.id));
    return {
      items: rows.map((r) => ({
        id: r.id,
        submittedAt: r.submittedAt.toISOString(),
        topic: r.topic,
        state: "received" as const,
      })),
    };
  }

  /**
   * EARS-23 — close every open application whose last status change (or its
   * submission, if it never had one) is a year old: outcome `expired`, no
   * acting administrator, the time. Its one-year erasure term then runs from
   * that `closed_at` (EARS-20).
   */
  async expireStale(now: Date = this.clock()): Promise<number> {
    const expired = await withRequestAuditContext(this.db, (tx) =>
      tx
        .update(applications)
        .set({
          status: "closed",
          outcome: "expired",
          closedAt: now,
          statusChangedAt: now,
          statusChangedBy: null,
          version: sql`${applications.version} + 1`,
        })
        .where(
          and(
            sql`${applications.status} <> 'closed'`,
            sql`coalesce(${applications.statusChangedAt}, ${applications.submittedAt}) <= ${now.toISOString()}::timestamptz - interval '1 year'`,
          ),
        )
        .returning({ id: applications.id }),
    );
    return expired.length;
  }

  /** EARS-20 — erase every application closed for a year and not yet erased. */
  async eraseClosedDue(now: Date = this.clock()): Promise<number> {
    return withRequestAuditContext(this.db, async (tx) => {
      const due = await tx
        .select({ id: applications.id })
        .from(applications)
        .where(
          and(
            eq(applications.status, "closed"),
            isNull(applications.pdErasedAt),
            sql`${applications.closedAt} <= ${now.toISOString()}::timestamptz - interval '1 year'`,
          ),
        );
      let erased = 0;
      for (const row of due)
        if (await eraseApplication(tx, row.id, now)) erased++;
      return erased;
    });
  }

  /**
   * EARS-20 — one erasure on request in its own transaction (tests, tooling).
   * The admin `erase-personal-data` endpoint runs `eraseApplication` inside
   * its own idempotent command (`applications.admin.service.ts`).
   */
  async eraseOnRequest(id: string): Promise<boolean> {
    return withRequestAuditContext(this.db, (tx) =>
      eraseApplication(tx, id, this.clock()),
    );
  }

  /** EARS-24 — the account-erasure step in its own transaction (tests, tooling). */
  async eraseAccount(userId: string): Promise<number> {
    return withRequestAuditContext(this.db, (tx) =>
      eraseApplicationsOfAccount(userId, tx, this.clock()),
    );
  }

  private async accountId(sub: string): Promise<string> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.zitadelSub, sub))
      .limit(1);
    if (!user) throw new UnauthorizedException("authentication required");
    return user.id;
  }
}
