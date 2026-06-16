import { render, screen, cleanup, waitFor } from "@testing-library/react";
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
