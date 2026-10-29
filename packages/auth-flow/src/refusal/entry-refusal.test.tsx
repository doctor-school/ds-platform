// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENTRY_REFUSAL_COPY } from "../copy/entry-refusal";
import { EntryRefusal, type EntryRefusalWayOut } from "./entry-refusal";

/**
 * 003 EARS-72 — the refusal page's content: the heading and text of one
 * variant, the countdown on the disabled retry, the retry, the way out.
 */

const HOME: EntryRefusalWayOut = { kind: "link", href: "/", label: ENTRY_REFUSAL_COPY.home };
const REASONS = ["rate-limited", "unavailable"] as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function retryButton(): HTMLButtonElement {
  return screen.getByRole("button") as HTMLButtonElement;
}

describe("entry refusal", () => {
  for (const reason of REASONS) {
    it(`003 EARS-72: every ${reason} variant renders its own heading with its own text, never another variant's`, () => {
      const variants = ENTRY_REFUSAL_COPY.variants[reason];
      expect(variants).toHaveLength(3);
      variants.forEach((variant, index) => {
        render(
          <EntryRefusal reason={reason} retryAfterSeconds={null} variant={index} wayOut={HOME} />,
        );
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(variant.title);
        expect(screen.getByText(variant.text)).toBeTruthy();
        for (const other of variants.filter((_, i) => i !== index)) {
          expect(screen.queryByText(other.text)).toBeNull();
          expect(screen.queryByText(other.title)).toBeNull();
        }
        cleanup();
      });
    });
  }

  it("003 EARS-72: a rate-limited refusal with a wait counts down on the disabled retry and opens it at zero", () => {
    const retry = vi.fn();
    render(
      <EntryRefusal reason="rate-limited" retryAfterSeconds={65} variant={0} wayOut={HOME} retry={retry} />,
    );
    expect(retryButton().disabled).toBe(true);
    expect(retryButton().textContent).toBe("Можно повторить через 1:05");
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(retryButton().textContent).toBe("Можно повторить через 0:59");
    fireEvent.click(retryButton());
    expect(retry).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(retryButton().disabled).toBe(false);
    expect(retryButton().textContent).toBe(ENTRY_REFUSAL_COPY.retry);
    fireEvent.click(retryButton());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("003 EARS-72: a rate-limited refusal with no wait the API named opens the retry at once", () => {
    render(<EntryRefusal reason="rate-limited" retryAfterSeconds={null} variant={1} wayOut={HOME} />);
    expect(retryButton().disabled).toBe(false);
    expect(retryButton().textContent).toBe(ENTRY_REFUSAL_COPY.retry);
  });

  it("003 EARS-72: an unavailable refusal opens the retry at once; the retry shows its loading state and runs once", () => {
    const retry = vi.fn();
    render(
      <EntryRefusal reason="unavailable" retryAfterSeconds={30} variant={2} wayOut={HOME} retry={retry} />,
    );
    expect(retryButton().disabled).toBe(false);
    fireEvent.click(retryButton());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retryButton().getAttribute("aria-busy")).toBe("true");
    fireEvent.click(retryButton());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("003 EARS-72: a storefront way out is one link with its label", () => {
    render(
      <EntryRefusal
        reason="unavailable"
        retryAfterSeconds={null}
        variant={0}
        wayOut={{ kind: "link", href: "/webinars/live-1", label: ENTRY_REFUSAL_COPY.backToEvent }}
      />,
    );
    const link = screen.getByRole("link", { name: ENTRY_REFUSAL_COPY.backToEvent });
    expect(link.getAttribute("href")).toBe("/webinars/live-1");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("003 EARS-72: the sign-in site's way out is one line naming both sites as links", () => {
    const { container } = render(
      <EntryRefusal
        reason="unavailable"
        retryAfterSeconds={null}
        variant={0}
        wayOut={{ kind: "sites", academyHref: "https://academy.example", doctorHref: "https://doctor.example" }}
      />,
    );
    expect(
      screen.getByRole("link", { name: ENTRY_REFUSAL_COPY.academySite }).getAttribute("href"),
    ).toBe("https://academy.example");
    expect(
      screen.getByRole("link", { name: ENTRY_REFUSAL_COPY.doctorSite }).getAttribute("href"),
    ).toBe("https://doctor.example");
    expect(container.textContent).toContain(
      "Или перейдите на сайт Академии или на витрину врача",
    );
  });
});
