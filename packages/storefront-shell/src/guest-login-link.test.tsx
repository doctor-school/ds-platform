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
vi.mock("next/navigation", () => ({ usePathname: () => "/webinars" }));

import { GuestLoginLink } from "./guest-login-link";

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
});
