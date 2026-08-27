"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeSpecialtyQuery, type SpecialtyRef } from "@ds/schemas";
import {
  SpecialtyCatalogView,
  type SpecialtyCatalogState,
} from "@/components/specialty-catalog-view";
import {
  fetchFrequentSpecialties,
  fetchSpecialtyBook,
  searchSpecialties,
} from "@/lib/specialties";

/**
 * 017 EARS-4 / EARS-5 — the reads and the §3 state machine behind the home-page
 * specialty catalog (Stage-A variant Б). The drawing is
 * `components/specialty-catalog-view.tsx`; this file decides only WHICH state.
 *
 * A client component for the same reason `scale-counters.tsx` is one: §3 has a
 * Loading state and §6 an error render that leaves the rest of the page
 * standing, and both are states of a fetch that must happen after the page is on
 * screen. Nothing else on the home page depends on this section resolving —
 * that is EARS-4's «no modal gate, interstitial, scroll lock or empty page keyed
 * on the absence of a choice», expressed structurally rather than promised.
 *
 * TWO reads on mount, ONE per keystroke burst:
 *
 *  • the book (its `total` is the ONE source of the «Показать весь список — N»
 *    count) and the frequent set, in parallel;
 *  • the search read, debounced, on the whole book — never a local filter over
 *    a client-side copy, so the narrowing a doctor sees is the platform's own
 *    rule and not a second implementation of it that could drift.
 *
 * Every fetch is abort-scoped: an unmount, a retry or a superseding keystroke
 * cancels the one before it, so a slow earlier response can never overwrite a
 * newer one — the classic search race, closed by construction rather than by
 * comparing timestamps.
 */

type BookState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; total: number; entries: SpecialtyRef[] };

/** Debounce before the search read — long enough to coalesce a burst of typing,
 * short enough that the result feels like a consequence of the keystroke. */
const SEARCH_DEBOUNCE_MS = 150;

export function SpecialtyCatalog() {
  const [book, setBook] = useState<BookState>({ kind: "loading" });
  const [frequent, setFrequent] = useState<SpecialtyRef[]>([]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [matches, setMatches] = useState<SpecialtyRef[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [searchKey, setSearchKey] = useState(0);

  const normalized = normalizeSpecialtyQuery(query);
  const isSearching = normalized.length > 0;

  // The book + the frequent set. They resolve together: a catalog with a book
  // and no frequent set has no Open state to draw, so both feed one status.
  useEffect(() => {
    const controller = new AbortController();
    setBook({ kind: "loading" });

    Promise.all([
      fetchSpecialtyBook(fetch, controller.signal),
      fetchFrequentSpecialties(fetch, controller.signal),
    ])
      .then(([served, frequentSet]) => {
        if (controller.signal.aborted) return;
        setBook({
          kind: "ready",
          total: served.total,
          entries: served.entries,
        });
        setFrequent(frequentSet.entries);
      })
      .catch(() => {
        // Transport, status, or a body that violates the shared contract — one
        // surface for all three. A book the storefront cannot trust is not
        // rendered with a made-up count.
        if (!controller.signal.aborted) setBook({ kind: "error" });
      });

    return () => controller.abort();
  }, [reloadKey]);

  // The search read, debounced. An empty query is not a request: it IS the Open
  // state, so the match set is dropped rather than re-fetched as "everything".
  const latest = useRef(0);
  useEffect(() => {
    if (!isSearching) {
      setMatches(null);
      setSearching(false);
      setSearchFailed(false);
      return;
    }

    const controller = new AbortController();
    const generation = ++latest.current;
    setSearching(true);
    setSearchFailed(false);

    const timer = setTimeout(() => {
      searchSpecialties(query, fetch, controller.signal)
        .then((result) => {
          if (controller.signal.aborted || generation !== latest.current) return;
          setMatches(result.entries);
          setSearching(false);
        })
        .catch(() => {
          if (controller.signal.aborted || generation !== latest.current) return;
          // A failed NARROWING is its own state, not the section's error and not
          // a silent empty result: «ничего не найдено» would be a lie about the
          // book, and replacing the section would take the field, the typed
          // query and both routes to «Другое» down with it — which is precisely
          // what EARS-5 requires to stay standing. The book is untouched here.
          setMatches(null);
          setSearchFailed(true);
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, isSearching, searchKey]);

  const onQueryChange = useCallback((next: string) => {
    setQuery(next);
    // §3: Expanded → Filtered on typing. The expanded list is not a second
    // surface layered under the search — typing replaces it.
    if (normalizeSpecialtyQuery(next).length > 0) setExpanded(false);
  }, []);

  const onToggleExpand = useCallback(() => {
    // From a Filtered or NoMatch render the control is the recovery path EARS-5
    // requires: it clears the query and reveals the whole book, «Другое»
    // included, rather than expanding underneath a filter that still hides it.
    setQuery("");
    setExpanded((wasExpanded) => (isSearching ? true : !wasExpanded));
  }, [isSearching]);

  /**
   * Retry re-runs the read that FAILED, not a fixed one: a failed search must
   * re-issue the search (its effect keys on `searchKey`, and neither `query` nor
   * `isSearching` changed, so nothing else would re-run it), while a failed book
   * re-runs the book. Bumping only the book key on a search failure would leave
   * the match set unresolved and the section rendering an answer nothing asked.
   */
  const onRetry = useCallback(() => {
    if (searchFailed) setSearchKey((n) => n + 1);
    else setReloadKey((n) => n + 1);
  }, [searchFailed]);

  /**
   * Choosing a specialty is #1482. This seam exists so the chips are real
   * controls rather than decoration, and it deliberately changes NOTHING on
   * screen: a toast or a collapsed row here would tell a doctor the platform
   * remembered a choice that nothing recorded.
   */
  const onSelect = useCallback((_entry: SpecialtyRef) => {}, []);

  const state = useMemo<SpecialtyCatalogState>(() => {
    if (book.kind !== "ready") return { kind: book.kind };

    if (isSearching) {
      // A narrowing with no answer yet — in flight or failed — draws NO entries.
      // The alternative (falling back to the frequent set) would present rows
      // that are not the matches for the query in the field.
      if (matches === null) {
        return {
          kind: "ready",
          total: book.total,
          entries: [],
          view: searchFailed ? "searchfailed" : "searching",
          busy: searching,
        };
      }
      return {
        kind: "ready",
        total: book.total,
        entries: matches,
        view: !searching && matches.length === 0 ? "nomatch" : "filtered",
        busy: searching,
      };
    }

    return {
      kind: "ready",
      total: book.total,
      entries: expanded ? book.entries : frequent,
      view: expanded ? "expanded" : "open",
      busy: false,
    };
  }, [book, frequent, matches, searching, searchFailed, isSearching, expanded]);

  return (
    <SpecialtyCatalogView
      state={state}
      query={query}
      onQueryChange={onQueryChange}
      onToggleExpand={onToggleExpand}
      onRetry={onRetry}
      onSelect={onSelect}
    />
  );
}
