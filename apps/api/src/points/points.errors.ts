import { HttpException } from "@nestjs/common";
import type {
  PointsLedgerErrorCode,
  PointsLedgerProblemDetails,
} from "@ds/schemas";
import { PROBLEM_TYPE_BASE } from "../taxonomy/taxonomy.errors.js";

// 025 ledger-core refusals. Every engine failure is RFC 7807 problem+json with
// the platform `errorCode` + `traceId` (ADR-0002), mirroring
// `storefront/specialties.errors.ts`: status and title derive from the code so
// a throw site cannot pick a wrong pair, and the wire body is built here so the
// `PointsProblemFilter` (#3808 adds the first HTTP route) and the tests share
// one source.
// No title calls Pul «бесплатно» or points «баллы» (EARS-30).

export const POINTS_LEDGER_ERROR_STATUS: Readonly<
  Record<PointsLedgerErrorCode, number>
> = {
  // 409: the fact is well-formed; the account's state refuses it.
  POINTS_ACCOUNT_CLOSED: 409,
  POINTS_INSUFFICIENT_PUL: 409,
  // 422: the fact itself is unprocessable — dated beyond the clock-skew bound.
  POINTS_OCCURRED_AT_FUTURE: 422,
  // 422: no rule may express a penalty or a conversion (EARS-12).
  POINTS_BRE_CON_DEBIT: 422,
  // 422: a debit-side effect for a person whose phone is unverified (EARS-5).
  POINTS_PHONE_UNVERIFIED: 422,
  // Amended EARS-25 publish refusals.
  POINTS_RULE_PARAMETERS_INVALID: 422,
  POINTS_RULE_RETIRED: 422,
  POINTS_RULE_EFFECTIVE_FROM_PAST: 422,
  // 400: the posting-history page query is malformed (EARS-46).
  POINTS_HISTORY_QUERY_INVALID: 400,
};

const POINTS_LEDGER_ERROR_TITLE: Readonly<
  Record<PointsLedgerErrorCode, string>
> = {
  POINTS_ACCOUNT_CLOSED: "The attention-points account is closed",
  POINTS_INSUFFICIENT_PUL: "Not enough Pul available for this posting",
  POINTS_OCCURRED_AT_FUTURE: "The fact is dated too far in the future",
  POINTS_BRE_CON_DEBIT: "Bre and Con are never debited from a person account",
  POINTS_PHONE_UNVERIFIED: "Pul can be spent only once the phone is verified",
  POINTS_RULE_PARAMETERS_INVALID: "The rule parameters are invalid",
  POINTS_RULE_RETIRED: "This attention-points rule id is retired",
  POINTS_RULE_EFFECTIVE_FROM_PAST:
    "A rule version cannot take effect in the past",
  POINTS_HISTORY_QUERY_INVALID: "The posting history page query is invalid",
};

/** Problem `type` slug: `POINTS_ACCOUNT_CLOSED` → `points-account-closed`. */
export function pointsProblemSlug(code: PointsLedgerErrorCode): string {
  return code.toLowerCase().replace(/_/g, "-");
}

export class PointsLedgerError extends HttpException {
  constructor(
    readonly errorCode: PointsLedgerErrorCode,
    readonly detail?: string,
    readonly fieldErrors?: ReadonlyArray<{ path: string; message: string }>,
  ) {
    super(
      POINTS_LEDGER_ERROR_TITLE[errorCode],
      POINTS_LEDGER_ERROR_STATUS[errorCode],
    );
  }

  /** The RFC 7807 slug of this refusal, e.g. `points-account-closed`. */
  get problem(): string {
    return pointsProblemSlug(this.errorCode);
  }

  toProblemDetails(
    traceId: string,
    instance?: string,
  ): PointsLedgerProblemDetails {
    return {
      type: `${PROBLEM_TYPE_BASE}/${this.problem}`,
      title: POINTS_LEDGER_ERROR_TITLE[this.errorCode],
      status: POINTS_LEDGER_ERROR_STATUS[this.errorCode],
      ...(this.detail ? { detail: this.detail } : {}),
      ...(instance ? { instance } : {}),
      errorCode: this.errorCode,
      ...(this.fieldErrors ? { errors: [...this.fieldErrors] } : {}),
      traceId,
    };
  }
}
