// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * 003 EARS-74 — opening the cabinet never shows an empty page. Every signed-in
 * link into `/account/**` (the profile chip, both branches, and «Мои события»
 * on desktop and in the `≡` menu) is a plain document `<a>`, the pattern of the
 * guest «Войти» link (EARS-61); a nav link to a route with a guest view stays a
 * client-router link. `next/link` is replaced by a marked anchor so the two
 * shapes are told apart in the DOM.
 */
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} data-next-link="" {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { StorefrontHeader } from "./storefront-header";
import type { ShellAuthState, StorefrontShellConfig } from "./config";

afterEach(cleanup);

function config(host: "doctor" | "academy"): StorefrontShellConfig {
  return {
    host,
    logo: { alt: "На главную", href: "/" },
    topbar: { text: "BBM" },
    nav: [{ label: "Эфиры", href: "/events" }],
    footer: {
      navTitle: "Разделы",
      documentsTitle: "Документы",
      documents: [],
      contactsTitle: "Контакты",
      contacts: [],
      copyright: "©",
    },
  } as unknown as StorefrontShellConfig;
}

const LABELLED: ShellAuthState = {
  status: "doctor",
  profileHref: "/account",
  label: "Личный кабинет",
};
const INITIALS: ShellAuthState = {
  status: "doctor",
  profileHref: "/account",
  label: "Личный кабинет",
  initials: "ВК",
  links: [{ label: "Мои события", href: "/account/events" }],
};

function expectDocumentLink(el: HTMLElement, href: string) {
  expect(el.tagName).toBe("A");
  expect(el).toHaveAttribute("href", href);
  expect(el).not.toHaveAttribute("data-next-link");
}

describe("003 EARS-74: links into the cabinet navigate by document", () => {
  it.each([
    ["doctor", LABELLED],
    ["doctor", INITIALS],
    ["academy", LABELLED],
    ["academy", INITIALS],
  ] as const)(
    "003 EARS-74: on the %s storefront the profile chip is a plain document link",
    (host, auth) => {
      render(<StorefrontHeader config={config(host)} auth={auth} />);
      expectDocumentLink(screen.getByTestId("shell-avatar"), "/account");
    },
  );

  it.each(["doctor", "academy"] as const)(
    "003 EARS-74: on the %s storefront «Мои события» is a document link in the header and in the mobile menu",
    (host) => {
      render(<StorefrontHeader config={config(host)} auth={INITIALS} />);
      expectDocumentLink(
        screen.getByTestId("shell-auth-link"),
        "/account/events",
      );
      expectDocumentLink(
        screen.getByTestId("shell-auth-link-mobile"),
        "/account/events",
      );
    },
  );

  it("003 EARS-74: a nav link outside /account stays a client-router link, desktop and mobile", () => {
    render(<StorefrontHeader config={config("academy")} auth={INITIALS} />);
    for (const id of ["shell-nav-desktop", "shell-nav-mobile"]) {
      const events = within(screen.getByTestId(id)).getByText("Эфиры");
      expect(events.closest("a")).toHaveAttribute("data-next-link");
    }
  });
});
