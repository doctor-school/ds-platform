// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * 003 EARS-61 — the storefront «Войти» opens the entry as a top-level document
 * navigation. A Next router link prefetches its target in a production build;
 * prefetching an entry would mint a sign-in transaction (and an IdP auth
 * request) per guest page view and overwrite the in-flight `__Host-ds_oidc_tx`
 * of a real click. `next/link` is replaced by a marker so a router link shows.
 */
vi.mock("next/link", () => ({
  default: ({ href, ...rest }: { href: string }) => (
    <a data-router-link="" href={href} {...rest} />
  ),
}));
const nav = vi.hoisted(() => ({ pathname: "/webinars", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { GuestLoginLink, guestLoginHref } from "./guest-login-link";

const landed = (href: string) =>
  new URL(href, "https://doctor.test").searchParams.get("returnTo");

describe("GuestLoginLink", () => {
  it("003 EARS-61: «Войти» is a plain, non-prefetching document link to the entry", () => {
    render(<GuestLoginLink loginHref="/login" label="Войти" />);
    const login = screen.getByTestId("shell-login");
    expect(login.tagName).toBe("A");
    expect(login).toHaveAttribute("href", "/login");
    expect(login).not.toHaveAttribute("data-router-link");
    // The browser follows it: no client router takes the click over.
    expect(fireEvent.click(login)).toBe(true);
  });

  it("017 EARS-1 · 020 LD-4 (#3308): on an event page the hybrid tab rides the land-only return", () => {
    nav.pathname = "/events/ahilles-042";
    nav.search = "mode=online&utm_source=mail";
    render(<GuestLoginLink loginHref="/login" label="Войти" />);
    expect(landed(screen.getByTestId("shell-login").getAttribute("href")!)).toBe(
      "/events/ahilles-042?mode=online&intent=land",
    );
  });
});

describe("guestLoginHref", () => {
  it("017 EARS-1 · 020 LD-4 (#3308): an event page keeps its validated tab, both hosts", () => {
    for (const page of ["/events/ahilles-042", "/webinars/ahilles-042"]) {
      for (const mode of ["online", "offline"]) {
        expect(landed(guestLoginHref("/login", page, mode))).toBe(
          `${page}?mode=${mode}&intent=land`,
        );
      }
    }
  });

  it("017 EARS-1 · 020 LD-4 (#3308): an unknown or absent tab drops only the tab, never the page", () => {
    for (const mode of [null, undefined, "", "ONLINE", "hybrid", "online&x=1"]) {
      expect(landed(guestLoginHref("/login", "/events/ahilles-042", mode))).toBe(
        "/events/ahilles-042?intent=land",
      );
    }
  });

  it("017 EARS-1 (#3308): a page that is no event page carries nothing, tab or not", () => {
    for (const page of ["/events", "/webinars", "/", "/login", "/room/ahilles-042"]) {
      expect(guestLoginHref("/login", page, "online")).toBe("/login");
    }
  });
});
