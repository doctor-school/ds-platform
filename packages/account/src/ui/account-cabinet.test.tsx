import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@ds/auth-flow/client";
import { ACADEMY_FIXTURE } from "@ds/auth-flow/test-support";
import type { MyProfile } from "@ds/schemas";

import type { AccountHostConfig } from "../host-config";
import { AccountCabinet } from "./account-cabinet";
import { accountCabinetProps } from "./account-cabinet-props";

/**
 * 003 EARS-28 (design §12; GH #770) — the ONE account cabinet (wave-4 gate rows
 * 2–17), moved from the Academy's `apps/portal/app/account/account-profile.tsx`
 * with its tests. The surface renders the EARS-27 identity projection (email +
 * verified badge, phone with the explicit «не указан» empty state, display name
 * with inline edit through the EXISTING `PUT /v1/me/display-name`), and the raw
 * session claims — `sub`, the roles array, the `mfa` boolean — never reach the
 * DOM (requirements Invariants). The composition itself is asserted once in
 * `packages/design-system/src/blocks/account-profile-card.test.tsx`; this suite
 * pins the controller: the reads, the EARS-9 dance, save, sign-out and the host
 * values the config supplies.
 */

const h = vi.hoisted(() => ({
  profile: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  setDisplayName: vi.fn(),
  requestPhoneCode: vi.fn(),
  confirmPhone: vi.fn(),
  fetchSection: vi.fn(),
  createAuthClient: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  routerRefresh: vi.fn(),
}));

// STABLE router object — the load callback depends on `router` (the real
// next/navigation router is a stable instance); a fresh object per render would
// refire the load effect in a loop and overwrite the inline-edit save.
const router = { push: h.push, replace: h.replace, refresh: h.routerRefresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// `next/link` wants the App-Router context this tier does not mount; the anchor
// it renders is what these assertions are about, so a passthrough is honest.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

// The cabinet builds its client from the host's `api` (gate D1/D2); the bound
// transport is replaced, the rest of the client module (AuthError, the phone
// doors) stays real.
vi.mock("@ds/auth-flow/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/auth-flow/client")>()),
  createAuthClient: (api: unknown) => {
    h.createAuthClient(api);
    return {
      profile: () => h.profile(),
      refresh: () => h.refresh(),
      logout: () => h.logout(),
      setDisplayName: (body: { displayName: string }) => h.setDisplayName(body),
      requestPhoneCode: (body: { phone: string }) => h.requestPhoneCode(body),
      confirmPhone: (body: { code: string }) => h.confirmPhone(body),
    };
  },
}));

vi.mock("@ds/congress-submissions/client", () => ({
  fetchSection: () => h.fetchSection(),
}));

// A raw-claims fixture that must NEVER surface in this DOM.
const RAW_SUB = "327137245234623476";

const PROFILE: MyProfile = {
  email: "doctor@ds.test",
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  displayName: "Анна Смирнова",
  suggestedPhone: null,
};

const ACADEMY: AccountHostConfig = {
  authFlow: ACADEMY_FIXTURE,
  eventsHref: "/account/events",
  congress: null,
};
const WITH_CONGRESS: AccountHostConfig = {
  ...ACADEMY,
  congress: { path: "/account/congress" },
};

function renderCabinet(config: AccountHostConfig = ACADEMY) {
  return render(<AccountCabinet {...accountCabinetProps(config)} />);
}

/** Render, then wait for the loading state to resolve into the card. */
async function renderReady(config: AccountHostConfig = ACADEMY) {
  const view = renderCabinet(config);
  await screen.findByTestId("profile-name");
  return view;
}

/** Open the inline name edit and press save with the prefilled draft. */
async function saveName(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("profile-name-edit"));
  await user.click(screen.getByTestId("profile-name-save"));
}

beforeEach(() => {
  h.push.mockClear();
  h.replace.mockClear();
  h.routerRefresh.mockClear();
  h.createAuthClient.mockClear();
  h.logout.mockReset().mockResolvedValue({});
  h.refresh.mockReset().mockResolvedValue({});
  h.setDisplayName.mockReset().mockResolvedValue({});
  h.profile.mockReset().mockResolvedValue(PROFILE);
  h.requestPhoneCode.mockReset().mockResolvedValue({ status: "code_sent" });
  h.confirmPhone
    .mockReset()
    .mockRejectedValue(new AuthError(400, "invalid code"));
  h.fetchSection.mockReset().mockResolvedValue({ registered: false });
});

describe("003 EARS-28 /account profile surface", () => {
  it("renders the EARS-27 identity fields — email + verified badge, null phone as the explicit empty state, saved display name with initials", async () => {
    renderCabinet();

    expect(await screen.findByTestId("profile-email")).toHaveTextContent(
      PROFILE.email,
    );
    // Verified badge present exactly because emailVerified is true.
    expect(screen.getByTestId("profile-email-verified")).toBeInTheDocument();
    // Null phone → the explicit empty state, never a blank.
    expect(screen.getByTestId("profile-phone")).toHaveTextContent("не указан");
    // Saved display name + its derived initials plate (АС, never email-derived).
    expect(screen.getByTestId("profile-name")).toHaveTextContent(
      PROFILE.displayName!,
    );
    expect(screen.getByTestId("profile-avatar")).toHaveTextContent("АС");
    // Logout keeps its stable contract.
    expect(screen.getByTestId("logout")).toBeInTheDocument();
  });

  it("builds its transport from the host's auth-flow api (gate D2)", async () => {
    await renderReady();
    expect(h.createAuthClient).toHaveBeenCalledWith(ACADEMY_FIXTURE.api);
  });

  it("carries NO raw session claims in the DOM — no sub, no roles, no mfa (requirements Invariants)", async () => {
    h.profile.mockResolvedValue({ ...PROFILE, displayName: null });
    const { container } = renderCabinet();
    await screen.findByTestId("profile-email");

    // The legacy claim testids are gone…
    expect(screen.queryByTestId("session-sub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-roles")).not.toBeInTheDocument();
    // …and no claim value or claim wording appears anywhere in the rendered DOM.
    const dom = container.innerHTML;
    expect(dom).not.toContain(RAW_SUB);
    expect(dom.toLowerCase()).not.toContain("mfa");
    expect(dom).not.toContain("doctor_guest");
    // Unset display name renders the empty state, no fabricated initials.
    expect(screen.getByTestId("profile-name")).toHaveTextContent("не указано");
    expect(screen.queryByTestId("profile-avatar")).not.toBeInTheDocument();
  });

  it("hides the verified badge when the email is not verified", async () => {
    h.profile.mockResolvedValue({ ...PROFILE, emailVerified: false });
    renderCabinet();
    await screen.findByTestId("profile-email");
    expect(
      screen.queryByTestId("profile-email-verified"),
    ).not.toBeInTheDocument();
  });

  it("inline-edits the display name through the EXISTING PUT /v1/me/display-name (trimmed), Enter submits, Escape cancels", async () => {
    const user = userEvent.setup();
    renderCabinet();
    await screen.findByTestId("profile-name-edit");

    // Изменить → input primed with the current name.
    await user.click(screen.getByTestId("profile-name-edit"));
    const input = screen.getByTestId("profile-name-input");
    expect(input).toHaveValue(PROFILE.displayName);

    // Escape cancels without a write.
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("profile-name-input")).not.toBeInTheDocument();
    expect(h.setDisplayName).not.toHaveBeenCalled();

    // Re-open, type a padded name, Enter saves the TRIMMED value via the
    // existing write and the row re-renders with it.
    await user.click(screen.getByTestId("profile-name-edit"));
    await user.clear(screen.getByTestId("profile-name-input"));
    await user.type(
      screen.getByTestId("profile-name-input"),
      "  Пётр Иванов  {Enter}",
    );
    await waitFor(() =>
      expect(h.setDisplayName).toHaveBeenCalledWith({
        displayName: "Пётр Иванов",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("profile-name")).toHaveTextContent(
        "Пётр Иванов",
      ),
    );
  });

  it("008 EARS-5: a saved display name re-renders the server header, so the chip's initials follow the edit (#2281)", async () => {
    const user = userEvent.setup();
    renderCabinet();
    await user.click(await screen.findByTestId("profile-name-edit"));
    await user.clear(screen.getByTestId("profile-name-input"));
    await user.type(
      screen.getByTestId("profile-name-input"),
      "Пётр Иванов{Enter}",
    );

    await waitFor(() => expect(h.routerRefresh).toHaveBeenCalledTimes(1));
    // The refresh follows the write, never races ahead of it.
    expect(h.setDisplayName.mock.invocationCallOrder[0]!).toBeLessThan(
      h.routerRefresh.mock.invocationCallOrder[0]!,
    );
  });

  it("EARS-9: a 401 profile read gets one silent refresh + retry before redirecting to /login (behavior unchanged)", async () => {
    h.profile.mockResolvedValueOnce(null).mockResolvedValueOnce(PROFILE);
    renderCabinet();

    expect(await screen.findByTestId("profile-email")).toBeInTheDocument();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.profile).toHaveBeenCalledTimes(2);
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("003 EARS-9.3: a refresh that itself refuses is not retried — one dance, then the door", async () => {
    h.profile.mockResolvedValue(null);
    h.refresh.mockRejectedValue(new AuthError(401, "no session"));
    renderCabinet();

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/login?returnTo=%2Faccount"),
    );
    expect(h.profile).toHaveBeenCalledTimes(1);
  });

  /**
   * 014 EARS-6 / #1987 — the cabinet door carries the cabinet as its return
   * target, so a doctor whose session expired while the cabinet was open and who
   * signs back in comes BACK to it. The same carry the server guard makes,
   * through the same shared helper (gate D3).
   */
  it("014 EARS-6.7: a guest whose profile read stays 401 is sent to /login carrying /account as the returnTo", async () => {
    h.profile.mockResolvedValue(null);
    renderCabinet();
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/login?returnTo=%2Faccount"),
    );
  });

  it("003 EARS-9.4: an upstream failure that is not a 401 shows the error state instead of bouncing", async () => {
    h.profile.mockRejectedValue(new AuthError(503, "down"));
    renderCabinet();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось загрузить профиль. Обновите страницу.",
    );
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("logout revokes server-side then routes to the storefront home (EARS-10, #2488, stable data-testid)", async () => {
    const user = userEvent.setup();
    renderCabinet();
    await screen.findByTestId("logout");

    await user.click(screen.getByTestId("logout"));
    await waitFor(() => expect(h.logout).toHaveBeenCalledTimes(1));
    // Bare: a doctor who signed OUT asked to leave the cabinet, so the home
    // carries no return target back into it (014 EARS-6 is the guest bounce,
    // not the deliberate exit). #2488: the same `/` on both storefronts.
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/"));
  });

  it("003 EARS-10.1: the doctor still leaves when the revoke round-trip fails, and the failure is swallowed", async () => {
    const user = userEvent.setup();
    h.logout.mockRejectedValue(new Error("network"));
    await renderReady();

    await user.click(screen.getByTestId("logout"));

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/"));
    expect(h.routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("008 EARS-5: logout drops the client Router Cache, so browser Back re-reads the server header as guest (#2281)", async () => {
    const user = userEvent.setup();
    renderCabinet();
    await user.click(await screen.findByTestId("logout"));

    await waitFor(() => expect(h.routerRefresh).toHaveBeenCalledTimes(1));
    // Order: revoke → leave → invalidate. The refresh after the replace is what
    // stops Back from replaying the pre-logout `@chrome` payload (signed-in chip).
    expect(h.logout.mock.invocationCallOrder[0]!).toBeLessThan(
      h.replace.mock.invocationCallOrder[0]!,
    );
    expect(h.replace.mock.invocationCallOrder[0]!).toBeLessThan(
      h.routerRefresh.mock.invocationCallOrder[0]!,
    );
  });

  it("003 EARS-11/12: «Сменить пароль» links to the host reset route carrying the account route", async () => {
    await renderReady();
    const link = screen.getByText("Сменить пароль").closest("a");
    expect(link?.getAttribute("href")).toBe("/reset?returnTo=%2Faccount");
  });

  it("014 EARS-9: the «Мои события» row links at the configured route", async () => {
    await renderReady({ ...ACADEMY, eventsHref: "/somewhere/events" });
    const row = screen.getByText("Мои события");
    expect(row.closest("a")?.getAttribute("href")).toBe("/somewhere/events");
    expect(screen.getByText("Эфиры, записи и сертификаты")).toBeTruthy();
  });
});

describe("#175: a failed display-name save is mapped through the shared auth error mapper", () => {
  it("#175.1: a 429 save is mapped onto the rate-limit message, not the generic one", async () => {
    const user = userEvent.setup();
    h.setDisplayName.mockRejectedValue(new AuthError(429, "too many"));
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
    h.setDisplayName.mockRejectedValue(new AuthError(503, "down"));
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
    h.setDisplayName.mockRejectedValue(new AuthError(400, "bad"));
    await renderReady();
    await saveName(user);
    expect(
      await screen.findByText("Не удалось сохранить. Попробуйте ещё раз."),
    ).toBeTruthy();

    cleanup();
    h.setDisplayName.mockRejectedValue(new TypeError("Failed to fetch"));
    await renderReady();
    await saveName(user);
    expect(
      await screen.findByText(
        "Сервис временно недоступен — попробуйте ещё раз.",
      ),
    ).toBeTruthy();
  });
});

describe("046 EARS-4: the «Мои заявки на Конгресс» row follows the host config", () => {
  it("046 EARS-4: with congress null no section read is made and no row renders", async () => {
    await renderReady(ACADEMY);
    expect(h.fetchSection).not.toHaveBeenCalled();
    expect(screen.queryByText("Мои заявки на Конгресс")).toBeNull();
  });

  it("046 EARS-4: an account registered for the congress gets the row linking at the configured section path", async () => {
    h.fetchSection.mockResolvedValue({ registered: true });
    await renderReady(WITH_CONGRESS);
    const row = await screen.findByText("Мои заявки на Конгресс");
    expect(row.closest("a")?.getAttribute("href")).toBe("/account/congress");
  });

  it("046 EARS-4: without a registration — or when the section read fails — the row is absent", async () => {
    await renderReady(WITH_CONGRESS);
    await waitFor(() => expect(h.fetchSection).toHaveBeenCalled());
    expect(screen.queryByText("Мои заявки на Конгресс")).toBeNull();

    cleanup();
    h.fetchSection.mockRejectedValue(new Error("offline"));
    await renderReady(WITH_CONGRESS);
    await waitFor(() => expect(h.fetchSection).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Мои заявки на Конгресс")).toBeNull();
  });
});

describe("003 EARS-28: the first paint", () => {
  it("003 EARS-28: the first server paint is the loading status in the default copy, never a guest-shaped empty cabinet", () => {
    const html = renderToStaticMarkup(
      <AccountCabinet {...accountCabinetProps(ACADEMY)} />,
    );
    expect(html).toContain("Загружаем ваш профиль…");
    expect(html).toContain('role="status"');
    expect(html).not.toContain('data-testid="profile-email"');
  });
});

describe("008 EARS-14 (#2228): the cabinet does not push the shared footer below the fold", () => {
  it("EARS-14.3: no state wrapper claims min-h-screen — the root layout owns the fill", async () => {
    const { container } = renderCabinet();
    await screen.findByTestId("profile-email");
    expect(container.innerHTML).not.toContain("min-h-screen");
  });
});

describe("#2664 one main landmark per page", () => {
  it("#2664: <AccountCabinet> renders no main landmark — the host shell owns it", async () => {
    renderCabinet();
    await screen.findByTestId("profile-email");
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("#2664: <AccountCabinet> error state renders no main landmark — the host shell owns it", async () => {
    h.profile.mockRejectedValue(new AuthError(503, "down"));
    renderCabinet();
    await screen.findByRole("alert");
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("003 EARS-59: the phone row requests the code through the shared door of THIS host's client and shows the generic wrong-code outcome", async () => {
    const user = userEvent.setup();
    renderCabinet();
    await screen.findByTestId("profile-phone-action");

    await user.click(screen.getByTestId("profile-phone-action"));
    await user.type(screen.getByLabelText("Номер телефона"), "+79134028871");
    await user.click(screen.getByTestId("profile-phone-send"));
    await screen.findByTestId("profile-phone-code-sent");
    await user.keyboard("000000");

    expect(h.requestPhoneCode).toHaveBeenCalledWith({ phone: "+79134028871" });
    expect(h.confirmPhone).toHaveBeenCalledWith({ code: "000000" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный код");
  });
});
