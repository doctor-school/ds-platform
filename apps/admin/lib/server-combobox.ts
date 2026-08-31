import type { ComboboxOption } from "@ds/design-system/blocks";

/**
 * THE state layer of every server-backed selector in the admin (EARS-23: "use the
 * shared search/select combobox"). `@ds/design-system` owns the `Combobox`
 * PRESENTATION; what a server-backed selector additionally needs — a debounced
 * search, bounded pages merged as the operator loads more, and the loading /
 * error / loading-more states that go with them — is this module, once.
 *
 * It replaces two parallel implementations: the Refine-`useCustom` relationship
 * picker (#1638 M1: one API call per keystroke, no debounce) and the bespoke
 * nine-state-variable machine inlined in `expert-form.tsx` (#1638 M4: a new search
 * invalidated the in-flight request epoch without re-arming the loading flag, so
 * the selector sat on a stale empty list). Both defects are properties of the
 * transition table, which is why the transition table is a pure reducer here and
 * is tested as one rather than only through a browser.
 */

export interface ServerComboboxOption {
  id: string;
  label: string;
  /** Secondary line (an Expert User's email/phone identifier, say). */
  description?: string;
}

export interface ServerComboboxState {
  /** The committed search — post-debounce, never the in-field draft. */
  q: string;
  /** Highest server page merged in; `0` while the first page is outstanding. */
  page: number;
  total: number;
  items: ServerComboboxOption[];
  isLoading: boolean;
  isError: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  /**
   * Monotonic id of the CURRENT request generation. Every settle carries the
   * epoch it was issued under, so a page that lands after the operator typed
   * again is dropped instead of overwriting the newer search.
   */
  epoch: number;
}

export type ServerComboboxAction =
  | { type: "search"; q: string }
  | { type: "loadMore" }
  | {
      type: "pageSettled";
      epoch: number;
      items: ServerComboboxOption[];
      page: number;
      total: number;
    }
  | { type: "pageFailed"; epoch: number };

export const serverComboboxInitialState: ServerComboboxState = {
  q: "",
  page: 0,
  total: 0,
  items: [],
  isLoading: true,
  isError: false,
  loadingMore: false,
  loadMoreError: false,
  epoch: 0,
};

/** Append a server page without duplicating an id; the newest row for an id wins. */
export function mergeServerComboboxPages<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

export function serverComboboxReducer(
  state: ServerComboboxState,
  action: ServerComboboxAction,
): ServerComboboxState {
  switch (action.type) {
    case "search":
      // EARS-23 immediate apply: the committed search REPLACES the result set,
      // and — the M4 fix — re-arms `isLoading` in the same transition that
      // invalidates the epoch. Leaving it false here is what left the previous
      // implementation showing an empty list with no busy cue.
      return {
        ...state,
        q: action.q,
        page: 0,
        total: 0,
        items: [],
        isLoading: true,
        isError: false,
        loadingMore: false,
        loadMoreError: false,
        epoch: state.epoch + 1,
      };
    case "loadMore":
      if (state.isLoading || state.loadingMore) return state;
      return { ...state, loadingMore: true, loadMoreError: false };
    case "pageSettled": {
      if (action.epoch !== state.epoch) return state;
      const isFirstPage = action.page <= 1;
      return {
        ...state,
        items: isFirstPage
          ? [...action.items]
          : mergeServerComboboxPages(state.items, action.items),
        page: action.page,
        total: action.total,
        isLoading: false,
        isError: false,
        loadingMore: false,
        loadMoreError: false,
      };
    }
    case "pageFailed": {
      if (action.epoch !== state.epoch) return state;
      // A failed FIRST page has nothing to show, so it is the selector's error;
      // a failed load-more keeps every option already listed and offers a retry.
      return state.loadingMore
        ? { ...state, loadingMore: false, loadMoreError: true }
        : { ...state, isLoading: false, isError: true };
    }
    default:
      return state;
  }
}

/** A further server page exists only once the first one has actually landed. */
export function serverComboboxHasMore(
  state: ServerComboboxState,
  pageSize: number,
): boolean {
  if (state.page < 1) return false;
  return state.page * pageSize < state.total;
}

/**
 * The options handed to `Combobox`, with the selected row kept visible even when
 * the current search does not return it — otherwise narrowing the search blanks
 * the operator's own choice.
 */
export function serverComboboxOptions(
  state: ServerComboboxState,
  selected: ServerComboboxOption | null,
): ComboboxOption[] {
  const retained =
    selected && !state.items.some((item) => item.id === selected.id)
      ? [selected]
      : [];
  return [...retained, ...state.items].map((item) => ({
    value: item.id,
    label: item.label,
    ...(item.description ? { description: item.description } : {}),
  }));
}

export interface SearchDebouncer {
  schedule: (run: () => void) => void;
  cancel: () => void;
}

/**
 * One pending commit at a time: each keystroke replaces the previous window, so a
 * burst of typing is one server query rather than one per character (#1638 M1).
 */
export function createSearchDebouncer(waitMs: number): SearchDebouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    schedule(run) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        run();
      }, waitMs);
    },
    cancel,
  };
}
