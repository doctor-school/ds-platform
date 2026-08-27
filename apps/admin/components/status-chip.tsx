"use client";

import { Badge } from "@ds/design-system";
import type { RelationshipStatus, TaxonomyStatus } from "@ds/schemas";

/**
 * The list/record status chip (017 EARS-18; `constitution.md` → DataTable «Token /
 * primitive mapping»). It is the design-system `Badge` carrying a SEMANTIC tint
 * pair, never the default `label` variant: that variant's `bg-tint` is the very
 * fill `DataTable` uses for `hover:bg-tint`, so a default chip dissolves into the
 * row under the cursor. A semantic tint never collides with the hover ground.
 *
 * `draft` rides `text-foreground` rather than a `warning-text`: the token set has
 * `success-text` and `destructive-text` but NO `warning-text`, and
 * `warning-foreground` is the near-black ink for the warning FILL — unreadable on
 * the dark-theme `warning-tint`. Inventing the missing token is out of 017's
 * scope; it is recorded as design-system debt.
 */
const TAXONOMY_TONE: Record<TaxonomyStatus, string> = {
  draft: "bg-warning-tint text-foreground",
  published: "bg-success-tint text-success-text",
  retired: "bg-destructive-tint text-destructive-text",
};

const RELATIONSHIP_TONE: Record<RelationshipStatus, string> = {
  active: "bg-success-tint text-success-text",
  retired: "bg-destructive-tint text-destructive-text",
};

const TONE: Record<string, string> = { ...TAXONOMY_TONE, ...RELATIONSHIP_TONE };

export function StatusChip({
  status,
  label,
}: {
  status: TaxonomyStatus | RelationshipStatus;
  label: string;
}) {
  return (
    <Badge className={TONE[status]} data-testid={`status-${status}`}>
      {label}
    </Badge>
  );
}
