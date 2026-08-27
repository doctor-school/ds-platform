import type * as React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pagination, buildPageItems } from "./pagination";

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
});
