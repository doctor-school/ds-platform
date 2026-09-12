// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

/**
 * 008 EARS-1/2/3/4/5/11/12/13/14 · 017 EARS-1/5/12 — the shared storefront
 * chrome. The contract exercised here is the one that makes the package
 * shareable: every host-specific string, link and dimension arrives in the
 * values-only `StorefrontShellConfig`, so the SAME two components, driven by the
 * two host configs below, produce each storefront chrome with no host branch
 * inside a component module (008 EARS-13).
 *
 * Both fixtures are built inside this file on purpose — they are the subject of
 * the test (two value sets through one composition), not a shipped artifact: the
 * real host configs land with the hosts in #2180 part B.
 */

// The pathname the OPTIONAL route-hiding boundary reads. `usePathname` is spied
// so a config WITHOUT `hiddenOnPaths` can be asserted never to reach a
// client-navigation hook at all — no client boundary added for a host that does
// not need one.
let pathname = "/";
const usePathnameSpy = vi.fn(() => pathname);
vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameSpy(),
}));

import {
  isHiddenPath,
  matchesPathPattern,
  StorefrontFooter,
  StorefrontHeader,
} from "./index";
import type { StorefrontShellConfig } from "./config";

/** The doctor storefront (`doctor.school`) — search on, one nav item. */
const DOCTOR: StorefrontShellConfig = {
  host: "doctor",
  logo: { alt: "Doctor.School — на главную", href: "/" },
  topbar: { text: "BBM: Академия смыслов" },
  search: {
    placeholder: "Поиск по урокам, школам и событиям",
    action: "/search",
  },
  nav: [{ label: "Эфиры", href: "/events" }],
  footer: {
    navTitle: "Разделы",
    documentsTitle: "Документы и контакты",
    documents: [
      {
        label: "Политика персональных данных",
        href: "/documents/privacy-policy",
      },
      { label: "Контакты", href: "/documents#contacts" },
    ],
    cross: {
      title: "Экспертам и партнёрам",
      label: "Academy.Doctor.School ↗",
      href: "https://academy.doctor.school/",
      note: "Закулисье платформы: проекты, эксперты, партнёры.",
    },
    note: ["Бесплатное образование для врачей.", "© Doctor.School, 2026"],
    giant: { text: "Doctor.School", fontSize: "min(16cqw,240px)" },
  },
};

/** The academy storefront (`academy.doctor.school`) — no search, route hiding. */
const ACADEMY: StorefrontShellConfig = {
  host: "academy",
  logo: { alt: "Doctor.School · Академия — на главную", href: "/webinars" },
  topbar: { text: "BBM: Академия смыслов" },
  search: null,
  nav: [{ label: "Эфиры", href: "/webinars" }],
  footer: {
    navTitle: "Разделы",
    documentsTitle: "Документы и контакты",
    documents: [{ label: "Контакты", href: "/documents#contacts" }],
    cross: {
      title: "Врачам",
      label: "Doctor.School ↗",
      href: "https://doctor.school/",
      note: "Конечный продукт: специальности, школы, курсы, события.",
    },
    note: ["BBM: Академия смыслов", "© Doctor.School, 2026"],
    giant: { text: "Academy.Doctor.School", fontSize: "min(9.6cqw,150px)" },
  },
  hiddenOnPaths: [
    "/login",
    "/register",
    "/verify",
    "/reset",
    "/webinars/*/room",
  ],
};

beforeEach(() => {
  pathname = "/";
  usePathnameSpy.mockClear();
});

describe("StorefrontHeader", () => {
  it("008 EARS-1 · 017 EARS-1: the topbar band renders its configured text on BOTH hosts", () => {
    const doctor = render(<StorefrontHeader config={DOCTOR} />);
    expect(screen.getByTestId("shell-topbar")).toHaveTextContent(
      "BBM: Академия смыслов",
    );
    expect(screen.getByTestId("storefront-header")).toBeInTheDocument();
    doctor.unmount();

    render(<StorefrontHeader config={ACADEMY} />);
    expect(screen.getByTestId("shell-topbar")).toHaveTextContent(
      "BBM: Академия смыслов",
    );
    expect(screen.getByTestId("storefront-header")).toBeInTheDocument();
  });

  it("008 EARS-2: the logo and the nav render exactly the configured items, in order, with their hrefs", () => {
    render(<StorefrontHeader config={DOCTOR} />);

    expect(screen.getByTestId("storefront-logo")).toHaveAttribute("href", "/");
    expect(
      within(screen.getByTestId("storefront-logo")).getByRole("img"),
    ).toHaveAttribute("alt", "Doctor.School — на главную");

    const links = within(screen.getByTestId("shell-nav-desktop")).getAllByRole(
      "link",
    );
    expect(links.map((a) => a.textContent)).toEqual(["Эфиры"]);
    expect(links[0]).toHaveAttribute("href", "/events");
  });

  it("008 EARS-2: a multi-item nav keeps the configured order", () => {
    render(
      <StorefrontHeader
        config={{
          ...ACADEMY,
          nav: [
            { label: "Эфиры", href: "/webinars" },
            { label: "Проекты", href: "/projects" },
          ],
        }}
      />,
    );
    const links = within(screen.getByTestId("shell-nav-desktop")).getAllByRole(
      "link",
    );
    expect(links.map((a) => a.textContent)).toEqual(["Эфиры", "Проекты"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/webinars",
      "/projects",
    ]);
  });

  it("008 EARS-3: the theme toggle flips `.dark` on <html> and persists the choice under `ds-theme`", async () => {
    render(<StorefrontHeader config={DOCTOR} />);
    const toggle = screen.getByTestId("theme-toggle");

    expect(document.documentElement).not.toHaveClass("dark");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    // The class and the persisted choice are applied synchronously by the
    // click; the control's own pressed state trails by a microtask because it
    // subscribes to the CLASS through a MutationObserver rather than to local
    // state — that indirection is what keeps it in step with a theme applied
    // outside it (a host pre-paint FOUC guard), so the test awaits it rather
    // than the component holding a second copy of the truth.
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("ds-theme")).toBe("dark");
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-pressed", "true"),
    );

    fireEvent.click(toggle);
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("ds-theme")).toBe("light");
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-pressed", "false"),
    );
  });

  it("008 EARS-4/5: the auth cluster slot renders the node it is given, and nothing when omitted", () => {
    const withCluster = render(
      <StorefrontHeader
        config={DOCTOR}
        authCluster={<a href="/login">Войти</a>}
      />,
    );
    expect(
      within(screen.getByTestId("shell-auth-cluster")).getByRole("link", {
        name: "Войти",
      }),
    ).toHaveAttribute("href", "/login");
    withCluster.unmount();

    render(<StorefrontHeader config={DOCTOR} />);
    expect(screen.queryByTestId("shell-auth-cluster")).toBeNull();
  });

  it("017 EARS-5: the search input renders only for a config that carries one, with its placeholder and action", () => {
    const doctor = render(<StorefrontHeader config={DOCTOR} />);
    const search = screen.getByTestId("shell-search");
    expect(search).toHaveAttribute("action", "/search");
    expect(
      within(search).getByPlaceholderText("Поиск по урокам, школам и событиям"),
    ).toBeInTheDocument();
    doctor.unmount();

    render(<StorefrontHeader config={ACADEMY} />);
    expect(screen.queryByTestId("shell-search")).toBeNull();
  });

  it("008 EARS-11: the nav collapses into the mobile disclosure below the layout breakpoint", () => {
    render(<StorefrontHeader config={DOCTOR} />);

    // The desktop nav is hidden until the `layout` breakpoint…
    const desktop = screen.getByTestId("shell-nav-desktop");
    expect(desktop.className).toContain("hidden");
    expect(desktop.className).toContain("layout:flex");

    // …and the mobile disclosure, hidden from that breakpoint up, carries the
    // SAME configured targets.
    const menu = screen.getByTestId("shell-mobile-menu");
    expect(menu.className).toContain("layout:hidden");
    const mobileLinks = within(
      screen.getByTestId("shell-nav-mobile"),
    ).getAllByRole("link");
    expect(mobileLinks.map((a) => a.textContent)).toEqual(["Эфиры"]);
    expect(mobileLinks[0]).toHaveAttribute("href", "/events");
  });

  it("008 EARS-12: hiddenOnPaths suppresses the header on a matching path and renders it elsewhere", () => {
    pathname = "/login";
    const hidden = render(<StorefrontHeader config={ACADEMY} />);
    expect(screen.queryByTestId("storefront-header")).toBeNull();
    expect(screen.queryByTestId("shell-topbar")).toBeNull();
    hidden.unmount();

    // The room sits INSIDE a listing that must keep its chrome — the exact case
    // a prefix matcher could not express.
    pathname = "/webinars/kardio-2026/room";
    const room = render(<StorefrontHeader config={ACADEMY} />);
    expect(screen.queryByTestId("storefront-header")).toBeNull();
    room.unmount();

    pathname = "/webinars";
    const listing = render(<StorefrontHeader config={ACADEMY} />);
    expect(screen.getByTestId("storefront-header")).toBeInTheDocument();
    listing.unmount();

    pathname = "/webinars/kardio-2026";
    render(<StorefrontHeader config={ACADEMY} />);
    expect(screen.getByTestId("storefront-header")).toBeInTheDocument();
  });

  it("008 EARS-12: a config without hiddenOnPaths adds no client route boundary", () => {
    render(<StorefrontHeader config={DOCTOR} />);
    render(<StorefrontFooter config={DOCTOR} />);
    expect(usePathnameSpy).not.toHaveBeenCalled();
  });
});

describe("StorefrontFooter", () => {
  it("008 EARS-14 · 017 EARS-12: the footer renders the sections column, the documents column, the single cross link and the giant wordmark", () => {
    render(<StorefrontFooter config={DOCTOR} />);

    const sections = screen.getByTestId("footer-sections");
    expect(within(sections).getByRole("heading")).toHaveTextContent("Разделы");
    const sectionLinks = within(sections).getAllByRole("link");
    expect(sectionLinks.map((a) => a.textContent)).toEqual(["Эфиры"]);
    expect(sectionLinks[0]).toHaveAttribute("href", "/events");

    const documents = screen.getByTestId("footer-documents");
    expect(within(documents).getByRole("heading")).toHaveTextContent(
      "Документы и контакты",
    );
    expect(
      within(documents)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/documents/privacy-policy", "/documents#contacts"]);
  });

  it("017 EARS-12: the cross column carries exactly ONE link out to the sibling storefront, with its note", () => {
    render(<StorefrontFooter config={DOCTOR} />);

    const cross = screen.getByTestId("footer-cross");
    expect(within(cross).getByRole("heading")).toHaveTextContent(
      "Экспертам и партнёрам",
    );
    const crossLinks = within(cross).getAllByRole("link");
    expect(crossLinks).toHaveLength(1);
    expect(crossLinks[0]).toHaveAttribute(
      "href",
      "https://academy.doctor.school/",
    );
    expect(cross).toHaveTextContent(
      "Закулисье платформы: проекты, эксперты, партнёры.",
    );

    const note = screen.getByTestId("footer-note");
    expect(note).toHaveTextContent("Бесплатное образование для врачей.");
    expect(note).toHaveTextContent("© Doctor.School, 2026");
  });

  it("008 EARS-14: the giant wordmark is sized by the configured container-query value, not by script", () => {
    const doctor = render(<StorefrontFooter config={DOCTOR} />);
    const giant = screen.getByTestId("footer-giant");
    expect(giant).toHaveTextContent("Doctor.School");
    // The canvas fits the wordmark with a ResizeObserver; in code it is pure CSS
    // — container-query units on a container-typed box, exactly the canvas
    // `giantSize` value.
    expect(giant).toHaveStyle({ fontSize: "min(16cqw,240px)" });
    doctor.unmount();

    render(<StorefrontFooter config={ACADEMY} />);
    const academyGiant = screen.getByTestId("footer-giant");
    expect(academyGiant).toHaveTextContent("Academy.Doctor.School");
    expect(academyGiant).toHaveStyle({ fontSize: "min(9.6cqw,150px)" });
  });

  it("008 EARS-14 · 017 EARS-12: the SAME footer renders the academy values", () => {
    render(<StorefrontFooter config={ACADEMY} />);
    expect(
      within(screen.getByTestId("footer-cross")).getByRole("heading"),
    ).toHaveTextContent("Врачам");
    expect(screen.getByTestId("footer-note")).toHaveTextContent(
      "BBM: Академия смыслов",
    );
  });

  it("008 EARS-12: hiddenOnPaths suppresses the footer on a matching path and renders it elsewhere", () => {
    pathname = "/register";
    const hidden = render(<StorefrontFooter config={ACADEMY} />);
    expect(screen.queryByTestId("storefront-footer")).toBeNull();
    hidden.unmount();

    pathname = "/webinars";
    render(<StorefrontFooter config={ACADEMY} />);
    expect(screen.getByTestId("storefront-footer")).toBeInTheDocument();
  });

  it("008 EARS-12/14: a footer-scoped hiddenOnPaths overrides the shared list without touching the header", () => {
    const withOwnFooterRoutes: StorefrontShellConfig = {
      ...ACADEMY,
      footer: { ...ACADEMY.footer, hiddenOnPaths: [...ACADEMY.hiddenOnPaths!, "/"] },
    };

    // The route the footer-scoped list adds: footer gone, header untouched.
    pathname = "/";
    const home = render(<StorefrontFooter config={withOwnFooterRoutes} />);
    expect(screen.queryByTestId("storefront-footer")).toBeNull();
    home.unmount();
    render(<StorefrontHeader config={withOwnFooterRoutes} />);
    expect(screen.getByTestId("storefront-logo")).toBeInTheDocument();
  });

  it("008 EARS-12/14: the footer still honours the shared list where its own list repeats it, and renders elsewhere", () => {
    const withOwnFooterRoutes: StorefrontShellConfig = {
      ...ACADEMY,
      footer: { ...ACADEMY.footer, hiddenOnPaths: [...ACADEMY.hiddenOnPaths!, "/"] },
    };

    pathname = "/register";
    const auth = render(<StorefrontFooter config={withOwnFooterRoutes} />);
    expect(screen.queryByTestId("storefront-footer")).toBeNull();
    auth.unmount();

    pathname = "/webinars";
    render(<StorefrontFooter config={withOwnFooterRoutes} />);
    expect(screen.getByTestId("storefront-footer")).toBeInTheDocument();
  });
});

describe("host neutrality", () => {
  it("008 EARS-13: no host string is hardcoded — each config renders only its own host copy", () => {
    const doctor = render(
      <>
        <StorefrontHeader config={DOCTOR} />
        <StorefrontFooter config={DOCTOR} />
      </>,
    );
    expect(document.body).toHaveTextContent("Экспертам и партнёрам");
    expect(document.body).not.toHaveTextContent("Врачам");
    expect(document.body).not.toHaveTextContent(
      "Конечный продукт: специальности, школы, курсы, события.",
    );
    doctor.unmount();

    render(
      <>
        <StorefrontHeader config={ACADEMY} />
        <StorefrontFooter config={ACADEMY} />
      </>,
    );
    expect(document.body).toHaveTextContent("Врачам");
    expect(document.body).not.toHaveTextContent("Экспертам и партнёрам");
    expect(document.body).not.toHaveTextContent(
      "Бесплатное образование для врачей.",
    );
  });
});

/**
 * 008 EARS-12 — the grammar `hiddenOnPaths` is written in. It is SEGMENT-wise
 * rather than prefix-wise because the portal's two existing rules are a set of
 * exact auth routes and a room route one segment inside a listing that must
 * keep its chrome; a prefix matcher can express neither without hiding the
 * listing too.
 */
describe("matchesPathPattern", () => {
  it("008 EARS-12: a literal pattern is an EXACT route, not a prefix", () => {
    expect(matchesPathPattern("/login", "/login")).toBe(true);
    expect(matchesPathPattern("/login/extra", "/login")).toBe(false);
    expect(matchesPathPattern("/log", "/login")).toBe(false);
    expect(matchesPathPattern("/", "/login")).toBe(false);
  });

  it("008 EARS-12: a `*` segment matches exactly one segment, never two", () => {
    expect(matchesPathPattern("/webinars/kardio/room", "/webinars/*/room")).toBe(
      true,
    );
    expect(matchesPathPattern("/webinars/a/b/room", "/webinars/*/room")).toBe(
      false,
    );
    expect(matchesPathPattern("/webinars/room", "/webinars/*/room")).toBe(false);
    expect(matchesPathPattern("/webinars/kardio", "/webinars/*/room")).toBe(
      false,
    );
  });

  it("008 EARS-12: a trailing `**` matches one or more remaining segments", () => {
    expect(matchesPathPattern("/login/step", "/login/**")).toBe(true);
    expect(matchesPathPattern("/login/step/two", "/login/**")).toBe(true);
    expect(matchesPathPattern("/login", "/login/**")).toBe(false);
  });

  it("008 EARS-12: an absent or empty pattern list hides nothing", () => {
    expect(isHiddenPath("/login", undefined)).toBe(false);
    expect(isHiddenPath("/login", [])).toBe(false);
    expect(isHiddenPath("/login", ["/register", "/login"])).toBe(true);
  });
});
