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
