import { HttpException } from "@nestjs/common";

/**
 * #1304 — the refusal vocabulary of the live admin-authority revalidation tier.
 *
 * These codes are owned HERE rather than in the 012 `TaxonomyErrorCode` union on
 * purpose: they are auth-tier verdicts about the *principal*, not outcomes of a
 * taxonomy command, and every `revalidate: "live"` route — today the 012 admin
 * mutations, tomorrow the ADR-0009 erasure-plan approval — must answer with the
 * same five codes regardless of which slice owns the handler. Two of them
 * (`ADMIN_SESSION_REQUIRED`, `PLATFORM_ADMIN_REQUIRED`) are deliberately the
 * SAME strings 012 already publishes, so a client that learned the 012 contract
 * sees no new shape when the refusal starts coming from the guard instead of the
 * handler.
 */
export type AdminAuthorityErrorCode =
  | "ADMIN_SESSION_REQUIRED"
  | "PLATFORM_ADMIN_REQUIRED"
  | "PD_OFFICER_REQUIRED"
  | "STEP_UP_REQUIRED"
  | "IDP_REVALIDATION_UNAVAILABLE";

/** The exact status each refusal answers with. */
export const ADMIN_AUTHORITY_STATUS: Readonly<
  Record<AdminAuthorityErrorCode, number>
> = {
  ADMIN_SESSION_REQUIRED: 401,
  PLATFORM_ADMIN_REQUIRED: 403,
  PD_OFFICER_REQUIRED: 403,
  STEP_UP_REQUIRED: 401,
  IDP_REVALIDATION_UNAVAILABLE: 503,
};

/** Stable, non-disclosing titles — never echo a subject, session id or role list. */
const ADMIN_AUTHORITY_TITLE: Readonly<
  Record<AdminAuthorityErrorCode, string>
> = {
  ADMIN_SESSION_REQUIRED: "Admin session required",
  PLATFORM_ADMIN_REQUIRED: "platform_admin required",
  PD_OFFICER_REQUIRED: "pd_officer required",
  STEP_UP_REQUIRED: "Fresh step-up verification required",
  IDP_REVALIDATION_UNAVAILABLE: "Identity provider unavailable",
};

/** The RFC 7807 `type` URI namespace — the same docs anchor 012 publishes under. */
export const PROBLEM_TYPE_BASE = "https://docs.doctor.school/errors";

/** The wire body of an authority refusal, minus the per-request `traceId`/`instance`. */
export interface AdminAuthorityProblem {
  type: string;
  title: string;
  status: number;
  errorCode: AdminAuthorityErrorCode;
  /** Only on `STEP_UP_REQUIRED`: where the operator re-elevates (ADR-0001 §10). */
  stepUpUrl?: string;
}

/**
 * The single failure type `AdminAuthorityGuard` throws.
 *
 * It carries a fully-formed Problem Details body as its `HttpException`
 * response, for one reason: the guard is GLOBAL, so its refusals surface under
 * two different exception filters — the 012-scoped {@link TaxonomyProblemFilter}
 * on the taxonomy controllers, and Nest's default filter everywhere else. Both
 * serialize an object response verbatim, so the client sees the same
 * `errorCode` either way and the shape is a property of the throw, not of which
 * slice happened to catch it. A guard that threw a bare `ForbiddenException`
 * would have its code invented by whichever filter was in range — which is
 * exactly how `IDP_REVALIDATION_UNAVAILABLE` would have degraded into an opaque
 * 500 (the 012 filter maps only 401/403/404/415/400 by status).
 */
export class AdminAuthorityException extends HttpException {
  constructor(
    readonly errorCode: AdminAuthorityErrorCode,
    /** Only meaningful on `STEP_UP_REQUIRED`. */
    readonly stepUpUrl?: string,
  ) {
    super(
      adminAuthorityProblem(errorCode, stepUpUrl),
      ADMIN_AUTHORITY_STATUS[errorCode],
    );
  }
}

/** Build the wire body for an authority refusal. */
export function adminAuthorityProblem(
  errorCode: AdminAuthorityErrorCode,
  stepUpUrl?: string,
): AdminAuthorityProblem {
  return {
    type: `${PROBLEM_TYPE_BASE}/${errorCode.toLowerCase().replace(/_/g, "-")}`,
    title: ADMIN_AUTHORITY_TITLE[errorCode],
    status: ADMIN_AUTHORITY_STATUS[errorCode],
    errorCode,
    ...(stepUpUrl ? { stepUpUrl } : {}),
  };
}
