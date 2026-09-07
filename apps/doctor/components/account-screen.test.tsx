// @vitest-environment jsdom
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MyProfile } from "@ds/schemas";

/**
 * 017 EARS-1 / 003 EARS-9/10 (#1958) — the BEHAVIOUR of the doctor storefront's
 * `/account` projection: exactly the half the shared block does not own.
 *
 * This is the app's first jsdom test, the tier `vitest.config.ts` reserved for
 * "client-side BEHAVIOUR" (component-testing.md); the node tier next door still
 * covers what merely reaches the HTML. What is asserted here is the HOST
 * contract — the host-relative recovery row (`/reset` is this storefront's own
 * surface since #1989, so the row no longer crosses to the Academy), the
 * honest-empty events row, the EARS-9 silent-refresh-then-retry with its
 * `/login?returnTo=%2Faccount` fallback, the EARS-10 landing on the storefront
 * home plus the server re-render, and the #175 save-error mapping. The
 * composition itself (rows, inline edit, testid contract) is asserted once in
 * `packages/design-system/src/blocks/account-profile-card.test.tsx`.
 */

const h = vi.hoisted(() => {
  class StorefrontAuthError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
      this.name = "StorefrontAuthError";
    }
  }
  return {
    StorefrontAuthError,
    getMyProfile: vi.fn(),
    refreshStorefrontSession: vi.fn(),
    logoutStorefront: vi.fn(),
    setDoctorDisplayName: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  };
});

// STABLE router object: `load` depends on `router`, and a fresh object per
// render would refire the effect in a loop (the portal suite's #770 lesson).
const router = { push: vi.fn(), replace: h.replace, refresh: h.refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// `next/link` wants the App-Router context this tier does not mount; the anchor
// it renders is the thing these assertions are about, so a passthrough is honest.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/storefront-auth-client", () => ({
  StorefrontAuthError: h.StorefrontAuthError,
  getMyProfile: () => h.getMyProfile(),
  refreshStorefrontSession: () => h.refreshStorefrontSession(),
  logoutStorefront: () => h.logoutStorefront(),
  setDoctorDisplayName: (body: { displayName: string }) =>
    h.setDoctorDisplayName(body),
}));

import { AccountScreen } from "@/components/account-screen";

const PROFILE: MyProfile = {
  email: "doctor@ds.test",
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  displayName: "Анна Смирнова",
};

beforeEach(() => {
  h.replace.mockClear();
  h.refresh.mockClear();
  h.refreshStorefrontSession.mockReset().mockResolvedValue({});
  h.logoutStorefront.mockReset().mockResolvedValue({});
  h.setDoctorDisplayName.mockReset().mockResolvedValue({});
  h.getMyProfile.mockReset().mockResolvedValue(PROFILE);
});
afterEach(cleanup);

/** Render, then wait for the loading state to resolve into the card. */
async function renderReady() {
  render(<AccountScreen />);
  await screen.findByTestId("profile-name");
}

/** Open the inline name edit and press save with the prefilled draft. */
async function saveName(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("profile-name-edit"));
  await user.click(screen.getByTestId("profile-name-save"));
}

describe("017 EARS-1 / 003 EARS-9/10 #1958: the doctor /account projection", () => {
  it("003 EARS-28: the first server paint is the honest loading state in this host own RU copy, never a guest-shaped empty cabinet", () => {
    const html = renderToStaticMarkup(<AccountScreen />);

    expect(html).toContain("Загружаем ваш профиль…");
    expect(html).toContain('role="status"');
    // No identity row is painted before the EARS-27 read resolves.
    expect(html).not.toContain('data-testid="profile-email"');
  });

  it("017 EARS-1.1 (#1989): password recovery stays on THIS host — «Сменить пароль» links to the storefront /reset", async () => {
    await renderReady();

    const link = screen.getByText("Сменить пароль").closest("a");
    expect(link).not.toBeNull();
    // Host-relative since the doctor storefront serves recovery itself; the
    // Academy crossing was the #1933/#1958 interim and is gone.
    expect(link?.getAttribute("href")).toBe("/reset");
  });

  it("017 EARS-1.2: «Мои события» is ABSENT on this host — the row is hidden, not linked at a 404", async () => {
    await renderReady();

    expect(screen.queryByText("Мои события")).toBeNull();
    expect(screen.queryByText("Эфиры, записи и сертификаты")).toBeNull();
    // The rest of the composition is untouched by that omission.
    expect(screen.getByText("Безопасность")).toBeTruthy();
  });

  it("003 EARS-9.1: a 401 profile read gets ONE silent refresh + ONE retry, then renders", async () => {
    h.getMyProfile.mockResolvedValueOnce(null).mockResolvedValueOnce(PROFILE);

    await renderReady();

    expect(h.refreshStorefrontSession).toHaveBeenCalledTimes(1);
    expect(h.getMyProfile).toHaveBeenCalledTimes(2);
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("003 EARS-9.2: a read that stays 401 after the refresh sends the doctor to the door with the return context", async () => {
    h.getMyProfile.mockResolvedValue(null);

    render(<AccountScreen />);

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/login?returnTo=%2Faccount"),
    );
    expect(h.refreshStorefrontSession).toHaveBeenCalledTimes(1);
    expect(h.getMyProfile).toHaveBeenCalledTimes(2);
  });

  it("003 EARS-9.3: a refresh that itself refuses is not retried — one dance, then the door", async () => {
    h.getMyProfile.mockResolvedValue(null);
    h.refreshStorefrontSession.mockRejectedValue(
      new h.StorefrontAuthError(401, "no session"),
    );

    render(<AccountScreen />);

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/login?returnTo=%2Faccount"),
    );
    expect(h.getMyProfile).toHaveBeenCalledTimes(1);
  });

  it("003 EARS-9.4: an upstream failure that is not a 401 shows the error state instead of bouncing", async () => {
    h.getMyProfile.mockRejectedValue(new h.StorefrontAuthError(503, "down"));

    render(<AccountScreen />);

    await screen.findByRole("alert");
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("003 EARS-10: sign-out revokes server-side, then lands on the storefront home and re-renders the server shell", async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByTestId("logout"));

    await waitFor(() => expect(h.logoutStorefront).toHaveBeenCalledTimes(1));
    expect(h.replace).toHaveBeenCalledWith("/");
    // Without the re-render the 017 header keeps its signed-in cluster.
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("003 EARS-10.1: the doctor still leaves when the revoke round-trip fails", async () => {
    const user = userEvent.setup();
    h.logoutStorefront.mockRejectedValue(new Error("network"));
    await renderReady();

    await user.click(screen.getByTestId("logout"));

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/"));
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("#175.1: a 429 save is mapped onto the rate-limit message, not the generic one", async () => {
    const user = userEvent.setup();
    h.setDoctorDisplayName.mockRejectedValue(
      new h.StorefrontAuthError(429, "too many"),
    );
    await renderReady();

    await saveName(user);

    expect(
      await screen.findByText(
        "Слишком много попыток — повторите через несколько минут.",
      ),
    ).toBeTruthy();
  });

  it("#175.2: a 5xx save is mapped onto the temporarily-unavailable message", async () => {
    const user = userEvent.setup();
    h.setDoctorDisplayName.mockRejectedValue(
      new h.StorefrontAuthError(503, "down"),
    );
    await renderReady();

    await saveName(user);

    expect(
      await screen.findByText(
        "Сервис временно недоступен — попробуйте ещё раз.",
      ),
    ).toBeTruthy();
  });

  it("#175.3: another refusal is the generic retry message, and a thrown fetch is not a validation outcome", async () => {
    const user = userEvent.setup();
    h.setDoctorDisplayName.mockRejectedValue(
      new h.StorefrontAuthError(400, "bad"),
    );
    await renderReady();
    await saveName(user);
    expect(
      await screen.findByText("Не удалось сохранить. Попробуйте ещё раз."),
    ).toBeTruthy();

    cleanup();
    h.setDoctorDisplayName.mockRejectedValue(new TypeError("Failed to fetch"));
    await renderReady();
    await saveName(user);
    expect(
      await screen.findByText(
        "Сервис временно недоступен — попробуйте ещё раз.",
      ),
    ).toBeTruthy();
  });

  it("003 EARS-27: a successful save persists through the HOST transport and leaves edit mode", async () => {
    const user = userEvent.setup();
    await renderReady();

    await saveName(user);

    await waitFor(() =>
      expect(h.setDoctorDisplayName).toHaveBeenCalledWith({
        displayName: "Анна Смирнова",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("profile-name-input")).toBeNull(),
    );
  });
});
