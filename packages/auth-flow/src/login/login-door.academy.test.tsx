// @vitest-environment jsdom
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

/**
 * The sign-in door driven the way a VISITOR drives it (#2027 PR 1.5, gate rows
 * 21/39/46) — the challenge orchestration, the pending affordances, the carried
 * intent and the post-login routing.
 *
 * These ids arrive from `apps/portal/app/login/page.test.tsx`: none of them was
 * ever about the Academy page, which owned nothing but the mount — they describe
 * the DOOR, so they now run against it directly, over the Academy configuration
 * they were written for. Where the host page read its sentences from `next-intl`
 * message keys, the door reads them from the host config, so the labels below are
 * the fixture's own Academy copy rather than translation keys.
 *
 * Mocked seams:
 *   • `@ds/design-system/blocks` `BotProtectionField` — the PROVIDER widget, the
 *     one thing a unit cannot run. The double reproduces the real field's whole
 *     contract, keyed off the same `sitekey` prop: with no key it resumes the
 *     pending action tokenless (the dev-stand and no-key-build path), with a key
 *     it waits for a token the test drives. So the fixture's `botProtection`
 *     decides the branch — configuration, never a test-only mode switch.
 *   • `../client/auth-client` — the door builds its client from `config.api`, so
 *     the BFF seam is that factory. Both calls hang on a deferred promise so the
 *     in-flight affordance is observable.
 *   • `@ds/events-storefront/client` — `completeReturnTarget` imports
 *     `registerForEvent` from that ENTRY; the rule under the mock is the real one.
 *   • `next/navigation` — the router is the effect under test on success.
 */

type CaptchaProps = {
  sitekey?: string | undefined;
  requestKey: number | null;
  onToken: (token?: string) => void;
  onError: (reason: "expired" | "unavailable" | "incomplete") => void;
};
let captchaProps: CaptchaProps | undefined;
vi.mock("@ds/design-system/blocks", async () => {
  const React = await import("react");
  const actual = await vi.importActual<
    typeof import("@ds/design-system/blocks")
  >("@ds/design-system/blocks");
  return {
    ...actual,
    BotProtectionField: (props: CaptchaProps) => {
      captchaProps = props;
      React.useEffect(() => {
        if (!props.sitekey && props.requestKey !== null)
          props.onToken(undefined);
      }, [props.onToken, props.requestKey, props.sitekey]);
      return props.sitekey ? <div data-testid="bot-protection-field" /> : null;
    },
  };
});

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

let resolveLogin: (() => void) | undefined;
let resolveRequestOtp: (() => void) | undefined;
const login = vi.fn(
  (_body: unknown, _captchaToken?: string) =>
    new Promise<void>((resolve) => (resolveLogin = resolve)),
);
const requestOtp = vi.fn(
  (_body: unknown, _captchaToken?: string) =>
    new Promise<void>((resolve) => (resolveRequestOtp = resolve)),
);
const loginWithOtp = vi.fn();
vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({ login, requestOtp, loginWithOtp }),
}));

const registerForEvent = vi.fn();
vi.mock("@ds/events-storefront/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/client")>()),
  registerForEvent: (slug: string) => registerForEvent(slug),
}));

import { AuthError } from "../client/auth-client";
import { resolveAuthFlowCopy } from "../copy";
import type { AuthFlowHostConfig } from "../host-config";
import { ACADEMY_FIXTURE } from "../test-support/host-config-fixtures";
import { LoginDoor } from "./login-door";

/**
 * The same Academy host, built with a provider site key — the shipped production
 * configuration. Everything the challenge branch below asserts is reached by this
 * one field of config; `ACADEMY_FIXTURE` itself states none, which is the no-key
 * build whose protected actions resume tokenless.
 */
const ACADEMY_WITH_CAPTCHA: AuthFlowHostConfig = {
  ...ACADEMY_FIXTURE,
  botProtection: { siteKey: "academy-site-key" },
};

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3r$ecretPw!9";

/** The Academy's own sentences, read off the config the door is handed. */
const COPY = resolveAuthFlowCopy(ACADEMY_FIXTURE).login;

function renderDoor(
  config: AuthFlowHostConfig = ACADEMY_FIXTURE,
  props?: { returnTo?: string | null; returnTarget?: string | null },
) {
  return render(
    <LoginDoor
      config={config}
      landing={ACADEMY_FIXTURE.landing.afterLogin}
      {...props}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  login.mockClear();
  requestOtp.mockClear();
  loginWithOtp.mockClear().mockResolvedValue({});
  registerForEvent.mockClear().mockResolvedValue({ registered: true });
  resolveLogin = undefined;
  resolveRequestOtp = undefined;
  captchaProps = undefined;
});

afterEach(() => {
  resolveLogin?.();
  resolveRequestOtp?.();
  cleanup();
});

describe("003 EARS-17 on-demand login protection", () => {
  it("EARS-17: password login starts without CAPTCHA, then a stable backend challenge retries the original values exactly once", async () => {
    login
      .mockRejectedValueOnce(
        new AuthError(403, "challenge required", "BOT_PROTECTION_REQUIRED"),
      )
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderDoor(ACADEMY_WITH_CAPTCHA);
    await user.type(
      screen.getByLabelText(COPY.password.identifierLabel),
      EMAIL,
    );
    await user.type(
      screen.getByLabelText(COPY.password.passwordLabel, {
        selector: "input",
      }),
      PASSWORD,
    );

    await user.click(screen.getByTestId("password-login-submit"));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    // Row 18: an ordinary first attempt carries no token at all — neither a body
    // field (which no longer exists) nor a header.
    expect(login).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ identifier: EMAIL, password: PASSWORD }),
      undefined,
    );
    await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());

    act(() => captchaProps?.onToken("fresh-login-token"));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    expect(login).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ identifier: EMAIL, password: PASSWORD }),
      "fresh-login-token",
    );
    act(() => captchaProps?.onToken("fresh-login-token"));
    expect(login).toHaveBeenCalledTimes(2);
  });

  it("EARS-17: the initial sign-in-code request waits for a fresh challenge token", async () => {
    requestOtp.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderDoor(ACADEMY_WITH_CAPTCHA);
    await user.click(screen.getByTestId("login-method-otp"));
    await user.type(screen.getByLabelText(COPY.otp.emailLabel), EMAIL);
    await user.click(screen.getByTestId("otp-send"));

    expect(requestOtp).not.toHaveBeenCalled();
    await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());
    act(() => captchaProps?.onToken("fresh-otp-token"));
    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(1));
    expect(requestOtp).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: EMAIL }),
      "fresh-otp-token",
    );
  });

  it("EARS-17: login-code confirmation stays challenge-free", async () => {
    requestOtp.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderDoor(ACADEMY_WITH_CAPTCHA);
    await user.click(screen.getByTestId("login-method-otp"));
    await user.type(screen.getByLabelText(COPY.otp.emailLabel), EMAIL);
    await user.click(screen.getByTestId("otp-send"));
    await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());
    act(() => captchaProps?.onToken("fresh-otp-token"));
    await screen.findByTestId("otp-verify");

    await user.type(screen.getByRole("textbox"), "12345678");
    await waitFor(() => expect(loginWithOtp).toHaveBeenCalledTimes(1));
    expect(captchaProps?.requestKey).toBeNull();
  });
});

describe("003 EARS-17 sign-in-code resend", () => {
  it("EARS-17: login-code resend executes a new challenge and sends once", async () => {
    requestOtp.mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      renderDoor(ACADEMY_WITH_CAPTCHA);
      fireEvent.mouseDown(screen.getByTestId("login-method-otp"), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.change(screen.getByLabelText(COPY.otp.emailLabel), {
        target: { value: EMAIL },
      });
      fireEvent.click(screen.getByTestId("otp-send"));
      // Parked behind the first challenge; the token is what releases it. The
      // submit handler resolves on a microtask, so flush before reading the key.
      await act(async () => {
        await Promise.resolve();
      });
      expect(requestOtp).not.toHaveBeenCalled();
      expect(captchaProps?.requestKey).not.toBeNull();
      act(() => captchaProps?.onToken("fresh-otp-token"));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(requestOtp).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("otp-verify")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(30_000));
      fireEvent.click(screen.getByTestId("otp-resend"));
      expect(requestOtp).toHaveBeenCalledTimes(1);
      expect(captchaProps?.requestKey).not.toBeNull();

      act(() => captchaProps?.onToken("fresh-otp-resend-token"));
      await act(async () => Promise.resolve());
      expect(requestOtp).toHaveBeenCalledTimes(2);
      expect(requestOtp).toHaveBeenLastCalledWith(
        expect.objectContaining({ identifier: EMAIL }),
        "fresh-otp-resend-token",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * #337 (submit/pending progress visualization): every async auth submit must show
 * the shared `Button.loading` affordance (spinner + `aria-busy` +
 * disabled-while-loading) driven from the form's `isSubmitting`, so the surface
 * reads as "working" instead of a static disabled button that looks hung (the
 * #333 Stage-B owner finding). This covers BOTH submits the door owns: the EARS-5
 * password login and the EARS-6/7 OTP request ("send code"). Each is held in
 * flight by the deferred client promise so the pending affordance is observable.
 */
describe("/login submit pending affordances (#337)", () => {
  it("shows spinner + aria-busy on the password submit while the login request is in flight", async () => {
    const user = userEvent.setup();
    renderDoor();

    await user.type(
      screen.getByLabelText(COPY.password.identifierLabel),
      EMAIL,
    );
    await user.type(
      screen.getByLabelText(COPY.password.passwordLabel, {
        selector: "input",
      }),
      PASSWORD,
    );

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
    renderDoor();

    // Switch to the passwordless OTP method (Radix unmounts the password tab).
    await user.click(screen.getByTestId("login-method-otp"));
    await user.type(screen.getByLabelText(COPY.otp.emailLabel), EMAIL);

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
 * 005 EARS-2 — guest-through-auth completion: a guest carried into the 003 login
 * flow with an event context (`?returnTo=/webinars/:slug`, reconstructed by the
 * mount into the completion target) comes out REGISTERED for that same event and
 * lands back on that event page — the same `RegisterForEvent` (EARS-1) fires after
 * the session exists, with no re-search and no second «Участвовать» tap. Without
 * a carried context the shipped behavior is untouched (land on the discovery
 * listing, register nothing).
 */
describe("005 EARS-2 guest-through-auth completion on the sign-in door", () => {
  it("EARS-2: on password-login success with a carried event context, the system shall register for that event and land on its page", async () => {
    const user = userEvent.setup();
    renderDoor(ACADEMY_FIXTURE, { returnTarget: "/webinars/ahilles-042" });

    await user.type(
      screen.getByLabelText(COPY.password.identifierLabel),
      EMAIL,
    );
    await user.type(
      screen.getByLabelText(COPY.password.passwordLabel, {
        selector: "input",
      }),
      PASSWORD,
    );
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
    renderDoor();

    await user.type(
      screen.getByLabelText(COPY.password.identifierLabel),
      EMAIL,
    );
    await user.type(
      screen.getByLabelText(COPY.password.passwordLabel, {
        selector: "input",
      }),
      PASSWORD,
    );
    await user.click(screen.getByTestId("password-login-submit"));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    resolveLogin?.();

    // 008 EARS-7, amended by 013 EARS-15 — the default post-login landing is the
    // discovery listing `/webinars`, never the Academy landing `/`.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/webinars"));
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("EARS-2: a cross-origin returnTo is rejected — login success lands on the discovery listing (`/webinars`, 008 EARS-7 as amended by 013 EARS-15), nothing registers", async () => {
    const user = userEvent.setup();
    renderDoor(ACADEMY_FIXTURE, { returnTarget: "//evil.example" });

    await user.type(
      screen.getByLabelText(COPY.password.identifierLabel),
      EMAIL,
    );
    await user.type(
      screen.getByLabelText(COPY.password.passwordLabel, {
        selector: "input",
      }),
      PASSWORD,
    );
    await user.click(screen.getByTestId("password-login-submit"));

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    resolveLogin?.();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/webinars"));
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("EARS-2: on OTP-login success with a carried event context, the system shall register for that event and land on its page", async () => {
    const user = userEvent.setup();
    renderDoor(ACADEMY_FIXTURE, { returnTarget: "/webinars/ahilles-042" });

    // Request a code on the passwordless method…
    await user.click(screen.getByTestId("login-method-otp"));
    await user.type(screen.getByLabelText(COPY.otp.emailLabel), EMAIL);
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

  it("EARS-2: the create-account link carries the event context onward into /register", () => {
    renderDoor(ACADEMY_FIXTURE, { returnTo: "/webinars/ahilles-042" });

    expect(
      screen.getByRole("link", { name: COPY.createAccount }),
    ).toHaveAttribute("href", "/register?returnTo=%2Fwebinars%2Fahilles-042");
  });

  // #2027 rule S3: recovery is an INTERRUPTION of wherever the visitor was going,
  // not a journey of its own — «Забыли пароль» was the last bare literal on this
  // card, so a doctor sent here from a closed page lost it by choosing to recover.
  it("#2027 S3: the «Забыли пароль» link carries the arrival target onward into /reset", () => {
    renderDoor(ACADEMY_FIXTURE, { returnTo: "/account/events" });

    expect(
      screen.getByRole("link", { name: COPY.forgotPassword }),
    ).toHaveAttribute("href", "/reset?returnTo=%2Faccount%2Fevents");
  });

  it("#2027 S3: a hostile target is dropped from the recovery link, never propagated", () => {
    renderDoor(ACADEMY_FIXTURE, { returnTo: "//evil.example" });

    expect(
      screen.getByRole("link", { name: COPY.forgotPassword }),
    ).toHaveAttribute("href", "/reset");
  });
});

/**
 * 008 EARS-5 (#2281): the header is server-rendered in the persistent `@chrome`
 * slot, so every page the guest saw before signing in sits in the client Router
 * Cache with the GUEST cluster. Browser Back replays that cached payload, so a
 * signed-in doctor would see «Войти / Регистрация» again. The sign-in drops the
 * cache after it navigates, and Back re-reads the header from the server.
 */
describe("008 EARS-5 sign-in drops the client Router Cache (#2281)", () => {
  it("EARS-5: password-login success refreshes the router after the landing push", async () => {
    const user = userEvent.setup();
    renderDoor();

    await user.type(
      screen.getByLabelText(COPY.password.identifierLabel),
      EMAIL,
    );
    await user.type(
      screen.getByLabelText(COPY.password.passwordLabel, {
        selector: "input",
      }),
      PASSWORD,
    );
    await user.click(screen.getByTestId("password-login-submit"));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    resolveLogin?.();

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(push.mock.invocationCallOrder[0]!).toBeLessThan(
      refresh.mock.invocationCallOrder[0]!,
    );
  });

  it("EARS-5: OTP-login success refreshes the router after the landing push", async () => {
    const user = userEvent.setup();
    renderDoor();

    await user.click(screen.getByTestId("login-method-otp"));
    await user.type(screen.getByLabelText(COPY.otp.emailLabel), EMAIL);
    await user.click(screen.getByTestId("otp-send"));
    await waitFor(() => expect(requestOtp).toHaveBeenCalledTimes(1));
    resolveRequestOtp?.();

    await screen.findByTestId("otp-verify");
    await user.click(screen.getByRole("textbox"));
    await user.keyboard("12345678");

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(loginWithOtp).toHaveBeenCalledTimes(1);
    expect(push.mock.invocationCallOrder[0]!).toBeLessThan(
      refresh.mock.invocationCallOrder[0]!,
    );
  });
});
