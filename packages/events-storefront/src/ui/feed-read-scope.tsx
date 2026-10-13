"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { type PluralNoun, formatEventCount } from "../model/event-count";
import type { EventsFeedSummary, FeedFacetOptions } from "../model/feed";

/**
 * What the page derives from its one feed read beside the day feed: the facet
 * option block (the column's and the sheet's groups, their labels), the sheet's
 * «Показать N» and the counted head subline.
 */
export interface RecoveredFeedReadValue {
  readonly facetOptions: FeedFacetOptions;
  readonly matching: number;
  readonly summary?: EventsFeedSummary | undefined;
}

type Scope = {
  readonly recovered: RecoveredFeedReadValue | null;
  readonly publish: (value: RecoveredFeedReadValue) => void;
};

const FeedReadContext = createContext<Scope | null>(null);

/**
 * The page's feed read as recovered by the day feed's «Повторить» (019 EARS-9,
 * #2832): a page whose feed read failed rendered its facets and subline
 * without it; the retry re-runs that same read, and what the page derives
 * from it is filled from the retried answer — no other read, no route
 * refresh, so the screen ends as a full load would leave it. When the server
 * renders the page again (a navigation), its own read replaces the recovered
 * one.
 */
export function FeedReadScope({ children }: { children: ReactNode }) {
  const [recovered, setRecovered] = useState<{
    readonly over: ReactNode;
    readonly value: RecoveredFeedReadValue;
  } | null>(null);
  const current = useRef(children);
  current.current = children;
  const publish = useCallback((value: RecoveredFeedReadValue) => {
    setRecovered({ over: current.current, value });
  }, []);
  return (
    <FeedReadContext.Provider
      value={{
        recovered:
          recovered !== null && recovered.over === children
            ? recovered.value
            : null,
        publish,
      }}
    >
      {children}
    </FeedReadContext.Provider>
  );
}

/** The recovered feed read of the page; `null` while the page's own read stands. */
export function useRecoveredFeedRead(): RecoveredFeedReadValue | null {
  return useContext(FeedReadContext)?.recovered ?? null;
}

/** The counted head subline «N эфиров · M школ» (gate row 19). */
export function SublineCounts({
  summary,
  eventNoun,
  schoolNoun,
}: {
  summary: EventsFeedSummary;
  eventNoun: PluralNoun;
  schoolNoun: PluralNoun;
}) {
  return (
    <span data-testid="events-feed-subline-counts">
      {formatEventCount(summary.events, eventNoun)} ·{" "}
      {formatEventCount(summary.schools, schoolNoun)}
    </span>
  );
}

/** The subline of a page whose feed read failed: the counts of a recovered read, else nothing. */
export function RecoveredSubline({
  eventNoun,
  schoolNoun,
}: {
  eventNoun: PluralNoun;
  schoolNoun: PluralNoun;
}) {
  const summary = useRecoveredFeedRead()?.summary;
  return summary === undefined ? null : (
    <SublineCounts
      summary={summary}
      eventNoun={eventNoun}
      schoolNoun={schoolNoun}
    />
  );
}

/**
 * Rendered by a day-feed retry that read the feed: hands the retried read to
 * the page's {@link FeedReadScope}.
 */
export function RecoveredFeedRead({
  facetOptions,
  matching,
  summary,
}: RecoveredFeedReadValue) {
  const publish = useContext(FeedReadContext)?.publish;
  useEffect(() => {
    publish?.({ facetOptions, matching, summary });
  }, [publish, facetOptions, matching, summary]);
  return null;
}
