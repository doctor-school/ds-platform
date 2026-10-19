import { EventPageSkeleton as Skeleton } from "@ds/design-system/blocks";

import { EVENT_PAGE_COPY as COPY } from "../copy/event-page-copy";

/**
 * 020 EARS-19 (wave-3 gate row 29, D8) — the event page's loading state: the
 * design-system canvas skeleton with the page's copy, mounted as each host's
 * event-page `loading.tsx` and nothing else.
 */
export function EventPageSkeleton() {
  return <Skeleton label={COPY.loading} />;
}
