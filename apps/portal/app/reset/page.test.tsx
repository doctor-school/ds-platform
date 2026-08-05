import {
  render,
  screen,
  cleanup,
  act,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ResetPage from "./page";

/**
 * Regression for the /reset-only residual of #212/#211 (found in PR #216 live-verify):
 * the slotted "Код для сброса" field on /reset's COMPLETE step accepted zero input,
 * while /verify and /login worked. Root cause was the page STRUCTURE, not the field
 * wiring: /reset held the complete form in the page component and re-seeded it with
 * `completeForm.reset({ code: "" })` on the request→complete toggle, while the `code`
 * Controller was conditionally mounted only at the complete stage. That late-mounted
 * Controller on a parent-held, post-toggle-reset() form never bound, so the slotted
 * field dropped every keystroke. The fix extracts the complete step into a SEPARATE
 * <ResetCompleteForm/> child with its OWN `useForm`, mounted only at the complete
 * stage — mirroring /login's <OtpVerifyForm/>.
 *
 * This test exercises the REAL page through the request→complete toggle and asserts
 * the code typed AFTER the toggle reaches the submit handler — the exact path the old
 * structure broke and the first-render-only otp-field.test.tsx cases never covered.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

// Passthrough i18n: return the key (the test asserts on stable testids / roles, not
// copy), and interpolate the {identifier} param so descriptionComplete renders.
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

const requestPasswordReset = vi.fn().mockResolvedValue({});
const completePasswordReset = vi.fn().mockResolvedValue({});
// #675: rendering the page mounts the <AuthShell> auth-surface guard, which reads
// `authClient.session()` on mount — default it to the unauthenticated path so the
// form renders as before (the authed branch lives in components/auth-shell.test.tsx).
const session = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    requestPasswordReset: (body: unknown) => requestPasswordReset(body),
    completePasswordReset: (body: unknown) => completePasswordReset(body),
    session: () => session(),
  },
  AuthError: class extends Error {},
}));

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  requestPasswordReset.mockClear();
  completePasswordReset.mockClear();
  captchaMode = "bypass";
  captchaProps = undefined;
});
afterEach(cleanup);

/**
 * Flush the #675 <AuthShell> session-guard microtask under FAKE timers. The guard
 * renders nothing until `session()` resolves (to `null` → anonymous), and a
 * `findBy*` poll would hang while timers are faked — so drain the resolved-promise
 * microtask directly, after which the request form is in the DOM.
 */
async function flushAuthGuard() {
  await act(async () => {
    await Promise.resolve();
  });
}

const IDENTIFIER = "user@example.com";
const RESET_CODE = "PVDC3R";
const NEW_PASSWORD = "Sup3r$ecretPw!9";

describe("003 EARS-17 on-demand password-reset protection", () => {
  it("EARS-17: the initial reset request waits for a fresh challenge token", async () => {
    captchaMode = "manual";
    const user = userEvent.setup();
    render(<ResetPage />);
    await screen.findByTestId("reset-request-submit");
    await user.type(screen.getByRole("textbox"), IDENTIFIER);
    await user.click(screen.getByTestId("reset-request-submit"));

    expect(requestPasswordReset).not.toHaveBeenCalled();
    await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());
    act(() => captchaProps?.onToken("fresh-reset-token"));
    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledTimes(1));
    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ captchaToken: "fresh-reset-token" }),
    );
  });

  it("EARS-17: reset-code resend uses a new challenge while reset completion stays challenge-free", async () => {
    vi.useFakeTimers();
    try {
      render(<ResetPage />);
      await flushAuthGuard();
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: IDENTIFIER },
      });
      fireEvent.click(screen.getByTestId("reset-request-submit"));
      await act(async () => Promise.resolve());
      expect(requestPasswordReset).toHaveBeenCalledTimes(1);

      captchaMode = "manual";
      act(() => vi.advanceTimersByTime(30_000));
      fireEvent.click(screen.getByTestId("reset-resend"));
      expect(requestPasswordReset).toHaveBeenCalledTimes(1);
      expect(captchaProps?.requestKey).not.toBeNull();
      act(() => captchaProps?.onToken("fresh-reset-resend-token"));
      await act(async () => Promise.resolve());
      expect(requestPasswordReset).toHaveBeenCalledTimes(2);
      expect(requestPasswordReset).toHaveBeenLastCalledWith(
        expect.objectContaining({ captchaToken: "fresh-reset-resend-token" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

async function advanceToCompleteStage(
  user: ReturnType<typeof userEvent.setup>,
) {
  // #675: wait past the <AuthShell> session-guard so the request form is mounted.
  await screen.findByTestId("reset-request-submit");
  // Request step: fill the union identifier box and submit to toggle stage→complete.
  const identifierInput = screen.getByRole("textbox");
  await user.type(identifierInput, IDENTIFIER);
  await user.click(screen.getByTestId("reset-request-submit"));
  await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledTimes(1));
  // The complete step's <ResetCompleteForm/> mounts only now (late-mount path).
  await screen.findByRole("textbox");
}

describe("/reset complete step — resend with cooldown (#267)", () => {
  it("resend is disabled during the cooldown, then re-enables and re-calls the REAL requestPasswordReset", async () => {
    // Fake timers from the start so the complete step's cooldown interval is fake
    // from creation (a `useFakeTimers()` installed AFTER mount can't advance an
    // already-scheduled real interval). All interaction here is `fireEvent`
    // (synchronous) — userEvent's internal delays hang under fake timers.
    vi.useFakeTimers();
    try {
      render(<ResetPage />);
      await flushAuthGuard(); // #675: mount the request form past the session-guard.

      // Request step → complete step, via synchronous events.
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: IDENTIFIER },
      });
      fireEvent.click(screen.getByTestId("reset-request-submit"));
      await act(async () => {
        await Promise.resolve();
      });
      // One call so far — the initial request that flipped to the complete stage.
      expect(requestPasswordReset).toHaveBeenCalledTimes(1);

      // The resend control starts in cooldown (countdown running), so it is disabled
      // and a click does NOT fire a second request.
      const resend = screen.getByTestId("reset-resend");
      expect(resend).toBeDisabled();

      // Drain the 30s cooldown synchronously; the control re-enables.
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(resend).not.toBeDisabled();

      // A resend re-issues the code via the EXISTING requestPasswordReset endpoint
      // (no new backend) for the SAME held identifier.
      fireEvent.click(resend);
      await act(async () => {
        await Promise.resolve();
      });
      expect(requestPasswordReset).toHaveBeenCalledTimes(2);
      expect(requestPasswordReset).toHaveBeenLastCalledWith(
        expect.objectContaining({ identifier: IDENTIFIER }),
      );
      // And the cooldown restarts (disabled again) on the successful resend.
      expect(resend).toBeDisabled();
      // #326: a neutral, enumeration-safe confirmation appears on success —
      // role="status" (aria-live polite), NOT a destructive error. Fixes the "dead
      // button" that re-armed the cooldown but acknowledged nothing. UI-only.
      const notice = screen.getByTestId("reset-resend-notice");
      expect(notice).toBeInTheDocument();
      expect(notice).toHaveAttribute("role", "status");
    } finally {
      vi.useRealTimers();
    }
  });

  it("#326: the resend confirmation is the SAME regardless of the identifier (no existence branch)", async () => {
    // The on-screen response is generic and identical whether or not an account
    // exists for the identifier — disclosure is out-of-band by email, never here.
    async function noticeTextFor(idValue: string): Promise<string> {
      vi.useFakeTimers();
      try {
        render(<ResetPage />);
        await flushAuthGuard(); // #675: mount the request form past the session-guard.
        fireEvent.change(screen.getByRole("textbox"), {
          target: { value: idValue },
        });
        fireEvent.click(screen.getByTestId("reset-request-submit"));
        await act(async () => {
          await Promise.resolve();
        });
        const resend = screen.getByTestId("reset-resend");
        act(() => {
          vi.advanceTimersByTime(30_000);
        });
        fireEvent.click(resend);
        await act(async () => {
          await Promise.resolve();
        });
        const text =
          screen.getByTestId("reset-resend-notice").textContent ?? "";
        cleanup();
        return text;
      } finally {
        vi.useRealTimers();
      }
    }

    const first = await noticeTextFor("registered@example.com");
    const second = await noticeTextFor("never-seen@example.com");
    expect(first).toBe(second);
    expect(first).not.toBe("");
  });

  it("«начать заново» returns to the request step (change identifier)", async () => {
    const user = userEvent.setup();
    render(<ResetPage />);
    await advanceToCompleteStage(user);

    // Complete step shows the new-password field; restart returns to the request
    // step where it is absent and the identifier box is editable again.
    expect(screen.getByLabelText("newPasswordLabel")).toBeInTheDocument();
    await user.click(screen.getByTestId("reset-restart"));

    await waitFor(() =>
      expect(
        screen.queryByLabelText("newPasswordLabel"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("reset-request-submit")).toBeInTheDocument();
  });
});

describe("/reset complete step (late-mounted slotted code field)", () => {
  it("EARS-17: ingests the code after the toggle and completes reset challenge-free", async () => {
    const user = userEvent.setup();
    render(<ResetPage />);

    await advanceToCompleteStage(user);
    captchaMode = "manual";

    // input-otp exposes a single hidden textbox for the slotted group.
    const codeInput = screen.getByRole("textbox");
    await user.click(codeInput);
    await user.keyboard(RESET_CODE);
    await waitFor(() => expect(codeInput).toHaveValue(RESET_CODE));

    const passwordInput = screen.getByLabelText("newPasswordLabel");
    await user.type(passwordInput, NEW_PASSWORD);

    await user.click(screen.getByRole("button", { name: "setNewPassword" }));

    await waitFor(() => expect(completePasswordReset).toHaveBeenCalledTimes(1));
    // The code typed into the late-mounted field must reach the submit body — the
    // exact value the pre-fix /reset structure dropped to "".
    expect(completePasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: IDENTIFIER,
        code: RESET_CODE,
        newPassword: NEW_PASSWORD,
      }),
    );
    expect(captchaProps?.requestKey).toBeNull();
  });

  // #221 (EARS-12): a completed reset auto-logs-in (the BFF set the session
  // cookie), so the page routes straight to /account — NOT back to /login.
  it("EARS-12: when the reset completes, the page routes to /account (auto-login), not /login", async () => {
    const user = userEvent.setup();
    render(<ResetPage />);

    await advanceToCompleteStage(user);

    const codeInput = screen.getByRole("textbox");
    await user.click(codeInput);
    await user.keyboard(RESET_CODE);
    await waitFor(() => expect(codeInput).toHaveValue(RESET_CODE));
    await user.type(screen.getByLabelText("newPasswordLabel"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "setNewPassword" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/account"));
    expect(push).not.toHaveBeenCalledWith("/login");
  });
});

/**
 * #337 (submit/pending progress visualization): both /reset submits — the request
 * step and the complete step — must show the shared `Button.loading` affordance
 * (spinner + `aria-busy`) while their network call is in flight, instead of a static
 * disabled button that reads as hung (the #333 Stage-B owner finding). Each call is
 * held pending (a never-resolving promise) so the affordance can be asserted.
 */
describe("/reset submit pending affordances (#337)", () => {
  it("shows spinner + aria-busy on the request submit while requestPasswordReset is in flight", async () => {
    const user = userEvent.setup();
    requestPasswordReset.mockImplementationOnce(() => new Promise(() => {}));
    render(<ResetPage />);
    // #675: wait past the <AuthShell> session-guard so the request form is mounted.
    await screen.findByTestId("reset-request-submit");

    await user.type(screen.getByRole("textbox"), IDENTIFIER);
    const submit = screen.getByTestId("reset-request-submit");
    expect(submit).not.toHaveAttribute("aria-busy");

    await user.click(submit);

    await waitFor(() => {
      expect(requestPasswordReset).toHaveBeenCalledTimes(1);
      expect(submit).toHaveAttribute("aria-busy", "true");
    });
    expect(submit.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("shows spinner + aria-busy on the complete submit while completePasswordReset is in flight", async () => {
    const user = userEvent.setup();
    render(<ResetPage />);

    await advanceToCompleteStage(user);

    const codeInput = screen.getByRole("textbox");
    await user.click(codeInput);
    await user.keyboard(RESET_CODE);
    await waitFor(() => expect(codeInput).toHaveValue(RESET_CODE));
    await user.type(screen.getByLabelText("newPasswordLabel"), NEW_PASSWORD);

    completePasswordReset.mockImplementationOnce(() => new Promise(() => {}));
    const submit = screen.getByRole("button", { name: "setNewPassword" });
    expect(submit).not.toHaveAttribute("aria-busy");

    await user.click(submit);

    await waitFor(() => {
      expect(completePasswordReset).toHaveBeenCalledTimes(1);
      expect(submit).toHaveAttribute("aria-busy", "true");
    });
    expect(submit.querySelector("svg.animate-spin")).not.toBeNull();
  });
});
