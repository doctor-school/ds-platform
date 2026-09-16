// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #2228 — the storefront route-group layout is the sticky-footer frame of the
 * doctor storefront (017 EARS-1). The frame is a min-full-height flex column,
 * the route content grows, the shared footer sits at the viewport bottom on a
 * short page and follows the content on a long one. The Academy root layout
 * carries the same contract (`apps/portal/app/layout.test.tsx`).
 */

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@ds/auth-flow/server", () => ({
  resolveServerAuth: async () => ({ status: "guest" }),
}));
vi.mock("@/lib/auth-flow-routes", () => ({
  doctorShellAuthState: () => ({ kind: "guest" }),
}));
vi.mock("@/lib/shell-config", () => ({ DOCTOR_SHELL: {} }));
vi.mock("@ds/storefront-shell", () => ({
  StorefrontHeader: () => <header data-testid="storefront-header" />,
  StorefrontFooter: () => <footer data-testid="storefront-footer" />,
}));

import StorefrontLayout from "./layout";

async function renderLayout(): Promise<Document> {
  const tree = await StorefrontLayout({
    children: <p data-testid="route-content">short page</p>,
  });
  return new DOMParser().parseFromString(
    renderToStaticMarkup(tree),
    "text/html",
  );
}

describe("017 EARS-1 (#2228): the storefront frame pins the footer to the viewport bottom", () => {
  it("EARS-1.12: the frame is a min-full-height flex column with the route content growing", async () => {
    const doc = await renderLayout();
    const frame = doc.querySelector('[data-testid="storefront-shell"]');
    expect(frame).not.toBeNull();
    for (const cls of ["flex", "flex-col", "min-h-screen"]) {
      expect(frame!.classList.contains(cls), cls).toBe(true);
    }
    const main = frame!.querySelector("main");
    expect(main?.classList.contains("flex-1")).toBe(true);
    expect(main?.querySelector('[data-testid="route-content"]')).not.toBeNull();
    // header → main → footer, nothing else at the frame level.
    expect(
      Array.from(frame!.children).map((el) => el.tagName.toLowerCase()),
    ).toEqual(["header", "main", "footer"]);
  });
});
