// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 003 EARS-42 — sign-in by code lands on THE one code step: the canvas «ШАГ
 * КОДА» (`design-source/auth.dc.html` 64-85, 394-397, 501-503), the same
 * `<OtpFocusScreen>` the registration confirmation draws. Once a code was sent
 * the card heading and description name the channel and the address exactly
 * as typed (#2607 — the visitor's own input, never masked),
 * the method tabs are gone, the field takes six letters-or-digits, and
 * «← Изменить способ» returns to the request form. Run over BOTH hosts: the
 * step is package behaviour, never a host branch.
 *
 * Mocked seams: the BFF factory (`createAuthClient`) and the router — the
 * observable outcome. No site key in the fixtures, so the challenge runs
 * tokenless exactly as the guard's no-op does.
 */
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const requestOtp = vi.fn();
const loginWithOtp = vi.fn();
vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({ login: vi.fn(), requestOtp, loginWithOtp }),
}));

vi.mock("@ds/events-storefront/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/client")>()),
  registerForEvent: vi.fn().mockResolvedValue(undefined),
}));

import { resolveAuthFlowCopy } from "../copy";
import type { AuthFlowHostConfig } from "../host-config";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { LoginDoor } from "./login-door";

const HOSTS = [
  ["the Academy", ACADEMY_FIXTURE],
  ["the doctor storefront", DOCTOR_FIXTURE],
] as const;

const COPY = resolveAuthFlowCopy(DOCTOR_FIXTURE).login;
const EMAIL = "doc@clinic.ru";

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  requestOtp.mockReset().mockResolvedValue(undefined);
  loginWithOtp.mockReset().mockResolvedValue(undefined);
  document.elementFromPoint = () => document.body;
});

afterEach(cleanup);

/** Open «По коду», send a code by e-mail, and wait for the code step. */
async function sendEmailCode(config: AuthFlowHostConfig) {
  const user = userEvent.setup();
  render(<LoginDoor config={config} landing="/" />);
  await user.click(screen.getByTestId("login-method-otp"));
  await user.type(screen.getByLabelText(COPY.otp.emailLabel), EMAIL);
  await user.click(screen.getByTestId("otp-send"));
  await screen.findByTestId("otp-verify");
  return user;
}

describe("003 EARS-42: sign-in by code shows the one code step", () => {
  it.each(HOSTS)(
    "003 EARS-42: on %s the e-mail code step reads «Проверьте почту», names the address as typed and the «Код из письма» field",
    async (_host, config) => {
      await sendEmailCode(config);

      expect(screen.getByText(COPY.otp.verifyTitle.email)).toBeInTheDocument();
      // The address stands bold inside the sentence (canvas 394).
      const address = screen.getByText(EMAIL);
      expect(address.tagName).toBe("STRONG");
      expect(address.parentElement).toHaveTextContent(
        `Мы отправили код на ${EMAIL}.`,
      );
      expect(
        screen.getByLabelText(COPY.otp.codeLabel.email),
      ).toBeInTheDocument();
      expect(screen.getByTestId("otp-verify")).toHaveTextContent(
        COPY.otp.verifySubmit,
      );
    },
  );

  it.each(HOSTS)(
    "003 EARS-42: on %s the code field takes six letters-or-digits, typed as text, never a numeric pad",
    async (_host, config) => {
      await sendEmailCode(config);

      const field = screen.getByRole("textbox");
      expect(field).toHaveAttribute("maxlength", "6");
      expect(field).toHaveAttribute("inputmode", "text");
      expect(field).toHaveAttribute("autocomplete", "one-time-code");
    },
  );

  it.each(HOSTS)(
    "003 EARS-42: on %s the sixth character submits the alphanumeric code on the channel it was sent by",
    async (_host, config) => {
      const user = await sendEmailCode(config);

      await user.click(screen.getByRole("textbox"));
      await user.keyboard("PVDC3R");

      await waitFor(() => expect(loginWithOtp).toHaveBeenCalledTimes(1));
      expect(loginWithOtp).toHaveBeenCalledWith({
        identifier: EMAIL,
        code: "PVDC3R",
        channel: "email",
      });
    },
  );

  it.each(HOSTS)(
    "003 EARS-42: on %s the method tabs are hidden on the code step while the «Создать аккаунт» / «Забыли пароль?» footer stays",
    async (_host, config) => {
      await sendEmailCode(config);

      expect(screen.queryByTestId("login-method-otp")).toBeNull();
      expect(screen.queryByTestId("login-method-password")).toBeNull();
      expect(screen.getByText(COPY.createAccount)).toBeInTheDocument();
      expect(screen.getByText(COPY.forgotPassword)).toBeInTheDocument();
    },
  );

  it.each(HOSTS)(
    "003 EARS-42: on %s «← Изменить способ» leaves the code step for the request form, the tabs back",
    async (_host, config) => {
      const user = await sendEmailCode(config);

      await user.click(screen.getByTestId("otp-change-method"));

      await waitFor(() =>
        expect(screen.queryByTestId("otp-verify")).toBeNull(),
      );
      expect(screen.getByTestId("otp-send")).toBeInTheDocument();
      expect(screen.getByTestId("login-method-otp")).toBeInTheDocument();
      expect(screen.queryByText(COPY.otp.verifyTitle.email)).toBeNull();
    },
  );

  it("003 EARS-42: the SMS code step reads «Проверьте телефон» and «Код из сообщения»", async () => {
    const user = userEvent.setup();
    render(<LoginDoor config={DOCTOR_FIXTURE} landing="/" />);
    await user.click(screen.getByTestId("login-method-otp"));
    await user.click(screen.getByTestId("otp-channel-sms"));
    await user.type(screen.getByLabelText(COPY.otp.phoneLabel), "+79991234567");
    await user.click(screen.getByTestId("otp-send"));
    await screen.findByTestId("otp-verify");

    expect(screen.getByText(COPY.otp.verifyTitle.sms)).toBeInTheDocument();
    expect(screen.getByLabelText(COPY.otp.codeLabel.sms)).toBeInTheDocument();
    expect(screen.queryByText(COPY.otp.verifyTitle.email)).toBeNull();
    // #2607: the number the code went to stands in full, bold — never masked.
    const sent = requestOtp.mock.calls[0]?.[0] as { identifier: string };
    const number = screen.getByText(sent.identifier);
    expect(number.tagName).toBe("STRONG");
    expect(number.textContent).not.toContain("•");
  });

  it.each(HOSTS)(
    "003 EARS-42 (#2607): on %s two addresses typed in turn read apart on the step, and a long one wraps inside the column",
    async (_host, config) => {
      const LONG = "anna.konstantinova-rozhdestvenskaya.cardiology@regional-clinical-hospital.example.ru";
      const user = await sendEmailCode(config);
      expect(screen.getByText(EMAIL).tagName).toBe("STRONG");

      await user.click(screen.getByTestId("otp-change-method"));
      await user.clear(screen.getByLabelText(COPY.otp.emailLabel));
      await user.type(screen.getByLabelText(COPY.otp.emailLabel), LONG);
      await user.click(screen.getByTestId("otp-send"));
      await screen.findByTestId("otp-verify");

      const address = screen.getByText(LONG);
      expect(address.tagName).toBe("STRONG");
      expect(screen.queryByText(EMAIL)).toBeNull();
      // Canvas `overflow-wrap:anywhere` on the address — a token-free utility.
      expect(address).toHaveClass("wrap-anywhere");
    },
  );

  it("003 EARS-42: a resend says «Мы отправили новый код на …» under the field", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LoginDoor config={DOCTOR_FIXTURE} landing="/" />);
      await user.click(screen.getByTestId("login-method-otp"));
      await user.type(screen.getByLabelText(COPY.otp.emailLabel), EMAIL);
      await user.click(screen.getByTestId("otp-send"));
      await screen.findByTestId("otp-verify");
      expect(screen.queryByTestId("otp-resend-notice")).toBeNull();

      act(() => vi.advanceTimersByTime(60_000));
      await user.click(screen.getByTestId("otp-resend"));

      await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(2));
      expect(await screen.findByTestId("otp-resend-notice")).toHaveTextContent(
        `Мы отправили новый код на ${EMAIL}.`,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
