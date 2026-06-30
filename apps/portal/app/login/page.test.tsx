import { render, screen, cleanup, waitFor } from "@testing-library/react";
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

let resolveLogin: (() => void) | undefined;
let resolveRequestOtp: (() => void) | undefined;
const login = vi.fn(
  (_body: unknown) => new Promise<void>((resolve) => (resolveLogin = resolve)),
);
const requestOtp = vi.fn(
  (_body: unknown) =>
    new Promise<void>((resolve) => (resolveRequestOtp = resolve)),
);
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    login: (body: unknown) => login(body),
    requestOtp: (body: unknown) => requestOtp(body),
    loginWithOtp: vi.fn(),
  },
  AuthError: class extends Error {},
}));

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3r$ecretPw!9";

beforeEach(() => {
  push.mockClear();
  login.mockClear();
  requestOtp.mockClear();
  resolveLogin = undefined;
  resolveRequestOtp = undefined;
});
afterEach(() => {
  resolveLogin?.();
  resolveRequestOtp?.();
  cleanup();
});

describe("/login submit pending affordances (#337)", () => {
  it("shows spinner + aria-busy on the password submit while the login request is in flight", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

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
    render(<LoginPage />);

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
