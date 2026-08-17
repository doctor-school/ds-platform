import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./page";

/**
 * #337 (submit/pending progress visualization): every async auth submit must show the
 * shared `Button.loading` affordance (spinner + `aria-busy` + disabled-while-loading)
 * driven from the form's `isSubmitting`, so the surface reads as "working" instead of
 * a static disabled button that looks hung (the #333 Stage-B owner finding). This
 * covers BOTH submits the /login surface owns: the EARS-5 password login and the
 * EARS-6/7 OTP request ("send code"). Each is held in flight via a deferred promise
 * so the pending affordance can be asserted.
 */

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

type CaptchaProps = {
  requestKey: number | null;
  onToken: (token?: string) => void;
  onError: (reason: "expired" | "unavailable" | "incomplete") => void;
};
let captchaMode: "bypass" | "manual" = "bypass";
let captchaProps: CaptchaProps | undefined;
vi.mock("@/components/bot-protection", async () => {
  const React = await import("react");
  const actual = await vi.importActual<
    typeof import("@/components/bot-protection")
  >("@/components/bot-protection");
  return {
    ...actual,
    BotProtectionField: (props: CaptchaProps) => {
      captchaProps = props;
      React.useEffect(() => {
        if (captchaMode === "bypass" && props.requestKey !== null) {
          props.onToken(undefined);
        }
      }, [props.onToken, props.requestKey]);
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

let resolveLogin: (() => void) | undefined;
let resolveRequestOtp: (() => void) | undefined;
const login = vi.fn(
  (_body: unknown) => new Promise<void>((resolve) => (resolveLogin = resolve)),
);
const requestOtp = vi.fn(
  (_body: unknown) =>
    new Promise<void>((resolve) => (resolveRequestOtp = resolve)),
);
const loginWithOtp = vi.fn().mockResolvedValue({});
// #675: rendering the page now mounts the <AuthShell> auth-surface guard, which
// reads `authClient.session()` on mount. Default it to the unauthenticated path
// (resolves `null`) so the form renders as before; the guard's authed branch is
// covered by components/auth-shell.test.tsx.
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

// 005 EARS-2: the post-auth registration resume fires the real EARS-1 command
// through this client — mocked here so the page tests assert the resume wiring
// (the command's server semantics are EARS-1/EARS-3).
const registerForEvent = vi.fn().mockResolvedValue({ registered: true });
vi.mock("@/lib/registration-client", () => ({
  registerForEvent: (slug: string) => registerForEvent(slug),
}));

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3r$ecretPw!9";

/**
 * Render /login and wait past the #675 <AuthShell> session-guard. The guard renders
 * nothing until `session()` resolves (to `null` here → the anonymous path), so the
 * form appears asynchronously; gate on a stable form control before interacting.
 */
async function renderLogin() {
  render(<LoginPage />);
  await screen.findByTestId("login-method-password");
}

async function flushAuthGuard() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  login.mockClear();
  requestOtp.mockClear();
  loginWithOtp.mockClear();
  registerForEvent.mockClear();
  resolveLogin = undefined;
  resolveRequestOtp = undefined;
  searchParams = new URLSearchParams();
  captchaMode = "bypass";
  captchaProps = undefined;
});

describe("003 EARS-17 on-demand login protection", () => {
  it("EARS-17: password login starts without CAPTCHA, then a stable backend challenge retries the original values exactly once", async () => {
    captchaMode = "manual";
    login
      .mockRejectedValueOnce(
        new MockAuthError(403, "challenge required", "BOT_PROTECTION_REQUIRED"),
      )
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    await renderLogin();
    await user.type(screen.getByLabelText("emailOrPhone"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);

    await user.click(screen.getByTestId("password-login-submit"));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({ captchaToken: expect.anything() }),
    );
    await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());

    act(() => captchaProps?.onToken("fresh-login-token"));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    expect(login).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        identifier: EMAIL,
        password: PASSWORD,
        captchaToken: "fresh-login-token",
      }),
    );
    act(() => captchaProps?.onToken("fresh-login-token"));
    expect(login).toHaveBeenCalledTimes(2);
  });

  it("EARS-17: the initial sign-in-code request waits for a fresh challenge token", async () => {
    captchaMode = "manual";
    requestOtp.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    await renderLogin();
    await user.click(screen.getByTestId("login-method-otp"));
    await user.type(screen.getByLabelText("email"), EMAIL);
    await user.click(screen.getByTestId("otp-send"));

    expect(requestOtp).not.toHaveBeenCalled();
    await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());
    act(() => captchaProps?.onToken("fresh-otp-token"));
    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(1));
    expect(requestOtp).toHaveBeenCalledWith(
      expect.objectContaining({ captchaToken: "fresh-otp-token" }),
    );
  });

  it("EARS-17: login-code confirmation stays challenge-free", async () => {
    requestOtp.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    await renderLogin();
    await user.click(screen.getByTestId("login-method-otp"));
    await user.type(screen.getByLabelText("email"), EMAIL);
    await user.click(screen.getByTestId("otp-send"));
    await screen.findByTestId("otp-verify");

    captchaMode = "manual";
    await user.type(screen.getByRole("textbox"), "12345678");
    await waitFor(() => expect(loginWithOtp).toHaveBeenCalledTimes(1));
    expect(captchaProps?.requestKey).toBeNull();
  });

  it("EARS-17: login-code resend executes a new challenge and sends once", async () => {
    requestOtp.mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      render(<LoginPage />);
      await flushAuthGuard();
      fireEvent.mouseDown(screen.getByTestId("login-method-otp"), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.change(screen.getByLabelText("email"), {
        target: { value: EMAIL },
      });
      fireEvent.click(screen.getByTestId("otp-send"));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(requestOtp).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("otp-verify")).toBeInTheDocument();

      captchaMode = "manual";
      act(() => vi.advanceTimersByTime(30_000));
      fireEvent.click(screen.getByTestId("otp-resend"));
      expect(requestOtp).toHaveBeenCalledTimes(1);
      expect(captchaProps?.requestKey).not.toBeNull();

      act(() => captchaProps?.onToken("fresh-otp-resend-token"));
      await act(async () => Promise.resolve());
      expect(requestOtp).toHaveBeenCalledTimes(2);
      expect(requestOtp).toHaveBeenLastCalledWith(
        expect.objectContaining({ captchaToken: "fresh-otp-resend-token" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
afterEach(() => {
  resolveLogin?.();
  resolveRequestOtp?.();
  cleanup();
});

describe("/login submit pending affordances (#337)", () => {
  it("shows spinner + aria-busy on the password submit while the login request is in flight", async () => {
    const user = userEvent.setup();
    await renderLogin();

    await user.type(screen.getByLabelText("emailOrPhone"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);

    const submit = screen.getByTestId("password-login-submit");
    expect(submit).not.toHaveAttribute("aria-busy");

    await user.click(submit);

    await waitFor(() => {
      expect(login).toHaveBeenCalledTimes(1);
      expect(submit).toHaveAttribute("aria-busy", "true");
    });
    expect(submit.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("shows spinner + aria-busy on the OTP send submit while the code request is in flight", async () => {
    const user = userEvent.setup();
    await renderLogin();

    // Switch to the passwordless OTP method (Radix unmounts the password tab).
    await user.click(screen.getByTestId("login-method-otp"));
    await user.type(screen.getByLabelText("email"), EMAIL);

    const send = screen.getByTestId("otp-send");
    expect(send).not.toHaveAttribute("aria-busy");

    await user.click(send);

    await waitFor(() => {
      expect(requestOtp).toHaveBeenCalledTimes(1);
      expect(send).toHaveAttribute("aria-busy", "true");
    });
    expect(send.querySelector("svg.animate-spin")).not.toBeNull();
  });
});

/**
 * 005 EARS-2 — guest-through-auth completion on /login: a guest carried into the
 * 003 login flow with an event context (`?returnTo=/webinars/:slug`) comes out
 * REGISTERED for that same event and lands back on that event page — the same
 * `RegisterForEvent` (EARS-1) fires after the session exists, with no re-search
 * and no second «Участвовать» tap. Without a carried context the shipped
 * behavior is untouched (land on /account, register nothing).
 */
describe("005 EARS-2 guest-through-auth completion on /login", () => {
  it("EARS-2: on password-login success with a carried event context, the system shall register for that event and land on its page", async () => {
    searchParams = new URLSearchParams({ returnTo: "/webinars/ahilles-042" });
    const user = userEvent.setup();
    await renderLogin();

    await user.type(screen.getByLabelText("emailOrPhone"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);
    await user.click(screen.getByTestId("password-login-submit"));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    resolveLogin?.();

    await waitFor(() => {
      // The SAME RegisterForEvent fires for the carried slug…
      expect(registerForEvent).toHaveBeenCalledWith("ahilles-042");
      // …and the doctor lands back on the originally chosen event page.
      expect(push).toHaveBeenCalledWith("/webinars/ahilles-042");
    });
  });

  it("008 EARS-7: without a carried event context, password-login success lands on the discovery listing (`/webinars`) and registers nothing", async () => {
    const user = userEvent.setup();
    await renderLogin();

    await user.type(screen.getByLabelText("emailOrPhone"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);
    await user.click(screen.getByTestId("password-login-submit"));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    resolveLogin?.();

    // 008 EARS-7, amended by 013 EARS-15 — the default post-login landing is the
    // discovery listing `/webinars`, never the Academy landing `/`.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/webinars"));
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("EARS-2: a cross-origin returnTo is rejected — login success lands on the discovery listing (`/webinars`, 008 EARS-7 as amended by 013 EARS-15), nothing registers", async () => {
    searchParams = new URLSearchParams({ returnTo: "//evil.example" });
    const user = userEvent.setup();
    await renderLogin();

    await user.type(screen.getByLabelText("emailOrPhone"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);
    await user.click(screen.getByTestId("password-login-submit"));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    resolveLogin?.();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/webinars"));
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("EARS-2: on OTP-login success with a carried event context, the system shall register for that event and land on its page", async () => {
    searchParams = new URLSearchParams({ returnTo: "/webinars/ahilles-042" });
    const user = userEvent.setup();
    await renderLogin();

    // Request a code on the passwordless method…
    await user.click(screen.getByTestId("login-method-otp"));
    await user.type(screen.getByLabelText("email"), EMAIL);
    await user.click(screen.getByTestId("otp-send"));
    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(1));
    resolveRequestOtp?.();

    // …then the focus screen mounts (wait for its submit — the request form's
    // email box is a textbox too, so the role query must run after the swap);
    // the fixed 8-digit code auto-submits.
    await screen.findByTestId("otp-verify");
    const codeInput = screen.getByRole("textbox");
    await user.click(codeInput);
    await user.keyboard("12345678");

    await waitFor(() => {
      expect(loginWithOtp).toHaveBeenCalledTimes(1);
      expect(registerForEvent).toHaveBeenCalledWith("ahilles-042");
      expect(push).toHaveBeenCalledWith("/webinars/ahilles-042");
    });
  });

  it("EARS-2: the create-account link carries the event context onward into /register", async () => {
    searchParams = new URLSearchParams({ returnTo: "/webinars/ahilles-042" });
    await renderLogin();

    const createAccount = screen.getByRole("link", { name: "createAccount" });
    expect(createAccount).toHaveAttribute(
      "href",
      "/register?returnTo=%2Fwebinars%2Fahilles-042",
    );
  });
});
