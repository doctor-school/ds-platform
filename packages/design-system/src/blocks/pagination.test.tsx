import type * as React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pagination, buildPageItems, buildResponsivePageItems } from "./pagination";

afterEach(cleanup);

/**
 * `<Pagination>` (#1578). The GOV.UK rules are the component's behaviour, not the
 * page's, so the harness pins them as hard invariants: no control at one page, no
 * previous on the first page, no next on the last, exactly one `aria-current`, and
 * no focusable disabled-looking control that does nothing.
 */
function renderPagination(props: Partial<React.ComponentProps<typeof Pagination>> = {}) {
  return render(
    <Pagination
      page={3}
      pageCount={7}
      onPageChange={vi.fn()}
      navLabel="Страницы"
      previousLabel="Назад"
      nextLabel="Вперёд"
      pageLabel={(page) => `Страница ${page}`}
      readout="Показаны 41–60 из 137"
      {...props}
    />,
  );
}

describe("<Pagination>", () => {
  it("does not render at all when there is only one page of content", () => {
    const { container } = renderPagination({ page: 1, pageCount: 1 });
    expect(container).toBeEmptyDOMElement();
  });

  it("omits the previous control entirely on the first page", () => {
    renderPagination({ page: 1 });
    expect(screen.queryByRole("button", { name: "Назад" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вперёд" })).toBeInTheDocument();
  });

  it("omits the next control entirely on the last page", () => {
    renderPagination({ page: 7 });
    expect(screen.queryByRole("button", { name: "Вперёд" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Назад" })).toBeInTheDocument();
  });

  it("marks exactly one number with aria-current=page", () => {
    renderPagination();
    const current = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Страница 3");
  });

  it("exposes a nav landmark with an app-supplied accessible name", () => {
    renderPagination();
    expect(screen.getByRole("navigation")).toHaveAccessibleName("Страницы");
  });

  it("requests the neighbouring page through onPageChange", async () => {
    const onPageChange = vi.fn();
    renderPagination({ onPageChange });
    await userEvent.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("renders the range readout", () => {
    renderPagination();
    expect(screen.getByText("Показаны 41–60 из 137")).toBeInTheDocument();
  });

  it("builds first/last + current ± siblings with ellipses for skipped pages", () => {
    expect(buildPageItems(1, 7)).toEqual([1, 2, null, 7]);
    expect(buildPageItems(4, 7)).toEqual([1, null, 3, 4, 5, null, 7]);
    expect(buildPageItems(3, 3)).toEqual([1, 2, 3]);
  });

  /**
   * Narrow viewports (#1578 Stage-B round 2): the control measured 452px at a 390px
   * viewport and clipped «Назад» / «Вперёд» off-screen. The collapse is the GOV.UK
   * mobile shape — first / current / last with ellipses — driven by classes, not by a
   * second render, so `aria-current` stays unique and prev/next stay reachable.
   */
  it("collapses to first/current/last below sm, keeping the wide sequence for sm and up", () => {
    expect(buildResponsivePageItems(4, 12)).toEqual([
      { kind: "page", page: 1, showNarrow: true },
      { kind: "ellipsis", showNarrow: true, showWide: true },
      { kind: "page", page: 3, showNarrow: false },
      { kind: "page", page: 4, showNarrow: true },
      // The narrow «…» opens right after page 4 — the numbers it stands for follow it
      // hidden, so the narrow shape reads 1 … 4 … 12.
      { kind: "ellipsis", showNarrow: true, showWide: false },
      { kind: "page", page: 5, showNarrow: false },
      { kind: "ellipsis", showNarrow: false, showWide: true },
      { kind: "page", page: 12, showNarrow: true },
    ]);
    // A wide sequence with no gaps still needs narrow-only ellipses for what it drops.
    expect(buildResponsivePageItems(3, 5)).toEqual([
      { kind: "page", page: 1, showNarrow: true },
      { kind: "ellipsis", showNarrow: true, showWide: false },
      { kind: "page", page: 2, showNarrow: false },
      { kind: "page", page: 3, showNarrow: true },
      { kind: "ellipsis", showNarrow: true, showWide: false },
      { kind: "page", page: 4, showNarrow: false },
      { kind: "page", page: 5, showNarrow: true },
    ]);
    // Short sequences collapse to nothing — every page survives the narrow shape.
    expect(buildResponsivePageItems(2, 3)).toEqual([
      { kind: "page", page: 1, showNarrow: true },
      { kind: "page", page: 2, showNarrow: true },
      { kind: "page", page: 3, showNarrow: true },
    ]);
  });

  it("hides only the dropped numbers below sm — never the current page or prev/next", () => {
    renderPagination({ page: 4, pageCount: 12 });
    const hiddenBelowSm = (name: string) =>
      screen.getByRole("button", { name }).closest("li")?.className.includes("hidden");

    expect(hiddenBelowSm("Страница 3")).toBe(true);
    expect(hiddenBelowSm("Страница 5")).toBe(true);
    expect(hiddenBelowSm("Страница 4")).toBe(false);
    expect(hiddenBelowSm("Страница 1")).toBe(false);
    expect(hiddenBelowSm("Страница 12")).toBe(false);
    expect(hiddenBelowSm("Назад")).toBe(false);
    expect(hiddenBelowSm("Вперёд")).toBe(false);
    // Still exactly one aria-current: the collapse is CSS, not a second rendered nav.
    expect(
      screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page"),
    ).toHaveLength(1);
  });

  it("lets the control wrap instead of overflowing a narrow viewport", () => {
    renderPagination();
    expect(screen.getByRole("navigation").querySelector("ul")?.className).toContain("flex-wrap");
  });
});
