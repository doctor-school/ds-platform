import { render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 028 EARS-2 / EARS-12 — the Academy's `/documents/:slug` route projection. The
 * page renders the SHARED `LegalDocument` block over the real published document,
 * and an unresolved slug lands inside the same block shell (`state="not-found"`)
 * rather than a bare host 404 (028-design §dataState).
 *
 * `notFound()` is mocked to throw the sentinel Next.js itself throws, so the test
 * asserts that the page ABORTS on an unknown slug — the real 404 status comes from
 * the framework and is pinned in the Playwright tier, not in jsdom.
 */

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));

const { default: DocumentPage } = await import("./page");
const { default: DocumentNotFound } = await import("./not-found");

afterEach(cleanup);

describe("028 Academy document route", () => {
  it("028 EARS-2: renders the published policy body through the shared reading component", async () => {
    render(
      await DocumentPage({ params: Promise.resolve({ slug: "privacy-policy" }) }),
    );

    const block = screen.getByTestId("legal-document");
    expect(block).toHaveAttribute("data-state", "normal");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Политика персональных данных и согласия",
    );
    // The edition line is the only version marker a reader sees (EARS-10).
    expect(screen.getByTestId("legal-document-edition")).toHaveTextContent(
      /редакция от/,
    );
    // A non-empty rendered body — the block parses the Markdown itself.
    expect(screen.getByTestId("legal-document-body").textContent ?? "").not.toBe(
      "",
    );
    // Back to the Academy's own list, never the doctor host's.
    expect(screen.getByTestId("legal-document-back-top")).toHaveAttribute(
      "href",
      "/documents",
    );
    expect(screen.getByTestId("legal-document-back-bottom")).toHaveAttribute(
      "href",
      "/documents",
    );
  });

  it("028 EARS-2: offers every OTHER published document as a neighbour, never itself", async () => {
    render(
      await DocumentPage({ params: Promise.resolve({ slug: "privacy-policy" }) }),
    );

    const others = screen.getByTestId("legal-document-others");
    const links = within(others).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).not.toBe("/documents/privacy-policy");
      expect(link.getAttribute("href")).toMatch(/^\/documents\/[a-z0-9-]+$/);
    }
  });

  it("028 EARS-12: an unresolved slug aborts to the not-found segment rendered inside the block shell", async () => {
    await expect(
      DocumentPage({ params: Promise.resolve({ slug: "no-such-document" }) }),
    ).rejects.toThrow(NOT_FOUND);

    cleanup();
    render(<DocumentNotFound />);
    const block = screen.getByTestId("legal-document");
    expect(block).toHaveAttribute("data-state", "not-found");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Такого документа нет.",
    );
    expect(
      screen.getByRole("link", { name: /Все документы платформы/ }),
    ).toHaveAttribute("href", "/documents");
  });
});
