import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./page";

/**
 * 003 EARS-17, dismissal branch: "every ... dismissed incomplete challenge shall
 * terminate and reset that attempt", and no provider callback may replay an
 * action. Switching the login method IS a dismissal — it tears down the sub-form
 * that owns the challenge. Before #1666 the `useBotProtectedAction` hooks lived
 * inside the per-method sub-forms, so Radix unmounting the inactive `TabsContent`
 * WAS that terminal path; with both hooks lifted to the page the host has to call
 * `reset()` explicitly. Without it the abandoned closure survives the switch and
 * the field remounting on return re-runs the challenge, firing a second
 * `authClient.requestOtp` (a duplicate SMS against the EARS-14 toll-fraud budget)
 * — or a password login the doctor never re-submitted.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

type CaptchaProps = {
  requestKey: number | null;
  onToken: (token?: string) => void;
  onError: (reason: "expired" | "unavailable" | "incomplete") => void;
};
/**
 * Radix keeps exactly one `TabsContent` mounted, so exactly one
 * `<BotProtectionField>` is live at a time — this always holds the props of the
 * currently visible method's field. The challenge is never auto-solved here: the
 * whole point is a challenge left IN FLIGHT across the switch.
 */
let captchaProps: CaptchaProps | undefined;
vi.mock("@/components/bot-protection", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/bot-protection")
  >("@/components/bot-protection");
  return {
    ...actual,
    BotProtectionField: (props: CaptchaProps) => {
      captchaProps = props;
      return <div data-testid="bot-protection-field" />;
    },
  };
});

const MockAuthError = vi.hoisted(
  () =>
    class MockAuthError extends Error {
      constructor(
        readonly status: number,
        message: string,
        readonly code?: string,
      ) {
        super(message);
      }
    },
);

const login = vi.fn().mockResolvedValue(undefined);
const requestOtp = vi.fn().mockResolvedValue(undefined);
const loginWithOtp = vi.fn().mockResolvedValue({});
const session = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    login: (body: unknown) => login(body),
    requestOtp: (body: unknown) => requestOtp(body),
    loginWithOtp: (body: unknown) => loginWithOtp(body),
    session: () => session(),
  },
  AuthError: MockAuthError,
}));

vi.mock("@/lib/registration-client", () => ({
  registerForEvent: vi.fn().mockResolvedValue({ registered: true }),
}));

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3r$ecretPw!9";

/** #675: the <AuthShell> guard renders nothing until `session()` resolves. */
async function renderLogin() {
  render(<LoginPage />);
  await screen.findByTestId("login-method-password");
}

beforeEach(() => {
  push.mockClear();
  login.mockClear();
  requestOtp.mockClear();
  loginWithOtp.mockClear();
  captchaProps = undefined;
});

afterEach(cleanup);

describe("003 EARS-17 challenge dismissal on login-method change", () => {
  it("EARS-17: switching method terminates an in-flight sign-in-code challenge — returning to the tab neither re-runs it nor replays the request", async () => {
    const user = userEvent.setup();
    await renderLogin();

    await user.click(screen.getByTestId("login-method-otp"));
    await user.type(screen.getByLabelText("email"), EMAIL);
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
      new MockAuthError(403, "challenge required", "BOT_PROTECTION_REQUIRED"),
    );
    const user = userEvent.setup();
    await renderLogin();

    await user.type(screen.getByLabelText("emailOrPhone"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);
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
