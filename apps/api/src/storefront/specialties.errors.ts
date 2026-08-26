import { HttpException } from "@nestjs/common";
import type {
  SpecialtyErrorCode,
  SpecialtyProblemDetails,
} from "@ds/schemas";
// `PROBLEM_TYPE_BASE` and `resolveTraceId` are transport-level, not
// taxonomy-specific: the `type` URI namespace and the W3C `traceparent`
// preference are platform contracts (ADR-0002), and a second copy here would be
// a second source of truth for the same two facts. They are imported from their
// current home rather than duplicated; lifting them into a shared problem module
// is recorded as a DEBT.md line rather than done inside this slice.
import {
  PROBLEM_TYPE_BASE,
  resolveTraceId,
} from "../taxonomy/taxonomy.errors.js";

export { resolveTraceId };

// 017-design §7 / EARS-3 — every storefront specialty failure is
// `application/problem+json` with the RFC 7807 fields plus the two platform
// fields `errorCode` and `traceId`, and NO database key, table name or internal
// lifecycle state. Status and title are derived from the code, so a throw site
// cannot pick a wrong pair.

/** The exact status for each stable code. */
export const SPECIALTY_ERROR_STATUS: Readonly<
  Record<SpecialtyErrorCode, number>
> = {
  // 422, not 404 and not 400: the reference is syntactically fine and the route
  // exists — it simply names no member of a CLOSED book, which is a semantic
  // refusal of the submitted value.
  SPECIALTY_NOT_IN_BOOK: 422,
};

/** Stable, non-disclosing titles — never echo the submitted value or a key. */
const SPECIALTY_ERROR_TITLE: Readonly<Record<SpecialtyErrorCode, string>> = {
  SPECIALTY_NOT_IN_BOOK: "Specialty is not in the reference book",
};

/**
 * The single storefront specialty failure. It carries the stable `errorCode`
 * the client branches on (never English exception text) and builds its own wire
 * body, so the bytes a filter sends and the bytes a unit test asserts come from
 * one place.
 */
export class SpecialtyError extends HttpException {
  constructor(
    readonly errorCode: SpecialtyErrorCode,
    readonly detail?: string,
  ) {
    super(SPECIALTY_ERROR_TITLE[errorCode], SPECIALTY_ERROR_STATUS[errorCode]);
  }

  toProblemDetails(traceId: string, instance?: string): SpecialtyProblemDetails {
    return {
      type: `${PROBLEM_TYPE_BASE}/${this.errorCode.toLowerCase().replace(/_/g, "-")}`,
      title: SPECIALTY_ERROR_TITLE[this.errorCode],
      status: SPECIALTY_ERROR_STATUS[this.errorCode],
      ...(this.detail ? { detail: this.detail } : {}),
      ...(instance ? { instance } : {}),
      errorCode: this.errorCode,
      traceId,
    };
  }
}
