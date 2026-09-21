// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 003 EARS-17, dismissal branch: "every … dismissed incomplete challenge shall
 * terminate and reset that attempt", and no provider callback may replay an
 * action. Switching the login method IS a dismissal — it tears down the sub-form
 * that owns the challenge. Radix unmounts the inactive `TabsContent`, but both
 * `useBotProtectedAction` hooks live on the door above the tabs, so the door has
 * to call `reset()` explicitly. Without it the abandoned closure survives the
 * switch and the field remounting on return re-runs the challenge, firing a
 * second `requestOtp` (a duplicate SMS against the EARS-14 toll-fraud budget) —
 * or a login the visitor never re-submitted.
 *
 * These two ids arrive from `apps/portal/app/login/page.method-switch.test.tsx`;
 * since #1666 lifted the hooks out of the sub-forms the rule has been the door's,
 * and the door is now the shared one, so the case belongs beside it.
 */

type CaptchaProps = {
  sitekey?: string | undefined;
  requestKey: number | null;
  onToken: (token?: string) => void;
  onError: (reason: "expired" | "unavailable" | "incomplete") => void;
};
/**
 * Radix keeps exactly one `TabsContent` mounted, so exactly one
 * `<BotProtectionField>` is live at a time — this always holds the props of the
 * currently visible method's field. The challenge is never auto-solved here: the
 * whole point is a challenge left IN FLIGHT across the switch, which is the
 * configured-site-key branch of the real field (below it resumes tokenless).
 */
let captchaProps: CaptchaProps | undefined;
vi.mock("@ds/design-system/blocks", async () => {
  const actual = await vi.importActual<
    typeof import("@ds/design-system/blocks")
  >("@ds/design-system/blocks");
  return {
    ...actual,
    BotProtectionField: (props: CaptchaProps) => {
      captchaProps = props;
      return <div data-testid="bot-protection-field" />;
    },
  };
});

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const login = vi.fn();
const requestOtp = vi.fn();
const loginWithOtp = vi.fn();
vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({ login, requestOtp, loginWithOtp }),
}));

vi.mock("@ds/events-storefront/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/client")>()),
  registerForEvent: vi.fn().mockResolvedValue({ registered: true }),
}));

import { AuthError } from "../client/auth-client";
import type { AuthFlowHostConfig } from "../host-config";
import { ACADEMY_FIXTURE } from "../test-support/host-config-fixtures";
import { LoginDoor } from "./login-door";

/** The shipped Academy configuration: a host that runs the provider challenge. */
const CONFIG: AuthFlowHostConfig = {
  ...ACADEMY_FIXTURE,
  botProtection: { siteKey: "academy-site-key" },
};
const COPY = ACADEMY_FIXTURE.copy.login;
const EMAIL = "doc@example.com";
const PASSWORD = "Sup3r$ecretPw!9";

function renderDoor() {
  return render(
    <LoginDoor config={CONFIG} landing={CONFIG.landing.afterLogin} />,
  );
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  login.mockClear().mockResolvedValue(undefined);
  requestOtp.mockClear().mockResolvedValue(undefined);
  loginWithOtp.mockClear().mockResolvedValue({});
  captchaProps = undefined;
});

afterEach(cleanup);

describe("003 EARS-17 challenge dismissal on login-method change", () => {
  it("EARS-17: switching method terminates an in-flight sign-in-code challenge — returning to the tab neither re-runs it nor replays the request", async () => {
    const user = userEvent.setup();
    renderDoor();

    await user.click(screen.getByTestId("login-method-otp"));
    await user.type(screen.getByLabelText(COPY.otp.emailLabel), EMAIL);
    await user.click(screen.getByTestId("otp-send"));
    // The challenge is now in flight: a widget key is issued and the request is
    // parked behind the token, so nothing has reached the BFF yet.
    await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());
    expect(requestOtp).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("login-method-password"));
    await user.click(screen.getByTestId("login-method-otp"));

    // Remounted idle, not mid-challenge: no key to re-run, and the send button is
    // live again rather than stuck in the pending affordance over an empty form.
    expect(captchaProps?.requestKey).toBeNull();
    expect(screen.getByTestId("otp-send").hasAttribute("disabled")).toBe(false);

    // A late provider callback for the abandoned attempt is inert.
    act(() => captchaProps?.onToken("late-token"));
    await waitFor(() => expect(requestOtp).not.toHaveBeenCalled());
    expect(screen.queryByTestId("otp-verify")).toBeNull();
  });

  it("EARS-17: switching method terminates an in-flight password challenge — no login the doctor never re-submitted", async () => {
    login.mockRejectedValueOnce(
      new AuthError(403, "challenge required", "BOT_PROTECTION_REQUIRED"),
    );
    const user = userEvent.setup();
    renderDoor();

    await user.type(
      screen.getByLabelText(COPY.password.identifierLabel),
      EMAIL,
    );
    await user.type(
      screen.getByLabelText(COPY.password.passwordLabel, { selector: "input" }),
      PASSWORD,
    );
    await user.click(screen.getByTestId("password-login-submit"));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    // The backend demanded a challenge, so the retry is parked behind a token.
    await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());

    await user.click(screen.getByTestId("login-method-otp"));
    await user.click(screen.getByTestId("login-method-password"));

    expect(captchaProps?.requestKey).toBeNull();
    act(() => captchaProps?.onToken("late-token"));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });
});
