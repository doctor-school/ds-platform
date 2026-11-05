import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NOT_FOUND_COPY } from "./copy/not-found";
import {
  NOT_FOUND_PAGE_METADATA,
  NotFoundPage,
  pickNotFoundVariant,
} from "./not-found-page";

/**
 * #2478 — the storefront not-found state of the platform's one error page:
 * one of the owner's variants per render (heading and line together), one way
 * out to the host home.
 */
describe("not-found page", () => {
  it("renders every variant's own heading with its own line, never another variant's", () => {
    const { variants } = NOT_FOUND_COPY;
    expect(variants).toHaveLength(6);
    variants.forEach((variant, index) => {
      const { unmount } = render(<NotFoundPage variant={index} />);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(variant.title);
      expect(screen.getByText(variant.text)).toBeInTheDocument();
      for (const other of variants.filter((_, i) => i !== index)) {
        expect(screen.queryByText(other.text)).toBeNull();
      }
      unmount();
    });
  });

  it("offers one way out — the host home", () => {
    render(<NotFoundPage variant={0} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/");
    expect(links[0]!.textContent).toBe(NOT_FOUND_COPY.home);
  });

  it("falls back to the first variant on an index outside the list", () => {
    render(<NotFoundPage variant={99} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      NOT_FOUND_COPY.variants[0]!.title,
    );
  });

  it("picks one variant per render across the whole list, from the random source", () => {
    const count = NOT_FOUND_COPY.variants.length;
    expect(pickNotFoundVariant(() => 0)).toBe(0);
    expect(pickNotFoundVariant(() => 0.5)).toBe(Math.floor(count / 2));
    expect(pickNotFoundVariant(() => 0.999999)).toBe(count - 1);
    expect(pickNotFoundVariant(() => 1)).toBe(count - 1);
  });

  it("titles the tab with the not-found page title and keeps the page out of the index", () => {
    expect(NOT_FOUND_PAGE_METADATA.title).toBe(NOT_FOUND_COPY.pageTitle);
    expect(NOT_FOUND_PAGE_METADATA.robots).toEqual({ index: false, follow: false });
  });
});
