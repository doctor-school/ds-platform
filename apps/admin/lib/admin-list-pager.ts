/**
 * What the `AdminDataList` pager may claim. A counted list knows its page total
 * and reads «Страница N из M». A cursor-paged list (033 «Заявки») counts
 * nothing: it knows only whether a page exists before and after the current
 * one, so it gets the `Pagination` cursor mode and a readout naming the current
 * page alone — a total there would be invented.
 */
export interface AdminListCursor {
  hasPrevious: boolean;
  hasNext: boolean;
}

export type AdminListPager =
  | {
      mode: "pages";
      pageCount: number;
      readout: {
        key: "common.list.pageReadout";
        values: { page: number; pages: number };
      };
    }
  | ({
      mode: "cursor";
      readout: { key: "common.list.pageLabel"; values: { page: number } };
    } & AdminListCursor);

export function adminListPager({
  page,
  pageSize,
  total,
  cursor,
}: {
  page: number;
  pageSize: number;
  total: number | null;
  cursor?: AdminListCursor;
}): AdminListPager {
  if (total === null && cursor) {
    return {
      mode: "cursor",
      hasPrevious: cursor.hasPrevious,
      hasNext: cursor.hasNext,
      readout: { key: "common.list.pageLabel", values: { page } },
    };
  }
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / pageSize));
  return {
    mode: "pages",
    pageCount,
    readout: {
      key: "common.list.pageReadout",
      values: { page, pages: pageCount },
    },
  };
}
