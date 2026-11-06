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
// filter of the slice that adds HTTP (#3813) and the tests share one source.
// No title calls Pul «бесплатно» or points «баллы» (EARS-30).

export const POINTS_LEDGER_ERROR_STATUS: Readonly<
  Record<PointsLedgerErrorCode, number>
> = {
  // 409: the fact is well-formed; the account's state refuses it.
  POINTS_ACCOUNT_CLOSED: 409,
  POINTS_INSUFFICIENT_PUL: 409,
};

const POINTS_LEDGER_ERROR_TITLE: Readonly<
  Record<PointsLedgerErrorCode, string>
> = {
  POINTS_ACCOUNT_CLOSED: "The attention-points account is closed",
  POINTS_INSUFFICIENT_PUL: "Not enough Pul available for this posting",
};

/** Problem `type` slug: `POINTS_ACCOUNT_CLOSED` → `points-account-closed`. */
export function pointsProblemSlug(code: PointsLedgerErrorCode): string {
  return code.toLowerCase().replace(/_/g, "-");
}

export class PointsLedgerError extends HttpException {
  constructor(
    readonly errorCode: PointsLedgerErrorCode,
    readonly detail?: string,
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
      traceId,
    };
  }
}
