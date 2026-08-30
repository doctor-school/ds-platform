import { describe, expect, it } from "vitest";

import {
  relationshipEndpointQuery,
  relationshipEndpointLoadState,
  mergeRelationshipEndpointPages,
  relationshipEndpointTotalPages,
} from "@/lib/relationship-endpoint-query";

describe("EARS-22 reverse endpoint picker query", () => {
  it("EARS-22: sends search and pagination to the endpoint instead of scanning a client corpus", () => {
    expect(
      relationshipEndpointQuery({ page: 3, pageSize: 20, search: "  Кардио  " }),
    ).toBe("page=3&pageSize=20&q=%D0%9A%D0%B0%D1%80%D0%B4%D0%B8%D0%BE");
    expect(
      relationshipEndpointQuery({ page: 1, pageSize: 20, search: "   " }),
    ).toBe("page=1&pageSize=20");
  });

  it("EARS-22: derives a bounded page count from the authoritative envelope", () => {
    expect(relationshipEndpointTotalPages(0, 20)).toBe(1);
    expect(relationshipEndpointTotalPages(41, 20)).toBe(3);
  });

  it("EARS-22: appends server pages without losing or duplicating retained options", () => {
    expect(
      mergeRelationshipEndpointPages(
        [
          { id: "one", label: "Один" },
          { id: "two", label: "Два" },
        ],
        [
          { id: "two", label: "Два" },
          { id: "three", label: "Три" },
        ],
      ),
    ).toEqual([
      { id: "one", label: "Один" },
      { id: "two", label: "Два" },
      { id: "three", label: "Три" },
    ]);
  });

  it("EARS-22: exposes next-page and retry actions inside the combobox panel", () => {
    expect(
      relationshipEndpointLoadState({
        page: 1,
        pageSize: 20,
        total: 41,
        isError: false,
      }),
    ).toEqual({ hasMore: true, action: "next" });
    expect(
      relationshipEndpointLoadState({
        page: 2,
        pageSize: 20,
        total: 41,
        isError: true,
      }),
    ).toEqual({ hasMore: true, action: "retry" });
  });
});
