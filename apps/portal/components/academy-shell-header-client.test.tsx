// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * 008 EARS-4/5/6 / EARS-13 — the academy host's half of the shared chrome: the
 * session read its client leaf performs, and the host VALUES the package
 * renders.
 *
 * The chrome composition — the logo, the nav, the theme toggle, the mobile
 * disclosure, the route hiding, and since #2180 the auth chip's own look — is
 * proven once in `packages/storefront-shell/src/shell.test.tsx`, driven by BOTH
 * host configs. Re-asserting it here would be re-testing the package. What is
 * host-owned is the session read this leaf branches on and the values fed into
 * the config.
 */

// The chrome hides itself on the auth surfaces and in the room, so the header
// reads the pathname; every assertion below is made on a visible route.
vi.mock("next/navigation", () => ({ usePathname: () => "/webinars" }));

// The session read the account affordance branches on.
const getMyProfile = vi.fn();
vi.mock("@/lib/profile-client", () => ({
  getMyProfile: () => getMyProfile(),
  ProfileError: class extends Error {},
}));

import { AcademyShellHeaderClient } from "./academy-shell-header-client";
import { refreshShellAuth } from "@ds/storefront-shell";
import { academyShellConfig, type ShellConfigKey } from "@/lib/shell-config";
import catalog from "../messages/ru.json";

const DOCTOR = {
  email: "doctor@ds.test",
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  displayName: "Виктор Ковалёв",
};

const config = academyShellConfig(
  (key: ShellConfigKey) => (catalog.shell as Record<string, string>)[key]!,
);

function renderHeader() {
  return render(
    <AcademyShellHeaderClient
      config={config}
      loginLabel={catalog.shell.login}
      profileLabel={catalog.shell.profile}
      myEventsLabel={catalog.shell.myEvents}
    />,
  );
}

beforeEach(() => {
  getMyProfile.mockReset().mockResolvedValue(null); // default: guest
});
afterEach(cleanup);

describe("008 EARS-4/5/6: the academy auth cluster", () => {
  it("008 EARS-4.1: an unresolved read reserves the box and offers neither branch", () => {
    // The promise never settles in this turn, so the state is still `loading`:
    // no «Войти», no avatar — and no layout shift when one of them arrives.
    getMyProfile.mockReturnValue(new Promise(() => {}));
    renderHeader();

    expect(screen.getByTestId("shell-auth-cluster")).toHaveAttribute(
      "data-cluster",
      "loading",
    );
    expect(screen.queryByTestId("shell-login")).toBeNull();
    expect(screen.queryByTestId("shell-avatar")).toBeNull();
  });

  it("008 EARS-4.2: a guest gets «Войти / Регистрация» → /login and no avatar", async () => {
    renderHeader();

    const login = await screen.findByTestId("shell-login");
    expect(login).toHaveAttribute("href", "/login");
    // The canvas `ds-shell.dc.html` guest cluster is ONE combined label on both
    // hosts (line 220) — a bare «Войти» here was the #2198 Stage-B finding.
    expect(login).toHaveTextContent("Войти / Регистрация");
    expect(screen.queryByTestId("shell-avatar")).toBeNull();
  });

  it("008 EARS-5/6: a signed-in doctor gets the initials avatar LINK to /account, never a dropdown", async () => {
    getMyProfile.mockResolvedValue(DOCTOR);
    renderHeader();

    const avatar = await screen.findByTestId("shell-avatar");
    expect(avatar).toHaveAttribute("href", "/account");
    expect(avatar).toHaveTextContent("ВК");
    expect(avatar).toHaveAccessibleName(catalog.shell.profile);
    expect(screen.queryByTestId("shell-login")).toBeNull();
    expect(screen.queryByRole("button", { name: /Выйти/ })).toBeNull();
  });

  it("008 EARS-5: the signed-in cluster carries «Мои события» → /account/events", async () => {
    // #2243 — the canvas `user.links` line 209. Lost when the academy moved onto
    // the shared chrome (#2198), because the 2026-09-10 top-nav decision was
    // read as if it covered the auth cluster too.
    getMyProfile.mockResolvedValue(DOCTOR);
    renderHeader();

    const link = await screen.findByTestId("shell-auth-link");
    expect(link).toHaveAttribute("href", "/account/events");
    expect(link).toHaveTextContent(catalog.shell.myEvents);
  });

  it("008 EARS-5: a guest gets no «Мои события» link", async () => {
    renderHeader();

    await screen.findByTestId("shell-login");
    expect(screen.queryByTestId("shell-auth-link")).toBeNull();
    expect(screen.queryByTestId("shell-auth-link-mobile")).toBeNull();
  });

  it("#1004: the cluster swaps «Войти» → avatar on the post-login refresh signal, with no reload", async () => {
    renderHeader();
    await screen.findByTestId("shell-login");

    getMyProfile.mockResolvedValue(DOCTOR);
    await act(async () => {
      refreshShellAuth();
    });

    await waitFor(() =>
      expect(screen.getByTestId("shell-avatar")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("shell-login")).toBeNull();
  });
});

describe("008 EARS-2/12/13/14: the academy host config", () => {
  it("008 EARS-13: every string is read from the catalog, none hardcoded", () => {
    expect(config.logo.alt).toBe(catalog.shell.logoAlt);
    expect(config.nav[0]!.label).toBe(catalog.shell.navBroadcasts);
    expect(config.footer.giant.text).toBe(catalog.shell.footerGiant);
  });

  it("008 EARS-2: the nav is «Эфиры» alone, pointing at the canonical listing", () => {
    expect(config.nav).toHaveLength(1);
    expect(config.nav[0]!.href).toBe("/webinars");
    expect(config.logo.href).toBe("/webinars");
  });

  it("008 EARS-1: this storefront ships no header search", () => {
    expect(config.search).toBeNull();
  });

  it("008 EARS-12: the chrome hides on the auth surfaces and in the room, and nowhere else", () => {
    expect(config.hiddenOnPaths).toEqual([
      "/login",
      "/register",
      "/verify",
      "/reset",
      "/webinars/*/room",
    ]);
  });

  it("017 EARS-12: exactly one crossing out, and it is the doctor storefront", () => {
    const crossings = JSON.stringify(config).match(/doctor\.school/g) ?? [];
    expect(crossings).toHaveLength(1);
    expect(config.footer.cross.href).toBe("https://doctor.school/");
  });
});
