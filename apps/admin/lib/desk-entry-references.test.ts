import { describe, expect, it, vi } from "vitest";
import {
  fetchSpecialtySearchPage,
  specialtySearchUrl,
} from "./desk-entry-references";

const ENTRY = {
  id: "0b8c2f1e-2f7a-4a39-9d0e-6f3a1c2b4d5e",
  code: "cardiology",
  name: "Кардиология",
  isOther: false,
};

function answer(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("044 EARS-35 desk entry — the specialty search", () => {
  it("EARS-35: an empty query reads the whole book through the search read", () => {
    expect(specialtySearchUrl("")).toBe("/v1/public/specialties/search");
    expect(specialtySearchUrl("   ")).toBe("/v1/public/specialties/search");
  });

  it("EARS-35: a typed query is sent to the server, which narrows the book", async () => {
    const fetchImpl = answer({ query: "кард", entries: [ENTRY], total: 1 });
    const page = await fetchSpecialtySearchPage({ q: " кард " }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      `/v1/public/specialties/search?q=${encodeURIComponent("кард")}`,
    );
    expect(page).toEqual({ data: [ENTRY], total: 1, page: 1 });
  });

  it("EARS-35: one answer is the whole result — no further page is offered", async () => {
    const fetchImpl = answer({ query: "", entries: [ENTRY], total: 40 });
    const page = await fetchSpecialtySearchPage({ q: "" }, fetchImpl);
    expect(page.total).toBe(page.data.length);
  });

  it("EARS-35: a refused or malformed answer fails the read", async () => {
    await expect(
      fetchSpecialtySearchPage({ q: "x" }, answer({ message: "no" }, 400)),
    ).rejects.toThrow();
    await expect(
      fetchSpecialtySearchPage({ q: "x" }, answer({ entries: "nope" })),
    ).rejects.toThrow();
  });
});
