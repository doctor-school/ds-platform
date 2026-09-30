import type { CongressSubmissionStatus } from "@ds/schemas";
import { cn } from "@ds/design-system/lib/utils";

import { STATUS_LABEL } from "../copy";

/**
 * The status marks of the canvas (`design-source/doctor-lk-congress.dc.html`,
 * `DOT` / `POSTER`): a 10px square dot per status beside the label in the
 * list, and the rotated plate on the navy poster band of an open submission.
 * Non-interactive marks — spans on tokens only.
 */

const DOT: Record<CongressSubmissionStatus, string> = {
  draft: "border-2 border-faint",
  submitted: "bg-primary",
  in_review: "border-2 border-primary",
  accepted: "bg-success",
  rejected: "bg-destructive",
  needs_revision: "bg-warning",
  withdrawn: "bg-faint",
};

export function StatusDot({ status }: { status: CongressSubmissionStatus }) {
  return (
    <span
      aria-hidden="true"
      data-status-dot={status}
      className={cn("inline-block size-2.5 flex-none", DOT[status])}
    />
  );
}

/**
 * The label beside the dot. The canvas paints «На доработке» in its warning
 * ink; that ink is under 4.5:1 on white at 13px, so the label keeps the page
 * ink at the heavier weight and the warning colour stays on the dot (AA).
 */
export function StatusLabel({ status }: { status: CongressSubmissionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap py-0.5 text-caption",
        status === "needs_revision" ? "font-bold" : "font-semibold",
        status === "withdrawn" ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <StatusDot status={status} />
      <span>{STATUS_LABEL[status]}</span>
    </span>
  );
}

const PLATE: Partial<Record<CongressSubmissionStatus, string>> = {
  draft: "border-2 border-dashed border-chip-border text-hero-muted",
  rejected: "border-2 border-header-hairline text-hero-muted",
  withdrawn: "border-2 border-header-hairline text-hero-muted",
  accepted: "bg-success-tint text-success-text shadow-header-chip",
};

/** The rotated status plate on the poster band of an open submission. */
export function StatusPlate({ status }: { status: CongressSubmissionStatus }) {
  return (
    <span
      data-testid="congress-status-plate"
      className={cn(
        "flex-none rotate-3 whitespace-nowrap px-5 py-3 text-caption font-extrabold uppercase tracking-eyebrow",
        PLATE[status] ??
          "bg-white text-header-chip-foreground shadow-header-chip",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
