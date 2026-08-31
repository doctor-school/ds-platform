import { describe, expect, it, vi } from "vitest";

import {
  createSearchDebouncer,
  mergeServerComboboxPages,
  pruneComboboxOptions,
  serverComboboxHasMore,
  serverComboboxInitialState,
  serverComboboxLoadAction,
  serverComboboxNextPage,
  serverComboboxOptions,
  serverComboboxReducer,
  type ServerComboboxOption,
} from "@/lib/server-combobox";

const option = (id: string, label = id): ServerComboboxOption => ({
  id,
  label,
});

describe("server-backed combobox state (EARS-23)", () => {
  it("EARS-23.1: pages in load-more results without duplicating an already listed option", () => {
    const searched = serverComboboxReducer(serverComboboxInitialState, {
      type: "pageSettled",
      epoch: 0,
      items: [option("a"), option("b")],
      page: 1,
      total: 4,
    });
    expect(serverComboboxHasMore(searched, 2)).toBe(true);

    const more = serverComboboxReducer(
      serverComboboxReducer(searched, { type: "loadMore" }),
      {
        type: "pageSettled",
        epoch: 0,
        items: [option("b"), option("c")],
        page: 2,
        total: 3,
      },
    );

    expect(more.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(more.page).toBe(2);
    expect(more.loadingMore).toBe(false);
    expect(serverComboboxHasMore(more, 2)).toBe(false);
  });

  it("EARS-23.1: hides load-more while the first page is still loading", () => {
    const loading = serverComboboxReducer(serverComboboxInitialState, {
      type: "search",
      q: "кар",
    });

    expect(loading.isLoading).toBe(true);
    expect(serverComboboxHasMore(loading, 2)).toBe(false);
  });

  it("EARS-23.2: applies a new search immediately, dropping the previous page set", () => {
    const listed = serverComboboxReducer(serverComboboxInitialState, {
      type: "pageSettled",
      epoch: 0,
      items: [option("a")],
      page: 1,
      total: 9,
    });

    const searching = serverComboboxReducer(listed, {
      type: "search",
      q: "иванов",
    });

    expect(searching.q).toBe("иванов");
    expect(searching.items).toEqual([]);
    expect(searching.page).toBe(0);
    expect(searching.total).toBe(0);
    expect(searching.epoch).toBe(listed.epoch + 1);
  });

  it("EARS-23.2: re-arms the loading state when a search invalidates the in-flight epoch", () => {
    const failed = serverComboboxReducer(serverComboboxInitialState, {
      type: "pageFailed",
      epoch: 0,
    });
    expect(failed.isLoading).toBe(false);
    expect(failed.isError).toBe(true);

    const searching = serverComboboxReducer(failed, { type: "search", q: "п" });

    expect(searching.isLoading).toBe(true);
    expect(searching.isError).toBe(false);
    expect(searching.loadMoreError).toBe(false);
    expect(searching.loadingMore).toBe(false);
  });

  it("EARS-23.2: ignores a settled page from a superseded search epoch", () => {
    const searching = serverComboboxReducer(serverComboboxInitialState, {
      type: "search",
      q: "новый",
    });

    const stale = serverComboboxReducer(searching, {
      type: "pageSettled",
      epoch: searching.epoch - 1,
      items: [option("stale")],
      page: 1,
      total: 1,
    });

    expect(stale).toBe(searching);
    expect(stale.isLoading).toBe(true);
  });

  it("EARS-23.2: debounces keystrokes into one committed search", () => {
    vi.useFakeTimers();
    try {
      const commit = vi.fn();
      const debouncer = createSearchDebouncer(250);

      debouncer.schedule(() => commit("и"));
      vi.advanceTimersByTime(200);
      debouncer.schedule(() => commit("ив"));
      vi.advanceTimersByTime(249);
      expect(commit).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith("ив");

      debouncer.schedule(() => commit("ива"));
      debouncer.cancel();
      vi.advanceTimersByTime(1000);
      expect(commit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("EARS-23.5: keeps the selected option visible while a search lists other rows", () => {
    const listed = serverComboboxReducer(serverComboboxInitialState, {
      type: "pageSettled",
      epoch: 0,
      items: [option("a", "Первый")],
      page: 1,
      total: 1,
    });

    expect(serverComboboxOptions(listed, option("z", "Выбранный"))).toEqual([
      { value: "z", label: "Выбранный" },
      { value: "a", label: "Первый" },
    ]);
    expect(serverComboboxOptions(listed, option("a", "Первый"))).toEqual([
      { value: "a", label: "Первый" },
    ]);
  });

  it("EARS-23.5: carries an option description through to the shared combobox", () => {
    const listed = serverComboboxReducer(serverComboboxInitialState, {
      type: "pageSettled",
      epoch: 0,
      items: [{ id: "u1", label: "Иванов", description: "i@example.com" }],
      page: 1,
      total: 1,
    });

    expect(serverComboboxOptions(listed, null)).toEqual([
      { value: "u1", label: "Иванов", description: "i@example.com" },
    ]);
  });

  it("EARS-23.5: a failed load-more retry keeps the already listed options", () => {
    const listed = serverComboboxReducer(serverComboboxInitialState, {
      type: "pageSettled",
      epoch: 0,
      items: [option("a")],
      page: 1,
      total: 5,
    });
    const retrying = serverComboboxReducer(listed, { type: "loadMore" });
    const failed = serverComboboxReducer(retrying, {
      type: "pageFailed",
      epoch: 0,
    });

    expect(failed.items).toEqual([option("a")]);
    expect(failed.loadMoreError).toBe(true);
    expect(failed.isError).toBe(false);
    expect(failed.loadingMore).toBe(false);
  });

  it("EARS-23.5: merges pages by stable id, preferring the newest row for an id", () => {
    expect(
      mergeServerComboboxPages(
        [option("a", "старый"), option("b")],
        [option("a", "новый"), option("c")],
      ),
    ).toEqual([option("a", "новый"), option("b"), option("c")]);
  });

  // The two behaviours the #1638 convergence has to carry over from the Refine
  // relationship picker, both proved here at the state layer because the panels
  // that host them are only exercised end-to-end once.
  it("EARS-22: prunes newly linked endpoints from pages already merged into the picker", () => {
    // A successful link changes only the excluded set — the pages already in
    // hand are not re-fetched, so the just-linked endpoint has to disappear
    // from the projection or it stays selectable until the server 409s.
    expect(
      pruneComboboxOptions(
        [
          { value: "page-one", label: "Первая страница" },
          { value: "linked-after-page-two", label: "Уже привязан" },
          { value: "page-two", label: "Вторая страница" },
        ],
        ["linked-after-page-two"],
      ),
    ).toEqual([
      { value: "page-one", label: "Первая страница" },
      { value: "page-two", label: "Вторая страница" },
    ]);
    expect(
      pruneComboboxOptions([{ value: "only", label: "Один" }], []),
    ).toEqual([{ value: "only", label: "Один" }]);
  });

  it("EARS-22: exposes next-page and retry actions inside the combobox panel", () => {
    const settled = serverComboboxReducer(serverComboboxInitialState, {
      type: "pageSettled",
      epoch: 0,
      items: [option("a")],
      page: 1,
      total: 41,
    });
    expect(serverComboboxLoadAction(settled, 20)).toBe("next");

    const exhausted = serverComboboxReducer(serverComboboxInitialState, {
      type: "pageSettled",
      epoch: 0,
      items: [option("a")],
      page: 1,
      total: 1,
    });
    expect(serverComboboxLoadAction(exhausted, 20)).toBe(null);

    // A FAILED FIRST page: nothing listed, `hasMore` false by page arithmetic —
    // without an explicit retry the operator's only recovery is retyping.
    const firstPageFailed = serverComboboxReducer(serverComboboxInitialState, {
      type: "pageFailed",
      epoch: 0,
    });
    expect(firstPageFailed.isError).toBe(true);
    expect(serverComboboxLoadAction(firstPageFailed, 20)).toBe("retry");

    const loadMoreFailed = serverComboboxReducer(
      serverComboboxReducer(settled, { type: "loadMore" }),
      { type: "pageFailed", epoch: 0 },
    );
    expect(serverComboboxLoadAction(loadMoreFailed, 20)).toBe("retry");
  });

  it("EARS-22: a retry after a failed first page re-asks for page one and replaces the set", () => {
    const failed = serverComboboxReducer(serverComboboxInitialState, {
      type: "pageFailed",
      epoch: 0,
    });
    const retrying = serverComboboxReducer(failed, { type: "loadMore" });
    expect(retrying.loadingMore).toBe(true);
    expect(serverComboboxNextPage(retrying)).toBe(1);

    const recovered = serverComboboxReducer(retrying, {
      type: "pageSettled",
      epoch: 0,
      items: [option("a")],
      page: 1,
      total: 1,
    });
    expect(recovered.isError).toBe(false);
    expect(recovered.items).toEqual([option("a")]);
    expect(serverComboboxLoadAction(recovered, 20)).toBe(null);
  });
});
