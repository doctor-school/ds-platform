import type { EventKind } from "@ds/db";
import type { EventParticipationFormat } from "@ds/schemas";

// 012 EARS-26 (#2509) — the one rule every admin event write seam applies to
// the event's kind and participation format, read inside the write transaction
// against the locked kind row so a kind retired or narrowed concurrently cannot
// slip an event past it.

/** The event fields a classification refusal names (field errors, not 500s). */
export type EventClassificationField = "kindId" | "participationFormat";

/**
 * A deterministic refusal of an event write's classification. The admin
 * controllers map it to the same 400 «invalid event payload» body a contract
 * failure answers, with `issues[].path = [field]`, so the form marks the field.
 */
export class EventClassificationError extends Error {
  constructor(
    readonly field: EventClassificationField,
    message: string,
  ) {
    super(message);
    this.name = "EventClassificationError";
  }
}

/**
 * The effective `(kind, format)` an event write would leave behind must be one
 * the kind allows, and the kind must be a published, non-retired dictionary row.
 * `kind` is `null` when the id resolves to no row. Applied on create AND on every
 * save; together with the refused narrowing (EARS-25) no event ever holds a
 * format its kind disallows.
 */
export function assertEventClassification(
  kind: Pick<EventKind, "status" | "deletedAt" | "allowedFormats" | "title"> | null,
  format: EventParticipationFormat,
): void {
  if (!kind) {
    throw new EventClassificationError("kindId", "unknown event kind");
  }
  if (kind.status !== "published" || kind.deletedAt !== null) {
    throw new EventClassificationError(
      "kindId",
      kind.status === "retired"
        ? "this event kind is retired; choose another kind"
        : "this event kind is not published yet; choose a published kind",
    );
  }
  if (!kind.allowedFormats.includes(format)) {
    throw new EventClassificationError(
      "participationFormat",
      `the kind «${kind.title}» does not allow the ${format} format`,
    );
  }
}

/** Zod-issue-shaped body the admin controllers answer a classification refusal with. */
export function classificationProblem(err: EventClassificationError): {
  message: string;
  issues: Array<{ code: "custom"; path: string[]; message: string }>;
} {
  return {
    message: "invalid event payload",
    issues: [{ code: "custom", path: [err.field], message: err.message }],
  };
}
