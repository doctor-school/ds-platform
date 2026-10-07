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
    passwordPlaceholder: "copy.password.passwordPlaceholder",
    reveal: {
      show: "copy.password.revealShow",
      hide: "copy.password.revealHide",
      showAria: "copy.password.revealShowAria",
      hideAria: "copy.password.revealHideAria",
    },
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
    verifyTitle: {
      email: "copy.otp.verifyTitle.email",
      sms: "copy.otp.verifyTitle.sms",
    },
    sentTo: (destination) => `copy.otp.sentTo:${destination}`,
    codeLabel: {
      email: "copy.otp.codeLabel.email",
      sms: "copy.otp.codeLabel.sms",
    },
    verifySubmit: "copy.otp.verifySubmit",
    resend: "copy.otp.resend",
    resendCountdown: (seconds) => `copy.otp.resendIn:${seconds}`,
    resentTo: (destination) => `copy.otp.resentTo:${destination}`,
    changeMethod: "copy.otp.changeMethod",
  },
};

/** Permissive resolver — the HOST owns validation, so the block just forwards values. */
const passthrough =
  <T extends FieldValues>(): Resolver<T> =>
  async (values) => ({ values, errors: {} });

function setup(
  overrides: {
    onPasswordSubmit?: (
      values: LoginCardPasswordValues,
    ) => Promise<void> | void;
    onRequest?: (values: LoginCardOtpRequestValues) => void;
    onResend?: (values: LoginCardOtpRequestValues) => void;
    onVerify?: (values: LoginCardOtpVerifyValues) => Promise<void> | void;
    onChangeMethod?: () => void;
    onMethodChange?: (method: LoginCardMethod) => void;
    passwordError?: React.ReactNode;
    sentIdentifier?: string | null;
    resendNonce?: number;
    defaultMethod?: LoginCardMethod;
    channels?: readonly ("email" | "sms")[];
  } = {},
) {
  return render(<Card {...overrides} />);
}

/** The card under test — a component so a test can rerender it with a new nonce. */
function Card(
  overrides: Parameters<typeof setup>[0] & object,
): React.ReactElement {
  return (
    <LoginCard
      copy={copy}
      // A sent code exists only on the code tab — the host clears it on switch.
      defaultMethod={
        overrides.defaultMethod ??
        (overrides.sentIdentifier ? "otp" : "password")
      }
      codeStepIcon={<span data-testid="code-step-icon" />}
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
        ...(overrides.channels ? { channels: overrides.channels } : {}),
        sentIdentifier: overrides.sentIdentifier ?? null,
        resendNonce: overrides.resendNonce ?? 0,
        captchaSlot: <div data-testid="otp-captcha" />,
        onRequest: overrides.onRequest ?? vi.fn(),
        onResend: overrides.onResend ?? vi.fn(),
        onVerify: overrides.onVerify ?? vi.fn(),
        onChangeMethod: overrides.onChangeMethod ?? vi.fn(),
      }}
    />
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

  it("#2027: the challenge stands directly above the control it protects, on both sign-in methods", () => {
    // Owner's canvas (`design-source/auth.dc.html:88-95` and `:127-131`): the
    // SmartCaptcha row is the last thing before the button on every auth screen,
    // not a banner at the head of the step.
    setup();

    const passwordCaptcha = screen.getByTestId("password-captcha");
    const passwordSubmit = screen.getByTestId("password-login-submit");
    expect(
      passwordCaptcha.compareDocumentPosition(passwordSubmit) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.mouseDown(screen.getByTestId("login-method-otp"), { button: 0 });

    const otpCaptcha = screen.getByTestId("otp-captcha");
    const identifier = screen.getByTestId("otp-identifier");
    const send = screen.getByTestId("otp-send");
    expect(
      identifier.compareDocumentPosition(otpCaptcha) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      otpCaptcha.compareDocumentPosition(send) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  // Owner decision 2026-10-06 (#2615): the two sign-in tabs share ONE typed
  // identifier — switching never makes the visitor type their address again.
  it("003 EARS-43: the typed identifier carries between «Пароль» and «По коду», both ways; the password does not", () => {
    setup();

    fireEvent.change(screen.getByLabelText("copy.password.identifierLabel"), {
      target: { value: "doc@example.com" },
    });
    fireEvent.change(screen.getByLabelText("copy.password.passwordLabel"), {
      target: { value: "Sup3r$ecretPw!9" },
    });
    fireEvent.mouseDown(screen.getByTestId("login-method-otp"), { button: 0 });

    expect(screen.getByTestId("otp-identifier")).toHaveValue("doc@example.com");
    expect(screen.getByTestId("otp-channel-email")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.change(screen.getByTestId("otp-identifier"), {
      target: { value: "doctor@example.com" },
    });
    fireEvent.mouseDown(screen.getByTestId("login-method-password"), {
      button: 0,
    });

    expect(screen.getByLabelText("copy.password.identifierLabel")).toHaveValue(
      "doctor@example.com",
    );
    expect(screen.getByLabelText("copy.password.passwordLabel")).toHaveValue(
      "",
    );
  });

  it("003 EARS-43: a carried phone opens «По коду» on the phone channel where the host serves it, and the request rides that channel", async () => {
    const onRequest = vi.fn();
    setup({ onRequest });

    fireEvent.change(screen.getByLabelText("copy.password.identifierLabel"), {
      target: { value: "+79991234567" },
    });
    fireEvent.mouseDown(screen.getByTestId("login-method-otp"), { button: 0 });

    expect(screen.getByTestId("otp-channel-sms")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("otp-identifier")).toHaveValue("+79991234567");

    await act(async () => {
      fireEvent.click(screen.getByTestId("otp-send"));
    });
    expect(onRequest).toHaveBeenCalledWith({
      identifier: "+79991234567",
      channel: "sms",
    });
  });

  it("003 EARS-43: a carried phone stays on email where the host serves no phone channel", () => {
    setup({ channels: ["email"] });

    fireEvent.change(screen.getByLabelText("copy.password.identifierLabel"), {
      target: { value: "+79991234567" },
    });
    fireEvent.mouseDown(screen.getByTestId("login-method-otp"), { button: 0 });

    expect(screen.queryByTestId("otp-channel-sms")).not.toBeInTheDocument();
    expect(screen.getByLabelText("copy.otp.emailLabel")).toHaveValue(
      "+79991234567",
    );
  });

  it("003 EARS-43: an email carried after a phone puts «По коду» back on the email channel", () => {
    setup();

    fireEvent.change(screen.getByLabelText("copy.password.identifierLabel"), {
      target: { value: "+79991234567" },
    });
    fireEvent.mouseDown(screen.getByTestId("login-method-otp"), { button: 0 });
    fireEvent.mouseDown(screen.getByTestId("login-method-password"), {
      button: 0,
    });
    fireEvent.change(screen.getByLabelText("copy.password.identifierLabel"), {
      target: { value: "doc@example.com" },
    });
    fireEvent.mouseDown(screen.getByTestId("login-method-otp"), { button: 0 });

    expect(screen.getByTestId("otp-channel-email")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("otp-identifier")).toHaveValue("doc@example.com");
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

  it("003 EARS-42: the sent code turns the card into the code step — channel heading, the destination as typed, no tabs, footer kept", () => {
    setup({ sentIdentifier: "doc@example.com" });

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "copy.otp.verifyTitle.email",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("copy.otp.sentTo:doc@example.com"),
    ).toBeInTheDocument();
    expect(screen.queryByText("copy.title")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("copy.methodSwitcherLabel")).toBeNull();
    expect(screen.getByTestId("code-step-icon")).toBeInTheDocument();
    expect(screen.getByText("copy.otp.codeLabel.email")).toBeInTheDocument();
    expect(screen.getByTestId("otp-change-method")).toHaveTextContent(
      "copy.otp.changeMethod",
    );
    // The canvas keeps «Создать аккаунт / Забыли пароль?» under the code step.
    expect(
      screen.getByRole("link", { name: "copy.createAccount" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "copy.forgotPassword" }),
    ).toBeInTheDocument();
  });

  it("003 EARS-42: one six-cell digit code — no eight-cell step (#2636)", () => {
    setup({ sentIdentifier: "doc@example.com" });
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("maxlength", "6");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("003 EARS-42: the SMS code step says «phone» and its code label", async () => {
    const { rerender } = setup();
    fireEvent.mouseDown(screen.getByTestId("login-method-otp"), { button: 0 });
    fireEvent.click(screen.getByTestId("otp-channel-sms"));
    rerender(<Card sentIdentifier="+79991234567" />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "copy.otp.verifyTitle.sms",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("copy.otp.codeLabel.sms")).toBeInTheDocument();
    // #2607: the visitor's own number, exactly as sent — never masked.
    expect(
      screen.getByText("copy.otp.sentTo:+79991234567"),
    ).toBeInTheDocument();
  });

  it("003 EARS-42: a successful resend shows the «new code» notice, absent before it", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = setup({ sentIdentifier: "doc@example.com" });
      expect(screen.queryByTestId("otp-resend-notice")).toBeNull();
      rerender(<Card sentIdentifier="doc@example.com" resendNonce={1} />);
      expect(screen.getByTestId("otp-resend-notice")).toHaveTextContent(
        "copy.otp.resentTo:doc@example.com",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("003 EARS-42: the «new code» notice stays absent on the code step's first open under StrictMode", () => {
    // Both storefronts run React StrictMode in development, which mounts every
    // effect twice: the mount itself must never read as a resend.
    render(
      <React.StrictMode>
        <Card sentIdentifier="doc@example.com" />
      </React.StrictMode>,
    );
    expect(screen.queryByTestId("otp-resend-notice")).toBeNull();
  });

  it("verifies through the host once the stage is open", async () => {
    const onVerify = vi.fn();
    setup({ sentIdentifier: "doc@example.com", onVerify });

    expect(screen.getByTestId("otp-verify")).toBeInTheDocument();

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

/**
 * #2027 — no credential may ride a URL before hydration.
 *
 * Every auth `<form>` in this package is submitted by a handler that only exists
 * once the bundle has run. A visitor who presses the button before that submits
 * NATIVELY, and a `<form>` with no `method` is a GET: the password, the
 * identifier and the one-time code go into the query string, the browser
 * history and every access log on the way. `method="post"` moves them into the
 * request body, which is the whole of the fix — the submitted path is unchanged,
 * `action` stays off so the browser uses the current document URL, and the
 * rendered surface is byte-identical, so there is no visual delta to review.
 *
 * Asserted over EVERY form the block renders rather than by test id, so a form
 * added later cannot quietly reintroduce the leak.
 */
describe("#2027 <LoginCard> pre-hydration submit", () => {
  it("EARS-16.4: the password form posts — a native submit never puts the password in the URL", () => {
    const { container } = setup();
    const forms = container.querySelectorAll("form");
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(form.getAttribute("method")).toBe("post");
    }
  });

  it("EARS-16.4: the OTP request AND verify forms post too — a code is a credential", () => {
    const { container } = setup({ sentIdentifier: "doc@example.com" });
    const forms = container.querySelectorAll("form");
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(form.getAttribute("method")).toBe("post");
    }
  });
});

/**
 * Canvas render parity (#2027, owner rule 2026-09-22 «parity is the rendering»).
 * `design-source/auth.dc.html` draws the login door's operation-level refusal as
 * a framed plate above the title, and names the two choice groups with the same
 * eyebrow the register door uses for its conditions — one family, one recipe.
 */
describe("#2027 <LoginCard> canvas parity", () => {
  it("#2027: a refused sign-in is the canvas plate, not a bare red line (canvas 56-61)", () => {
    setup({ passwordError: "copy.password.error" });

    const banner = screen.getByText(/copy\.password\.error/).closest("p");
    expect(banner).toHaveClass(
      "border-2",
      "border-destructive-text",
      "bg-destructive-tint",
      "text-caption",
      "text-foreground",
    );
    expect(banner).toHaveAttribute("role", "alert");
  });

  it("#2027: the password input carries the host placeholder (canvas 82, owner 2026-09-24)", () => {
    setup();
    expect(
      screen.getByLabelText("copy.password.passwordLabel", {
        selector: "input",
      }),
    ).toHaveAttribute("placeholder", "copy.password.passwordPlaceholder");
  });

  it("#2027: both choice groups are named with the family eyebrow (canvas 66/106)", () => {
    setup();

    const eyebrow = screen.getByText("copy.methodSwitcherLabel", {
      selector: "p",
    });
    expect(eyebrow).toHaveClass(
      "text-eyebrow",
      "font-extrabold",
      "uppercase",
      "tracking-micro",
      "text-faint",
    );
    expect(eyebrow.className).not.toMatch(/text-muted-foreground/);
  });
});
