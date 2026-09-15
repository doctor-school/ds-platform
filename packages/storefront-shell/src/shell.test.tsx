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
import { buttonVariants } from "@ds/design-system/button";

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

/** The header always receives an auth state; tests that are not about the auth
 *  cluster pass the neutral reserve branch. */
const LOADING = { status: "loading" } as const;

beforeEach(() => {
  pathname = "/";
  usePathnameSpy.mockClear();
});

describe("StorefrontHeader", () => {
  it("008 EARS-1 · 017 EARS-1: the topbar band renders its configured text on BOTH hosts", () => {
    const doctor = render(<StorefrontHeader config={DOCTOR} auth={LOADING} />);
    expect(screen.getByTestId("shell-topbar")).toHaveTextContent(
      "BBM: Академия смыслов",
    );
    expect(screen.getByTestId("storefront-header")).toBeInTheDocument();
    doctor.unmount();

    render(<StorefrontHeader config={ACADEMY} auth={LOADING} />);
    expect(screen.getByTestId("shell-topbar")).toHaveTextContent(
      "BBM: Академия смыслов",
    );
    expect(screen.getByTestId("storefront-header")).toBeInTheDocument();
  });

  it("008 EARS-1 · 017 EARS-1: the topbar text is the canvas micro-band — 9px bold at .22em tracking, not the caption tier", () => {
    render(<StorefrontHeader config={DOCTOR} auth={LOADING} />);
    const topbar = screen.getByTestId("shell-topbar");
    // Canvas line 16: `font-size:9px;font-weight:700;letter-spacing:.22em;
    // text-transform:uppercase`. The Stage-B finding on #2198 was the band set
    // in `text-caption` (13px) — half again the canvas size.
    // Canvas line 16 declares the type ON THE BAND, not on the text leaf. With
    // `text-topbar` on the span alone the band inherited the body's 24px
    // line-height and the 9px text sat off-centre in a 36px band on BOTH hosts
    // (#2198 Stage-B finding) — so the type classes, `leading-none` included,
    // live on the band and the span keeps only its testid and its colour.
    const band = topbar.parentElement!;
    expect(band).toHaveClass(
      "text-topbar",
      "font-bold",
      "uppercase",
      "tracking-topbar",
      "leading-none",
    );
    expect(topbar.className).not.toMatch(/\btext-(topbar|caption|sm|xs)\b/);
    expect(topbar).toHaveClass("text-header-topbar-foreground");
  });

  it("008 EARS-2: the logo and the nav render exactly the configured items, in order, with their hrefs", () => {
    render(<StorefrontHeader config={DOCTOR} auth={LOADING} />);

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
        auth={LOADING}
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
    render(<StorefrontHeader config={DOCTOR} auth={LOADING} />);
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

  it("008 EARS-4/5 · 017 EARS-1: the package renders the auth cluster from DATA — one cluster per state, never a host-supplied node", () => {
    // #2180: the header takes `auth` (a value), not an `authCluster` ReactNode.
    // The slot is what let each host assemble its own chip and drift.
    const guest = render(
      <StorefrontHeader
        config={DOCTOR}
        auth={{
          status: "guest",
          loginHref: "/login",
          label: "Войти / Регистрация",
        }}
      />,
    );
    const guestCluster = screen.getByTestId("shell-auth-cluster");
    expect(guestCluster).toHaveAttribute("data-cluster", "guest");
    expect(within(guestCluster).getByTestId("shell-login")).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.queryByTestId("shell-avatar")).toBeNull();
    guest.unmount();

    // A doctor host that ships a labelled profile chip (017: «Личный кабинет»).
    const labelled = render(
      <StorefrontHeader
        config={DOCTOR}
        auth={{
          status: "doctor",
          profileHref: "/account",
          label: "Личный кабинет",
        }}
      />,
    );
    const doctorCluster = screen.getByTestId("shell-auth-cluster");
    expect(doctorCluster).toHaveAttribute("data-cluster", "doctor");
    expect(within(doctorCluster).getByTestId("shell-avatar")).toHaveTextContent(
      "Личный кабинет",
    );
    expect(screen.queryByTestId("shell-login")).toBeNull();
    labelled.unmount();

    // A host that ships the initials chip instead (the academy) — the same
    // cluster, the same testid, an icon-LINK and never a dropdown (EARS-5/6).
    const initials = render(
      <StorefrontHeader
        config={ACADEMY}
        auth={{
          status: "doctor",
          profileHref: "/account",
          label: "Личный кабинет",
          initials: "ВК",
        }}
      />,
    );
    const avatar = screen.getByTestId("shell-avatar");
    expect(avatar).toHaveTextContent("ВК");
    expect(avatar).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("button", { name: /Выйти/ })).toBeNull();
    initials.unmount();

    // `loading` reserves the box and offers NEITHER branch (no first-paint flash).
    render(<StorefrontHeader config={ACADEMY} auth={{ status: "loading" }} />);
    expect(screen.getByTestId("shell-auth-cluster")).toHaveAttribute(
      "data-cluster",
      "loading",
    );
    expect(screen.queryByTestId("shell-login")).toBeNull();
    expect(screen.queryByTestId("shell-avatar")).toBeNull();
  });

  it("008 EARS-4 · 017 EARS-1: the guest chip class string is byte-identical on BOTH hosts", () => {
    // The #2198 Stage-B finding: 194×44 on the academy vs 191×48 on the doctor
    // host, because each host assembled the chip itself. With the cluster owned
    // by the package the class string cannot differ — asserted as bytes.
    const GUEST = {
      status: "guest",
      loginHref: "/login",
      label: "Войти / Регистрация",
    } as const;

    const doctor = render(<StorefrontHeader config={DOCTOR} auth={GUEST} />);
    const doctorChip = screen.getByTestId("shell-login").className;
    doctor.unmount();

    render(<StorefrontHeader config={ACADEMY} auth={GUEST} />);
    expect(screen.getByTestId("shell-login").className).toBe(doctorChip);
    // And it IS the design system's one header chip, not a local class list.
    expect(doctorChip).toContain("px-chip-x");
    expect(doctorChip).toContain("shadow-header-chip");
    expect(doctorChip).not.toMatch(/\bborder-/);
  });

  it("008 EARS-11: the mobile disclosure is the same header-chip primitive as the auth chip", () => {
    // Deliverable 3 (#2180): no hand-assembled chip class list on the `≡`
    // summary — the same `on-primary` icon-size chip the bar's other controls
    // are, so a chip restyle moves all of them at once.
    render(
      <StorefrontHeader
        config={DOCTOR}
        auth={{
          status: "guest",
          loginHref: "/login",
          label: "Войти / Регистрация",
        }}
      />,
    );
    const summary =
      screen.getByTestId("shell-mobile-menu").querySelector("summary")!;
    const chip = buttonVariants({ variant: "on-primary", size: "icon" })
      .split(" ")
      // The `≡` glyph is deliberately larger than the chip's body type, so
      // `text-xl` replaces the primitive's type size (tailwind-merge); every
      // other class of the chip — surface, cast, press chain, 44px box — must
      // arrive from the primitive and from nowhere else.
      .filter((cls) => !/^text-(?:xs|sm|base|lg|xl)$/.test(cls));
    for (const cls of chip) {
      expect(summary.className.split(" ")).toContain(cls);
    }
  });

  it("017 EARS-5: the search input renders only for a config that carries one, with its placeholder and action", () => {
    const doctor = render(<StorefrontHeader config={DOCTOR} auth={LOADING} />);
    const search = screen.getByTestId("shell-search");
    expect(search).toHaveAttribute("action", "/search");
    expect(
      within(search).getByPlaceholderText("Поиск по урокам, школам и событиям"),
    ).toBeInTheDocument();
    // Canvas line 24: the desktop search is `flex:1;max-width:440px` — it
    // grows into the free bar width but never past the cap, so the nav and the
    // auth cluster keep their place on the right (the #2198 Stage-B finding was
    // an uncapped `flex-1` swallowing the whole bar).
    expect(search).toHaveClass("layout:max-w-search");
    doctor.unmount();

    render(<StorefrontHeader config={ACADEMY} auth={LOADING} />);
    expect(screen.queryByTestId("shell-search")).toBeNull();
  });

  it("008 EARS-11: the nav collapses into the mobile disclosure below the layout breakpoint", () => {
    render(<StorefrontHeader config={DOCTOR} auth={LOADING} />);

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
    const hidden = render(<StorefrontHeader config={ACADEMY} auth={LOADING} />);
    expect(screen.queryByTestId("storefront-header")).toBeNull();
    expect(screen.queryByTestId("shell-topbar")).toBeNull();
    hidden.unmount();

    // The room sits INSIDE a listing that must keep its chrome — the exact case
    // a prefix matcher could not express.
    pathname = "/webinars/kardio-2026/room";
    const room = render(<StorefrontHeader config={ACADEMY} auth={LOADING} />);
    expect(screen.queryByTestId("storefront-header")).toBeNull();
    room.unmount();

    pathname = "/webinars";
    const listing = render(<StorefrontHeader config={ACADEMY} auth={LOADING} />);
    expect(screen.getByTestId("storefront-header")).toBeInTheDocument();
    listing.unmount();

    pathname = "/webinars/kardio-2026";
    render(<StorefrontHeader config={ACADEMY} auth={LOADING} />);
    expect(screen.getByTestId("storefront-header")).toBeInTheDocument();
  });

  it("008 EARS-12: a config without hiddenOnPaths adds no client route boundary", () => {
    render(<StorefrontHeader config={DOCTOR} auth={LOADING} />);
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
    render(<StorefrontHeader config={withOwnFooterRoutes} auth={LOADING} />);
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
        <StorefrontHeader config={DOCTOR} auth={LOADING} />
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
        <StorefrontHeader config={ACADEMY} auth={LOADING} />
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
