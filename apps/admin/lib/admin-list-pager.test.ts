import { describe, expect, it } from "vitest";
import { adminListPager } from "./admin-list-pager";

describe("adminListPager", () => {
  it("EARS-13: a counted list pages by number and reads «Страница N из M»", () => {
    expect(adminListPager({ page: 2, pageSize: 20, total: 62 })).toEqual({
      mode: "pages",
      pageCount: 4,
      readout: {
        key: "common.list.pageReadout",
        values: { page: 2, pages: 4 },
      },
    });
    expect(adminListPager({ page: 1, pageSize: 20, total: 0 })).toMatchObject({
      mode: "pages",
      pageCount: 1,
    });
  });

  it("EARS-13: a cursor list with no total names only the current page — never an invented «из N»", () => {
    const pager = adminListPager({
      page: 1,
      pageSize: 20,
      total: null,
      cursor: { hasPrevious: false, hasNext: true },
    });
    expect(pager).toEqual({
      mode: "cursor",
      hasPrevious: false,
      hasNext: true,
      readout: { key: "common.list.pageLabel", values: { page: 1 } },
    });
    expect(JSON.stringify(pager)).not.toContain("pages");
  });
});
