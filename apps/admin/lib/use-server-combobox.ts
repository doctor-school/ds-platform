"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ComboboxOption } from "@ds/design-system/blocks";
import {
  createSearchDebouncer,
  serverComboboxInitialState,
  serverComboboxLoadAction,
  serverComboboxNextPage,
  serverComboboxOptions,
  serverComboboxReducer,
  type ServerComboboxOption,
} from "@/lib/server-combobox";

/** The 250ms window the Expert selector established; one query per typing pause. */
export const SERVER_COMBOBOX_DEBOUNCE_MS = 250;
export const SERVER_COMBOBOX_PAGE_SIZE = 25;

export interface ServerComboboxPage<T> {
  data: T[];
  total: number;
  page: number;
}

export interface ServerComboboxController {
  options: ComboboxOption[];
  /** The first page of the current search is outstanding — show the busy cue. */
  isLoading: boolean;
  /** The first page failed; there is nothing to select from. */
  isError: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  /** Raw draft from the field — debounced here, never queried per keystroke. */
  search: (next: string) => void;
  /** Adopt an option the operator just picked so its label survives a re-search. */
  select: (id: string) => void;
  loadMore: () => Promise<void>;
}

/**
 * The ONE server-backed combobox hook (EARS-23). Callers supply only what is
 * genuinely theirs — how to fetch a page and how a row becomes an option — while
 * the debounce, the page merge and the loading/error transitions live in
 * `server-combobox.ts` and are shared by every selector in the admin.
 */
export function useServerCombobox<T>({
  fetchPage,
  toOption,
  selectedId,
  pageSize = SERVER_COMBOBOX_PAGE_SIZE,
  debounceMs = SERVER_COMBOBOX_DEBOUNCE_MS,
}: {
  fetchPage: (args: {
    q: string;
    page: number;
    pageSize: number;
  }) => Promise<ServerComboboxPage<T>>;
  toOption: (item: T) => ServerComboboxOption;
  /** The value the host form currently holds, kept visible while searching. */
  selectedId?: string | null;
  pageSize?: number;
  debounceMs?: number;
}): ServerComboboxController {
  const [state, dispatch] = useReducer(
    serverComboboxReducer,
    serverComboboxInitialState,
  );
  const [selected, setSelected] = useState<ServerComboboxOption | null>(null);

  // The callers rebuild these every render (they close over form state); the
  // effect below must not re-query because an identity changed.
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const toOptionRef = useRef(toOption);
  toOptionRef.current = toOption;
  const stateRef = useRef(state);
  stateRef.current = state;

  const debouncer = useMemo(
    () => createSearchDebouncer(debounceMs),
    [debounceMs],
  );
  useEffect(() => () => debouncer.cancel(), [debouncer]);

  const { q, epoch } = state;
  useEffect(() => {
    let active = true;
    void fetchRef
      .current({ q, page: 1, pageSize })
      .then((result) => {
        if (!active) return;
        dispatch({
          type: "pageSettled",
          epoch,
          items: result.data.map((item) => toOptionRef.current(item)),
          page: result.page,
          total: result.total,
        });
      })
      .catch(() => {
        if (active) dispatch({ type: "pageFailed", epoch });
      });
    return () => {
      active = false;
    };
  }, [epoch, pageSize, q]);

  // Adopt the option the host's current value points at as soon as a page
  // carries it, so the selector shows a name rather than a bare id.
  useEffect(() => {
    if (!selectedId) return;
    const match = state.items.find((item) => item.id === selectedId);
    if (match) setSelected(match);
  }, [selectedId, state.items]);

  const options = useMemo(
    () =>
      serverComboboxOptions(
        state,
        selected && selected.id === selectedId ? selected : null,
      ),
    [selected, selectedId, state],
  );

  const search = useCallback(
    (next: string) => {
      const normalized = next.trim();
      debouncer.schedule(() => {
        if (normalized === stateRef.current.q) return;
        dispatch({ type: "search", q: normalized });
      });
    },
    [debouncer],
  );

  const select = useCallback((id: string) => {
    const match = stateRef.current.items.find((item) => item.id === id) ?? null;
    if (match) setSelected(match);
  }, []);

  const loadMore = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (current.isLoading || current.loadingMore) return;
    // A failed page never advanced `page`, so retry and first attempt ask for
    // the same one — including a failed FIRST page, whose retry asks for page 1
    // and lands as a replacement. Only an exhausted, healthy list is a no-op.
    if (serverComboboxLoadAction(current, pageSize) === null) return;
    const nextPage = serverComboboxNextPage(current);
    const { epoch: issuedAt } = current;
    dispatch({ type: "loadMore" });
    try {
      const result = await fetchRef.current({
        q: current.q,
        page: nextPage,
        pageSize,
      });
      dispatch({
        type: "pageSettled",
        epoch: issuedAt,
        items: result.data.map((item) => toOptionRef.current(item)),
        page: result.page,
        total: result.total,
      });
    } catch {
      dispatch({ type: "pageFailed", epoch: issuedAt });
    }
  }, [pageSize]);

  return {
    options,
    isLoading: state.isLoading,
    isError: state.isError,
    // `hasMore` is what makes `Combobox` render the foot control at all, so a
    // retry-able error has to answer true — otherwise a failed first page is a
    // dead end (#1660 review).
    hasMore: serverComboboxLoadAction(state, pageSize) !== null,
    loadingMore: state.loadingMore,
    loadMoreError: state.loadMoreError,
    search,
    select,
    loadMore,
  };
}
