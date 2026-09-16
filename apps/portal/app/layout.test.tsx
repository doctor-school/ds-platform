// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #2228 — the root layout is the sticky-footer frame of the Academy storefront.
 *
 * 008 EARS-14 mounts the shared footer from THIS layout so it closes every
 * route's document; the owner's Stage-B finding (2026-09-16, academy
 * `/documents`) was that on a page shorter than the viewport the footer ended
 * with the content and bare background showed underneath. The mechanic is the
 * standard one: `<body>` is a min-full-height flex column, the route content
 * grows, the footer sits at the bottom edge. Asserted on the rendered markup so
 * a class edit on either side cannot silently drop it again.
 */

vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "font-inter" }),
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "ru",
  getMessages: async () => ({}),
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next-intl", () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("../components/theme-watcher", () => ({ ThemeWatcher: () => null }));
vi.mock("../lib/shell-config", () => ({ academyShellConfig: () => ({}) }));
vi.mock("../lib/theme", () => ({ THEME_INIT_SCRIPT: "" }));
vi.mock("@ds/storefront-shell", () => ({
  StorefrontFooter: () => <footer data-testid="storefront-footer" />,
}));

import RootLayout from "./layout";

async function renderLayout(): Promise<Document> {
  const tree = await RootLayout({
    children: <main data-testid="route-content">short page</main>,
    chrome: <header data-testid="chrome" />,
  });
  return new DOMParser().parseFromString(
    renderToStaticMarkup(tree),
    "text/html",
  );
}

describe("008 EARS-14 (#2228): the root layout pins the footer to the viewport bottom", () => {
  it("EARS-14.1: <body> is a min-full-height flex column", async () => {
    const doc = await renderLayout();
    const body = doc.body.classList;
    expect(body.contains("min-h-screen")).toBe(true);
    expect(body.contains("flex")).toBe(true);
    expect(body.contains("flex-col")).toBe(true);
  });

  it("EARS-14.2: the route content grows (flex-1) and the footer follows it as the last body child", async () => {
    const doc = await renderLayout();
    const content = doc.querySelector('[data-testid="route-content"]');
    const growing = content?.closest(".flex-1");
    expect(growing, "route content sits inside a flex-1 area").not.toBeNull();
    // The chrome header stays OUTSIDE the growing area — it must not stretch.
    expect(growing?.querySelector('[data-testid="chrome"]')).toBeNull();
    const footer = doc.querySelector('[data-testid="storefront-footer"]');
    expect(footer).not.toBeNull();
    expect(growing?.contains(footer!)).toBe(false);
    expect(
      growing!.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING,
      "footer comes after the growing area",
    ).toBeTruthy();
  });
});
