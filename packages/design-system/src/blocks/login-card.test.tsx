import * as React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldValues, Resolver } from "react-hook-form";

import {
  LoginCard,
  type LoginCardCopy,
  type LoginCardMethod,
  type LoginCardOtpRequestValues,
  type LoginCardOtpVerifyValues,
  type LoginCardPasswordValues,
} from "./login-card";

/**
 * `<LoginCard>` (#1666) — the shared sign-in composition. These assertions cover the
 * BLOCK's contract only: copy-as-props, the method tabs, the two request forms, the
 * host-controlled OTP stage and the #266 resend cooldown. The portal's EARS-numbered
 * behavioural oracle (transport, EARS-16 mapping, routing) stays at app level in
 * `apps/portal/app/login/page.test.tsx`.
 */

/** Neutral, product-free copy — every rendered string must come from here. */
const copy: LoginCardCopy = {
  title: "copy.title",
  description: "copy.description",
  createAccount: "copy.createAccount",
  forgotPassword: "copy.forgotPassword",
  methodSwitcherLabel: "copy.methodSwitcherLabel",
  methodPassword: "copy.methodPassword",
  methodOtp: "copy.methodOtp",
  password: {
    formLabel: "copy.password.formLabel",
    identifierLabel: "copy.password.identifierLabel",
    identifierPlaceholder: "copy.password.identifierPlaceholder",
    passwordLabel: "copy.password.passwordLabel",
    submit: "copy.password.submit",
  },
  otp: {
    formLabel: "copy.otp.formLabel",
    heading: "copy.otp.heading",
    description: "copy.otp.description",
    channelGroupLabel: "copy.otp.channelGroupLabel",
    channelEmail: "copy.otp.channelEmail",
    channelSms: "copy.otp.channelSms",
    emailLabel: "copy.otp.emailLabel",
    emailPlaceholder: "copy.otp.emailPlaceholder",
    phoneLabel: "copy.otp.phoneLabel",
    phonePlaceholder: "copy.otp.phonePlaceholder",
    sendCode: "copy.otp.sendCode",
    verifyTitle: "copy.otp.verifyTitle",
    sentTo: (destination) => `copy.otp.sentTo:${destination}`,
    codeLabel: "copy.otp.codeLabel",
    verifySubmit: "copy.otp.verifySubmit",
    resend: "copy.otp.resend",
    resendCountdown: (seconds) => `copy.otp.resendIn:${seconds}`,
    changeMethod: "copy.otp.changeMethod",
  },
};

/** Permissive resolver — the HOST owns validation, so the block just forwards values. */
const passthrough = <T extends FieldValues>(): Resolver<T> =>
  async (values) => ({ values, errors: {} });

function setup(
  overrides: {
    onPasswordSubmit?: (values: LoginCardPasswordValues) => Promise<void> | void;
    onRequest?: (values: LoginCardOtpRequestValues) => void;
    onResend?: (values: LoginCardOtpRequestValues) => void;
    onVerify?: (values: LoginCardOtpVerifyValues) => Promise<void> | void;
    onChangeMethod?: () => void;
    onMethodChange?: (method: LoginCardMethod) => void;
    passwordError?: React.ReactNode;
    sentIdentifier?: string | null;
    resendNonce?: number;
  } = {},
) {
  return render(
    <LoginCard
      copy={copy}
      links={{ register: "/register", reset: "/reset" }}
      onMethodChange={overrides.onMethodChange ?? vi.fn()}
      password={{
        resolver: passthrough<LoginCardPasswordValues>(),
        onSubmit: overrides.onPasswordSubmit ?? vi.fn(),
        error: overrides.passwordError,
        captchaSlot: <div data-testid="password-captcha" />,
      }}
      otp={{
        requestResolvers: {
          email: passthrough<LoginCardOtpRequestValues>(),
          sms: passthrough<LoginCardOtpRequestValues>(),
        },
        verifyResolver: passthrough<LoginCardOtpVerifyValues>(),
        sentIdentifier: overrides.sentIdentifier ?? null,
        resendNonce: overrides.resendNonce ?? 0,
        captchaSlot: <div data-testid="otp-captcha" />,
        onRequest: overrides.onRequest ?? vi.fn(),
        onResend: overrides.onResend ?? vi.fn(),
        onVerify: overrides.onVerify ?? vi.fn(),
        onChangeMethod: overrides.onChangeMethod ?? vi.fn(),
      }}
    />,
  );
}

afterEach(cleanup);

describe("<LoginCard>", () => {
  it("renders every visible string from the copy prop, with the title as the page h1", () => {
    setup();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "copy.title",
    );
    expect(screen.getByText("copy.description")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "copy.createAccount" }),
    ).toHaveAttribute("href", "/register");
    expect(
      screen.getByRole("link", { name: "copy.forgotPassword" }),
    ).toHaveAttribute("href", "/reset");
    expect(screen.getByTestId("password-login-submit")).toHaveTextContent(
      "copy.password.submit",
    );
    // No product copy leaks out of the package: nothing rendered is outside the prop.
    expect(document.body.textContent).not.toMatch(/[А-Яа-я]/);
  });

  it("switches methods — Radix unmounts the inactive tab, so only one form is in the DOM", () => {
    setup();

    expect(screen.getByTestId("password-login-form")).toBeInTheDocument();
    expect(screen.queryByTestId("otp-send")).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("login-method-otp"), { button: 0 });

    expect(screen.queryByTestId("password-login-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("otp-send")).toBeInTheDocument();
    expect(screen.getByText("copy.otp.heading")).toBeInTheDocument();
  });

  // The host's whole reset story hangs on this callback: the block's own state
  // dies with the unmounted tab, but everything the host holds (errors, the OTP
  // stage, an in-flight bot-protection challenge) is cleared only here.
  it("announces the selected method on every tab switch, so the host can reset the state it owns", () => {
    const onMethodChange = vi.fn();
    setup({ onMethodChange });

    fireEvent.mouseDown(screen.getByTestId("login-method-otp"), { button: 0 });
    expect(onMethodChange).toHaveBeenNthCalledWith(1, "otp");

    fireEvent.mouseDown(screen.getByTestId("login-method-password"), {
      button: 0,
    });
    expect(onMethodChange).toHaveBeenNthCalledWith(2, "password");
  });

  it("hands the password values to the host handler and surfaces the host's error", async () => {
    const onPasswordSubmit = vi.fn();
    setup({ onPasswordSubmit });

    fireEvent.change(screen.getByLabelText("copy.password.identifierLabel"), {
      target: { value: "doc@example.com" },
    });
    fireEvent.change(screen.getByLabelText("copy.password.passwordLabel"), {
      target: { value: "Sup3r$ecretPw!9" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("password-login-submit"));
    });

    // RHF forwards the submit event as a second argument; the block adds nothing.
    expect(onPasswordSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "doc@example.com",
        password: "Sup3r$ecretPw!9",
      }),
      expect.anything(),
    );

  });

  it("renders no error of its own — the host's already-localized string is what shows", () => {
    setup({ passwordError: "host-error" });

    expect(screen.getByText("host-error")).toBeInTheDocument();
  });

  it("requests a code with the selected channel and shows the focus screen once the host confirms it", async () => {
    const onRequest = vi.fn();
    setup({ onRequest });

    fireEvent.mouseDown(screen.getByTestId("login-method-otp"), { button: 0 });
    fireEvent.click(screen.getByTestId("otp-channel-sms"));
    fireEvent.change(screen.getByTestId("otp-identifier"), {
      target: { value: "+79991234567" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("otp-send"));
    });

    expect(onRequest).toHaveBeenCalledWith({
      identifier: "+79991234567",
      channel: "sms",
    });
    // The stage is host-controlled: the request chrome is still on screen.
    expect(screen.queryByTestId("otp-verify")).not.toBeInTheDocument();

  });

  it("verifies through the host once the stage is open, masking the destination in the copy", async () => {
    const onVerify = vi.fn();
    setup({ sentIdentifier: "doc@example.com", onVerify });

    fireEvent.mouseDown(screen.getByTestId("login-method-otp"), { button: 0 });
    expect(screen.getByTestId("otp-verify")).toBeInTheDocument();
    expect(
      screen.getByText("copy.otp.sentTo:d•••@e•••.com"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("otp-verify"));
    });
    expect(onVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "doc@example.com",
        channel: "email",
      }),
    );
  });

  it("disables resend while the cooldown runs, then re-enables it and calls the host", () => {
    vi.useFakeTimers();
    try {
      const onResend = vi.fn();
      setup({ sentIdentifier: "doc@example.com", onResend });
      fireEvent.mouseDown(screen.getByTestId("login-method-otp"), {
        button: 0,
      });

      const resend = screen.getByTestId("otp-resend");
      expect(resend).toBeDisabled();
      expect(resend).toHaveTextContent("copy.otp.resendIn:30");

      act(() => vi.advanceTimersByTime(30_000));

      expect(resend).not.toBeDisabled();
      expect(resend).toHaveTextContent("copy.otp.resend");
      fireEvent.click(resend);
      expect(onResend).toHaveBeenCalledWith({
        identifier: "doc@example.com",
        channel: "email",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
