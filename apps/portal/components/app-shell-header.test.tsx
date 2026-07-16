// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

/**
 * 008 EARS-1…6 / EARS-11 / EARS-13 — the persistent app-shell header. The
 * component-level contract: the logo + [Эфиры · Мои события] nav + theme toggle
 * are present (EARS-1); every target resolves to a shipped surface and «Школы» is
 * absent (EARS-2 / EARS-10 Retired); the account affordance branches on the
 * session read — «Войти» → `/login` for a guest (EARS-4), the initials avatar
 * icon → `/account` for a doctor (EARS-5/6, an icon, not a dropdown, no «Выйти»);
 * the mobile `≡` dropdown carries the same targets (EARS-11); copy comes from the
 * catalog (EARS-13); and the header renders nothing on the auth + room routes.
 * The full canvas-fidelity render check is the Stage-B live drive.
 */

// Mutable pathname the header reads via usePathname.
let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

// The session read the account affordance branches on.
const getMyProfile = vi.fn();
vi.mock("@/lib/profile-client", () => ({
  getMyProfile: () => getMyProfile(),
  ProfileError: class extends Error {},
}));

import { AppShellHeader } from "./app-shell-header";
import { refreshHeaderAuth } from "@/lib/header-auth";

const CATALOG = {
  shell: {
    logoAlt: "Doctor.School",
    navBroadcasts: "Эфиры",
    navMyEvents: "Мои события",
    login: "Войти",
    themeToggle: "Переключить тему",
    profile: "Мой профиль",
    menu: "Меню",
  },
};

function renderHeader(messages: Record<string, unknown> = CATALOG) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <AppShellHeader />
    </NextIntlClientProvider>,
  );
}

const DOCTOR = {
  email: "doctor@ds.test",
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  displayName: "Виктор Ковалёв",
};

beforeEach(() => {
  pathname = "/";
  document.documentElement.classList.remove("dark");
  getMyProfile.mockReset().mockResolvedValue(null); // default: guest
});
afterEach(cleanup);

describe("008 EARS-1…13 — persistent app-shell header", () => {
  it("EARS-1: renders the logo (link to /), the nav [Эфиры · Мои события], and the theme toggle", async () => {
    renderHeader();
    // Logo → /
    const logo = await screen.findByTestId("shell-logo");
    expect(logo).toHaveAttribute("href", "/");
    expect(within(logo).getByAltText("Doctor.School")).toBeInTheDocument();
    // Nav labels (desktop tree)
    const nav = screen.getByTestId("shell-nav-desktop");
    expect(within(nav).getByTestId("shell-nav-broadcasts")).toHaveTextContent(
      "Эфиры",
    );
    expect(within(nav).getByTestId("shell-nav-my-events")).toHaveTextContent(
      "Мои события",
    );
    // Theme toggle (present in both breakpoint trees)
    expect(
      screen.getAllByRole("button", { name: "Переключить тему" }).length,
    ).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(getMyProfile).toHaveBeenCalled());
  });

  it("EARS-2/10: nav targets resolve to shipped surfaces and «Школы» is absent", async () => {
    renderHeader();
    expect(await screen.findByTestId("shell-nav-broadcasts")).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByTestId("shell-nav-my-events")).toHaveAttribute(
      "href",
      "/account/events",
    );
    expect(screen.getByTestId("shell-logo")).toHaveAttribute("href", "/");
    // «Школы» — retired, never rendered in either nav tree.
    expect(screen.queryByText("Школы")).toBeNull();
    await waitFor(() => expect(getMyProfile).toHaveBeenCalled());
  });

  it("EARS-4: a guest sees «Войти» routing to /login — no avatar, no «Выйти»", async () => {
    getMyProfile.mockResolvedValue(null);
    renderHeader();
    const login = await screen.findByTestId("shell-login");
    expect(login).toHaveTextContent("Войти");
    expect(login).toHaveAttribute("href", "/login");
    // No doctor avatar in either tree, and no sign-out anywhere in the header.
    expect(screen.queryByTestId("shell-avatar")).toBeNull();
    expect(screen.queryByTestId("shell-mobile-avatar")).toBeNull();
    expect(screen.queryByText("Выйти")).toBeNull();
  });

  it("EARS-5/6: a logged-in doctor sees the initials avatar icon-link to /account — not a dropdown, no «Выйти»", async () => {
    getMyProfile.mockResolvedValue(DOCTOR);
    renderHeader();
    // Desktop avatar: an anchor (icon-LINK), initials «ВК», to /account.
    const avatar = await screen.findByTestId("shell-avatar");
    expect(avatar.tagName).toBe("A");
    expect(avatar).toHaveAttribute("href", "/account");
    expect(avatar).toHaveTextContent("ВК");
    expect(avatar).toHaveAccessibleName("Мой профиль");
    // It is NOT a button/menu, and there is no «Войти» / «Выйти» for a doctor.
    expect(screen.queryByTestId("shell-login")).toBeNull();
    expect(screen.queryByText("Выйти")).toBeNull();
    // Mobile keeps the single-tap avatar beside `≡` (EARS-6 on mobile).
    const mobileAvatar = screen.getByTestId("shell-mobile-avatar");
    expect(mobileAvatar).toHaveAttribute("href", "/account");
  });

  it("EARS-5: a doctor with no saved display name still gets the avatar affordance (neutral silhouette icon → /account)", async () => {
    getMyProfile.mockResolvedValue({ ...DOCTOR, displayName: null });
    renderHeader();
    const avatar = await screen.findByTestId("shell-avatar");
    expect(avatar).toHaveAttribute("href", "/account");
    expect(avatar).toHaveAccessibleName("Мой профиль");
    // #997: the fallback is a neutral user-silhouette ICON (an aria-hidden svg
    // inside the same icon-link), not a text glyph.
    expect(avatar.querySelector("svg")).not.toBeNull();
    expect(avatar).not.toHaveTextContent("•");
  });

  it("EARS-5: the header re-reads the profile on refreshHeaderAuth() — immediate post-login avatar, no hard reload", async () => {
    // #1004: mounted while a guest (the header is live on /login too) …
    getMyProfile.mockResolvedValue(null);
    renderHeader();
    await screen.findByTestId("shell-login");
    // … then the auth flow completes login and fires the signal — the SAME
    // mounted header (no remount, no hard reload) must swap to the avatar.
    getMyProfile.mockResolvedValue(DOCTOR);
    act(() => refreshHeaderAuth());
    const avatar = await screen.findByTestId("shell-avatar");
    expect(avatar).toHaveTextContent("ВК");
    expect(screen.queryByTestId("shell-login")).toBeNull();
    expect(getMyProfile).toHaveBeenCalledTimes(2);
  });

  it("EARS-5: the header re-reads the profile on refreshHeaderAuth() after logout — immediate guest affordance, no hard reload", async () => {
    // #1004 mirror: mounted while a doctor …
    getMyProfile.mockResolvedValue(DOCTOR);
    renderHeader();
    await screen.findByTestId("shell-avatar");
    // … then the logout flow revokes the session and fires the signal — the
    // SAME mounted header must flip back to «Войти» without a hard reload.
    getMyProfile.mockResolvedValue(null);
    act(() => refreshHeaderAuth());
    const login = await screen.findByTestId("shell-login");
    expect(login).toHaveTextContent("Войти");
    expect(screen.queryByTestId("shell-avatar")).toBeNull();
    expect(getMyProfile).toHaveBeenCalledTimes(2);
  });

  it("EARS-2/5: on-blue press states stay readable — the DS base press colour (blue.700 = the header band) is re-anchored per surface (#1007 Stage-B)", async () => {
    getMyProfile.mockResolvedValue(DOCTOR);
    renderHeader();
    const avatar = await screen.findByTestId("shell-avatar");
    // Desktop nav links sit ON the blue band: the primitive's
    // `active:text-primary-action/80` is blue.700 = the band itself (a press
    // painted the label invisible for the whole click-through) — they press
    // to full-strength `header-foreground` + a PER-BRANCH element-opacity
    // step (#270; owner rule Stage-B round 2: press = one visible step down
    // from the tier it transitions from). pathname is "/" here, so «Эфиры»
    // is the route-active branch (rest 100 → press 80) and «Мои события» the
    // inactive one (rest 80 → press 60).
    const broadcasts = screen.getByTestId("shell-nav-broadcasts");
    expect(broadcasts.className).toContain("active:text-header-foreground");
    expect(broadcasts.className).toContain("active:opacity-80");
    expect(broadcasts.className).not.toContain("active:text-primary-action/80");
    const myEvents = screen.getByTestId("shell-nav-my-events");
    expect(myEvents.className).toContain("active:text-header-foreground");
    expect(myEvents.className).toContain("opacity-80"); // resting tier
    expect(myEvents.className).toContain("active:opacity-60");
    expect(myEvents.className).not.toContain("active:text-primary-action/80");
    // White chips (avatar, desktop + mobile): rest → hover sinks 1px with
    // shadow-btn-hover → press sinks 2px and drops the shadow (the DS Button
    // press language), ink pinned to full-strength `header` (the base press
    // tint goes near-white on the white chip in dark theme).
    for (const el of [avatar, screen.getByTestId("shell-mobile-avatar")]) {
      expect(el.className).toContain("hover:translate-x-px");
      expect(el.className).toContain("hover:shadow-btn-hover");
      expect(el.className).toContain("active:translate-x-0.5");
      expect(el.className).toContain("active:shadow-none");
      expect(el.className).toContain("active:text-header");
      expect(el.className).not.toContain("active:text-primary-action/80");
    }
    // The mobile dropdown nav links sit on the card surface, where the DS
    // base press colour is readable in both themes — it must stay.
    for (const id of ["shell-mobile-broadcasts", "shell-mobile-my-events"]) {
      expect(screen.getByTestId(id).className).toContain(
        "active:text-primary-action/80",
      );
    }
  });

  it("EARS-4: guest «Войти» chips keep readable press colours on their own surface (#1007 Stage-B)", async () => {
    getMyProfile.mockResolvedValue(null);
    renderHeader();
    // Desktop chip: white chip on the blue band — press = the DS Button
    // language one step past its 1px hover (sink 2px, drop the shadow), ink
    // pinned to full-strength `header`.
    const login = await screen.findByTestId("shell-login");
    expect(login.className).toContain("hover:translate-x-px");
    expect(login.className).toContain("active:translate-x-0.5");
    expect(login.className).toContain("active:shadow-none");
    expect(login.className).toContain("active:text-header");
    expect(login.className).not.toContain("active:text-primary-action/80");
    // Mobile dropdown chip: blue chip on the card — rest 100 → hover 90 →
    // press 80, one visible element-opacity step per state (#270); ink pinned
    // to its white foreground, never the base blue.700 (= its own background).
    const mobileLogin = screen.getByTestId("shell-mobile-login");
    expect(mobileLogin.className).toContain("hover:opacity-90");
    expect(mobileLogin.className).toContain("active:text-header-foreground");
    expect(mobileLogin.className).toContain("active:opacity-80");
    expect(mobileLogin.className).not.toContain("active:text-primary-action/80");
  });

  it("EARS-11: the mobile `≡` dropdown carries the same [Эфиры · Мои события] targets", async () => {
    renderHeader();
    const menu = await screen.findByTestId("shell-mobile-menu");
    expect(menu.tagName).toBe("DETAILS");
    const broadcasts = within(menu).getByTestId("shell-mobile-broadcasts");
    const myEvents = within(menu).getByTestId("shell-mobile-my-events");
    expect(broadcasts).toHaveTextContent("Эфиры");
    expect(broadcasts).toHaveAttribute("href", "/");
    expect(myEvents).toHaveTextContent("Мои события");
    expect(myEvents).toHaveAttribute("href", "/account/events");
    await waitFor(() => expect(getMyProfile).toHaveBeenCalled());
  });

  it("EARS-13: header copy comes from the NextIntl catalog, not hardcoded literals", async () => {
    // A mutated catalog proves the strings are read from the provider.
    renderHeader({
      shell: {
        ...CATALOG.shell,
        navBroadcasts: "ЭФИРЫ_ИЗ_КАТАЛОГА",
        login: "ВОЙТИ_ИЗ_КАТАЛОГА",
      },
    });
    expect(
      await screen.findByTestId("shell-nav-broadcasts"),
    ).toHaveTextContent("ЭФИРЫ_ИЗ_КАТАЛОГА");
    expect(screen.getByTestId("shell-login")).toHaveTextContent(
      "ВОЙТИ_ИЗ_КАТАЛОГА",
    );
  });

  describe("route visibility", () => {
    for (const route of [
      "/login",
      "/register",
      "/verify",
      "/reset",
      "/webinars/abc/room",
    ]) {
      it(`renders nothing on ${route} (surface owns its own chrome)`, () => {
        pathname = route;
        const { container } = renderHeader();
        expect(container.querySelector("header")).toBeNull();
        expect(screen.queryByTestId("shell-logo")).toBeNull();
      });
    }

    for (const route of ["/", "/account", "/account/events", "/webinars/abc"]) {
      it(`renders the header on ${route}`, async () => {
        pathname = route;
        renderHeader();
        expect(await screen.findByTestId("shell-logo")).toBeInTheDocument();
      });
    }
  });
});
