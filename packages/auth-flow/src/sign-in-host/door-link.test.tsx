// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hop = vi.hoisted(() => vi.fn());
vi.mock("./host-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./host-history")>()),
  hopHostDoor: (href: string) => hop(href),
}));

// A Next router link would render through `next/link`; the door link must not.
const nextLink = vi.hoisted(() => vi.fn());
vi.mock("next/link", () => ({
  default: (props: unknown) => {
    nextLink(props);
    return null;
  },
}));

import { DoorLink, renderDoorLink } from "./door-link";

/**
 * 003 EARS-70 / EARS-71 — the links between the sign-in host's doors. The host
 * proxy answers a door only for a top-level navigation, so a router link's
 * background RSC prefetch is a 403 on every page of the host; a door link is a
 * plain anchor that never prefetches, and its activation replaces the host's
 * history entry.
 */
beforeEach(() => {
  hop.mockReset();
  nextLink.mockReset();
});
afterEach(cleanup);

describe("003 EARS-70: a door link never prefetches and hops by replacing", () => {
  it("003 EARS-70: renders a plain anchor, never a Next router link", () => {
    render(
      <>
        {renderDoorLink({
          href: "/register?authRequest=A",
          children: "Создать аккаунт",
        })}
      </>,
    );
    const link = screen.getByRole("link", { name: "Создать аккаунт" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/register?authRequest=A");
    expect(nextLink).not.toHaveBeenCalled();
  });

  it("003 EARS-71: a plain click hops to the door by replacing the host's entry", () => {
    render(<DoorLink href="/reset?authRequest=A">Забыли пароль?</DoorLink>);
    const link = screen.getByRole("link");
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(hop).toHaveBeenCalledWith("/reset?authRequest=A");
  });

  it("a modified click (new tab / window) keeps the browser's own handling", () => {
    render(<DoorLink href="/reset?authRequest=A">Забыли пароль?</DoorLink>);
    const link = screen.getByRole("link");
    for (const mod of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { button: 1 },
    ]) {
      fireEvent.click(link, mod);
    }
    expect(hop).not.toHaveBeenCalled();
  });
});
