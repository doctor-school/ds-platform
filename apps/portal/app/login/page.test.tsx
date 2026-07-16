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
const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
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
  AuthError: class extends Error {},
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

  it("008 EARS-7: without a carried event context, password-login success lands on the discovery front-door (`/`) and registers nothing", async () => {
    const user = userEvent.setup();
    await renderLogin();

    await user.type(screen.getByLabelText("emailOrPhone"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);
    await user.click(screen.getByTestId("password-login-submit"));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    resolveLogin?.();

    // 008 EARS-7 — the default post-login landing is the discovery front-door `/`.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("EARS-2: a cross-origin returnTo is rejected — login success lands on the discovery front-door (`/`, 008 EARS-7), nothing registers", async () => {
    searchParams = new URLSearchParams({ returnTo: "//evil.example" });
    const user = userEvent.setup();
    await renderLogin();

    await user.type(screen.getByLabelText("emailOrPhone"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);
    await user.click(screen.getByTestId("password-login-submit"));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    resolveLogin?.();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
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
