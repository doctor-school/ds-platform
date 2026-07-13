import {
  render,
  screen,
  cleanup,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AccountPage from "./page";

/**
 * 003 EARS-28 (design §12; GH #770) — the /account profile surface renders the
 * EARS-27 identity projection (email + verified badge, phone with the explicit
 * «не указан» empty state, display name with inline edit through the EXISTING
 * `PUT /v1/me/display-name`), and the raw session claims — `sub`, the roles
 * array, the `mfa` boolean — never reach the DOM (requirements Invariants).
 * The full canvas-fidelity render check is the Stage-B live drive; this pins
 * the data contract + the no-claims invariant at the component level.
 */

const push = vi.fn();
const replace = vi.fn();
// STABLE router object — the page's load callback depends on `router` (the real
// next/navigation router is a stable instance); a fresh object per render would
// refire the load effect in a loop and overwrite the inline-edit save.
const router = { push, replace };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

// Passthrough i18n: return the key — assertions ride stable testids, not copy.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const logout = vi.fn().mockResolvedValue({});
const refresh = vi.fn().mockResolvedValue({});
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    logout: () => logout(),
    refresh: () => refresh(),
  },
  AuthError: class extends Error {},
}));

const getMyProfile = vi.fn();
vi.mock("@/lib/profile-client", () => ({
  getMyProfile: () => getMyProfile(),
  ProfileError: class extends Error {},
}));

const setDisplayName = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/display-name-client", () => ({
  setDisplayName: (name: string) => setDisplayName(name),
  DisplayNameError: class extends Error {},
}));

// A raw-claims fixture that must NEVER surface in this DOM.
const RAW_SUB = "327137245234623476";

const PROFILE = {
  email: "doctor@ds.test",
  emailVerified: true,
  phone: null,
  phoneVerified: null,
  displayName: "Анна Смирнова",
};

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  logout.mockClear();
  refresh.mockClear();
  setDisplayName.mockClear();
  getMyProfile.mockReset().mockResolvedValue(PROFILE);
});
afterEach(cleanup);

describe("003 EARS-28 /account profile surface", () => {
  it("renders the EARS-27 identity fields — email + verified badge, null phone as the explicit empty state, saved display name with initials", async () => {
    render(<AccountPage />);

    expect(await screen.findByTestId("profile-email")).toHaveTextContent(
      PROFILE.email,
    );
    // Verified badge present exactly because emailVerified is true.
    expect(screen.getByTestId("profile-email-verified")).toBeInTheDocument();
    // Null phone → the explicit catalog empty state (key passthrough), never a blank.
    expect(screen.getByTestId("profile-phone")).toHaveTextContent("phoneEmpty");
    // Saved display name + its derived initials plate (АС, never email-derived).
    expect(screen.getByTestId("profile-name")).toHaveTextContent(
      PROFILE.displayName,
    );
    expect(screen.getByTestId("profile-avatar")).toHaveTextContent("АС");
    // Logout keeps its stable contract.
    expect(screen.getByTestId("logout")).toBeInTheDocument();
  });

  it("carries NO raw session claims in the DOM — no sub, no roles, no mfa (requirements Invariants)", async () => {
    getMyProfile.mockResolvedValue({ ...PROFILE, displayName: null });
    const { container } = render(<AccountPage />);
    await screen.findByTestId("profile-email");

    // The legacy claim testids are gone…
    expect(screen.queryByTestId("session-sub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-roles")).not.toBeInTheDocument();
    // …and no claim value or claim wording appears anywhere in the rendered DOM.
    const dom = container.innerHTML;
    expect(dom).not.toContain(RAW_SUB);
    expect(dom.toLowerCase()).not.toContain("mfa");
    expect(dom).not.toContain("doctor_guest");
    // Unset display name renders the catalog empty state, no fabricated initials.
    expect(screen.getByTestId("profile-name")).toHaveTextContent("nameEmpty");
    expect(screen.queryByTestId("profile-avatar")).not.toBeInTheDocument();
  });

  it("hides the verified badge when the email is not verified", async () => {
    getMyProfile.mockResolvedValue({ ...PROFILE, emailVerified: false });
    render(<AccountPage />);
    await screen.findByTestId("profile-email");
    expect(
      screen.queryByTestId("profile-email-verified"),
    ).not.toBeInTheDocument();
  });

  it("inline-edits the display name through the EXISTING PUT /v1/me/display-name (trimmed), Enter submits, Escape cancels", async () => {
    const user = userEvent.setup();
    render(<AccountPage />);
    await screen.findByTestId("profile-name-edit");

    // Изменить → input primed with the current name.
    await user.click(screen.getByTestId("profile-name-edit"));
    const input = screen.getByTestId("profile-name-input");
    expect(input).toHaveValue(PROFILE.displayName);

    // Escape cancels without a write.
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("profile-name-input")).not.toBeInTheDocument();
    expect(setDisplayName).not.toHaveBeenCalled();

    // Re-open, type a padded name, Enter saves the TRIMMED value via the
    // existing write and the row re-renders with it.
    await user.click(screen.getByTestId("profile-name-edit"));
    await user.clear(screen.getByTestId("profile-name-input"));
    await user.type(
      screen.getByTestId("profile-name-input"),
      "  Пётр Иванов  {Enter}",
    );
    await waitFor(() =>
      expect(setDisplayName).toHaveBeenCalledWith("Пётр Иванов"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("profile-name")).toHaveTextContent(
        "Пётр Иванов",
      ),
    );
  });

  it("EARS-9 unchanged: a 401 profile read gets one silent refresh + retry before redirecting to /login", async () => {
    getMyProfile.mockResolvedValueOnce(null).mockResolvedValueOnce(PROFILE);
    render(<AccountPage />);

    expect(await screen.findByTestId("profile-email")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects to /login when the profile read stays 401 after the silent refresh", async () => {
    getMyProfile.mockResolvedValue(null);
    render(<AccountPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("logout revokes server-side then routes to /login (EARS-10, stable data-testid)", async () => {
    const user = userEvent.setup();
    render(<AccountPage />);
    await screen.findByTestId("logout");

    await user.click(screen.getByTestId("logout"));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});
