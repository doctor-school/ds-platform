// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

/**
 * 008 EARS-4/5/6 / EARS-13 — the academy host's half of the shared chrome: the
 * auth slot's three states and the host VALUES the package renders.
 *
 * The chrome composition — the logo, the nav, the theme toggle, the mobile
 * disclosure, the route hiding — is proven once in
 * `packages/storefront-shell/src/shell.test.tsx`, driven by BOTH host configs.
 * Re-asserting it here would be re-testing the package. What is host-owned is
 * the session read this slot branches on and the values fed into the config.
 */

// The session read the account affordance branches on.
const getMyProfile = vi.fn();
vi.mock("@/lib/profile-client", () => ({
  getMyProfile: () => getMyProfile(),
  ProfileError: class extends Error {},
}));

import { AcademyAuthCluster } from "./academy-auth-cluster";
import { refreshHeaderAuth } from "@/lib/header-auth";
import { academyShellConfig, type ShellConfigKey } from "@/lib/shell-config";
import catalog from "../messages/ru.json";

const MESSAGES = { shell: catalog.shell };

const DOCTOR = {
  email: "doctor@ds.test",
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  displayName: "Виктор Ковалёв",
};

function renderCluster() {
  return render(
    <NextIntlClientProvider locale="ru" messages={MESSAGES}>
      <AcademyAuthCluster />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  getMyProfile.mockReset().mockResolvedValue(null); // default: guest
});
afterEach(cleanup);

describe("008 EARS-4/5/6: the academy auth cluster", () => {
  it("008 EARS-4.1: an unresolved read reserves the box and offers neither branch", () => {
    // The promise never settles in this turn, so the cluster is still `loading`:
    // no «Войти», no avatar — and no layout shift when one of them arrives.
    getMyProfile.mockReturnValue(new Promise(() => {}));
    renderCluster();

    expect(screen.queryByTestId("shell-login")).toBeNull();
    expect(screen.queryByTestId("shell-avatar")).toBeNull();
  });

  it("008 EARS-4.2: a guest gets «Войти» → /login and no avatar", async () => {
    renderCluster();

    const login = await screen.findByTestId("shell-login");
    expect(login).toHaveAttribute("href", "/login");
    expect(screen.queryByTestId("shell-avatar")).toBeNull();
  });

  it("008 EARS-5/6: a signed-in doctor gets the initials avatar LINK to /account, never a dropdown", async () => {
    getMyProfile.mockResolvedValue(DOCTOR);
    renderCluster();

    const avatar = await screen.findByTestId("shell-avatar");
    expect(avatar).toHaveAttribute("href", "/account");
    expect(avatar).toHaveTextContent("ВК");
    expect(screen.queryByTestId("shell-login")).toBeNull();
    expect(screen.queryByRole("button", { name: /Выйти/ })).toBeNull();
  });

  it("#1004: the cluster swaps «Войти» → avatar on the post-login refresh signal, with no reload", async () => {
    renderCluster();
    await screen.findByTestId("shell-login");

    getMyProfile.mockResolvedValue(DOCTOR);
    await act(async () => {
      refreshHeaderAuth();
    });

    await waitFor(() =>
      expect(screen.getByTestId("shell-avatar")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("shell-login")).toBeNull();
  });
});

describe("008 EARS-2/12/13/14: the academy host config", () => {
  const config = academyShellConfig(
    (key: ShellConfigKey) => (catalog.shell as Record<string, string>)[key]!,
  );

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
