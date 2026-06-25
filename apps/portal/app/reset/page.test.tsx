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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

// Passthrough i18n: return the key (the test asserts on stable testids / roles, not
// copy), and interpolate the {identifier} param so descriptionComplete renders.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const requestPasswordReset = vi.fn().mockResolvedValue({});
const completePasswordReset = vi.fn().mockResolvedValue({});
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    requestPasswordReset: (body: unknown) => requestPasswordReset(body),
    completePasswordReset: (body: unknown) => completePasswordReset(body),
  },
  AuthError: class extends Error {},
}));

beforeEach(() => {
  push.mockClear();
  requestPasswordReset.mockClear();
  completePasswordReset.mockClear();
});
afterEach(cleanup);

const IDENTIFIER = "user@example.com";
const RESET_CODE = "PVDC3R";
const NEW_PASSWORD = "Sup3r$ecretPw!9";

async function advanceToCompleteStage(user: ReturnType<typeof userEvent.setup>) {
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
    } finally {
      vi.useRealTimers();
    }
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
      expect(screen.queryByLabelText("newPasswordLabel")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("reset-request-submit")).toBeInTheDocument();
  });
});

describe("/reset complete step (late-mounted slotted code field)", () => {
  it("ingests the code typed AFTER the request->complete toggle and submits it", async () => {
    const user = userEvent.setup();
    render(<ResetPage />);

    await advanceToCompleteStage(user);

    // input-otp exposes a single hidden textbox for the slotted group.
    const codeInput = screen.getByRole("textbox");
    await user.click(codeInput);
    await user.keyboard(RESET_CODE);
    await waitFor(() => expect(codeInput).toHaveValue(RESET_CODE));

    const passwordInput = screen.getByLabelText("newPasswordLabel");
    await user.type(passwordInput, NEW_PASSWORD);

    await user.click(screen.getByRole("button", { name: "setNewPassword" }));

    await waitFor(() =>
      expect(completePasswordReset).toHaveBeenCalledTimes(1),
    );
    // The code typed into the late-mounted field must reach the submit body — the
    // exact value the pre-fix /reset structure dropped to "".
    expect(completePasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: IDENTIFIER,
        code: RESET_CODE,
        newPassword: NEW_PASSWORD,
      }),
    );
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
