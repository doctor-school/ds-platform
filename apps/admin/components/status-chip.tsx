"use client";

import { Badge } from "@ds/design-system";
import type {
  ApplicationOutcome,
  ApplicationStatus,
  FeedEntryAdminState,
  FeedSourceStatus,
  RelationshipStatus,
  TaxonomyStatus,
} from "@ds/schemas";

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

/**
 * 048 EARS-20 / EARS-31 — a feed source's check status, and its switched-on
 * state. «Не проверен» rides the `draft` pair: not yet known, not an error.
 */
const FEED_SOURCE_TONE: Record<FeedSourceStatus | FeedSourceState, string> = {
  unchecked: "bg-warning-tint text-foreground",
  ok: "bg-success-tint text-success-text",
  failing: "bg-destructive-tint text-destructive-text",
  enabled: "bg-success-tint text-success-text",
  disabled: "bg-destructive-tint text-destructive-text",
};

/**
 * 048 EARS-32 — a post's state in «Публикации»: «В ленте» on the success pair,
 * «Скрыт» on the destructive pair (an administrator took it out), «Источник
 * выключен» on the `draft` pair (out for a reason that is not the post's own);
 * EARS-47 «Удалён в VK» on the `draft` pair too — out of the feed because the
 * community removed it, not because an administrator did.
 */
const FEED_ENTRY_TONE: Record<FeedEntryAdminState, string> = {
  in_feed: "bg-success-tint text-success-text",
  hidden: "bg-destructive-tint text-destructive-text",
  source_off: "bg-warning-tint text-foreground",
  removed: "bg-warning-tint text-foreground",
};

/**
 * 033 EARS-13 — an application's status, or its outcome once closed. «Новая»
 * rides the `draft` pair (waits for an administrator), «На рассмотрении» the
 * plain card ground with a hairline, «Принята» the success pair, «Отклонена»
 * the destructive pair, «Истекла» the `draft` pair (closed by time, not by a
 * decision). A closed application always shows its outcome, so `closed` itself
 * is only the fallback of a closed row without one. EARS-11 «Команда не
 * уведомлена» (`not_notified`) rides the destructive pair: an application the
 * team may not know about yet.
 */
const APPLICATION_TONE: Record<
  ApplicationStatus | ApplicationOutcome | "not_notified",
  string
> = {
  new: "bg-warning-tint text-foreground",
  in_review: "border border-hairline bg-card text-foreground",
  closed: "border border-hairline bg-card text-muted-foreground",
  accepted: "bg-success-tint text-success-text",
  declined: "bg-destructive-tint text-destructive-text",
  expired: "bg-warning-tint text-foreground",
  not_notified: "bg-destructive-tint text-destructive-text",
};

/** «Включён» / «Выключен» of a feed source. */
export type FeedSourceState = "enabled" | "disabled";

const TONE: Record<string, string> = {
  ...TAXONOMY_TONE,
  ...RELATIONSHIP_TONE,
  ...FEED_SOURCE_TONE,
  ...FEED_ENTRY_TONE,
  ...APPLICATION_TONE,
};

export function StatusChip({
  status,
  label,
  testId,
}: {
  status:
    | TaxonomyStatus
    | RelationshipStatus
    | FeedSourceStatus
    | FeedSourceState
    | FeedEntryAdminState
    | ApplicationStatus
    | ApplicationOutcome
    | "not_notified";
  label: string;
  /**
   * Overrides the default `status-<value>` handle. Record pages carry a
   * per-resource handle (`direction-status`, …) because a record shows exactly
   * one chip and the assertion names the RESOURCE, not the value it happens to
   * hold this run.
   */
  testId?: string;
}) {
  return (
    <Badge className={TONE[status]} data-testid={testId ?? `status-${status}`}>
      {label}
    </Badge>
  );
}
