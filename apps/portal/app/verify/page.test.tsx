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

import VerifyPage from "./page";

/**
 * /verify (#227/#267): the registration verification surface keeps its existence-
 * agnostic DUAL-affordance (enter the email code AND the co-equal Войти / Сбросить
 * пароль actions, EARS-24) — it is NOT collapsed into the single-focus
 * `<OtpFocusScreen>`. On top of that layout it gains resend-with-cooldown wired to
 * the REAL EARS-25 endpoint (`resendVerification` → `/v1/auth/verify/resend`, #319),
 * and the existing auto-submit + EARS-16 generic outcome are preserved.
 *
 * These tests drive the real page and assert: resend is disabled during the cooldown
 * → re-enabled after, hits the RIGHT endpoint, both co-equal paths remain present,
 * and the fixed-length code auto-submits.
 */

const replace = vi.fn();
const push = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => searchParams,
}));

// Passthrough i18n: return the key (tests assert on stable testids / roles, not
// copy). `t.rich` renders the chunks so the description still mounts.
vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.rich = (key: string) => key;
    return t;
  },
}));

const verify = vi.fn().mockResolvedValue({ status: "verified" });
const login = vi.fn().mockResolvedValue({});
const resendVerification = vi.fn().mockResolvedValue({ status: "resend_requested" });
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    verify: (body: unknown) => verify(body),
    login: (body: unknown) => login(body),
    resendVerification: (body: unknown) => resendVerification(body),
  },
  AuthError: class extends Error {},
}));

// No held password by default (deep-link path → route to /login after verify).
vi.mock("@/lib/pending-registration", () => ({
  takePendingRegistration: () => null,
}));

const EMAIL = "doc@example.com";
const VERIFY_CODE = "PVDC3R";

beforeEach(() => {
  replace.mockClear();
  push.mockClear();
  verify.mockClear();
  login.mockClear();
  resendVerification.mockClear();
  searchParams = new URLSearchParams({ email: EMAIL });
});
afterEach(cleanup);

describe("/verify dual-affordance + resend (#227/#267)", () => {
  it("keeps BOTH co-equal paths: the code form AND the sign-in / reset actions", () => {
    render(<VerifyPage />);
    // (a) code entry path.
    expect(screen.getByTestId("verify-submit")).toBeInTheDocument();
    // (b) already-registered owner's prominent path — NOT collapsed away.
    expect(screen.getByTestId("verify-go-to-login")).toBeInTheDocument();
    expect(screen.getByTestId("verify-go-to-reset")).toBeInTheDocument();
  });

  it("resend is disabled during cooldown, re-enables after, hits the EARS-25 endpoint, and re-arms", async () => {
    // Fake timers drive the cooldown synchronously (the proven OtpFocusScreen
    // pattern); `fireEvent.click` is synchronous, so it works under fake timers
    // where `userEvent.click`'s internal pointer delays would hang.
    vi.useFakeTimers();
    try {
      render(<VerifyPage />);
      const resend = screen.getByTestId("verify-resend");
      // Starts in the 30s cooldown — disabled, no request can fire.
      expect(resend).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(resend).not.toBeDisabled();

      // Click the now-enabled resend and let the async handler resolve.
      fireEvent.click(resend);
      await act(async () => {
        await Promise.resolve();
      });
      expect(resendVerification).toHaveBeenCalledTimes(1);
      // The RIGHT endpoint (the dedicated verify/resend, NOT re-register) for the
      // seeded identifier.
      expect(resendVerification).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: EMAIL }),
      );
      expect(verify).not.toHaveBeenCalled();
      // Cooldown restarts on the successful resend (nonce bump re-disables it).
      expect(resend).toBeDisabled();
      // #326: a neutral, enumeration-safe confirmation now appears on success —
      // role="status" (aria-live polite), NOT a destructive error. This is the
      // fix for the "dead button" (the resend re-armed the cooldown but acknowledged
      // nothing). It is purely UI: no extra backend call beyond the resend itself.
      const notice = screen.getByTestId("verify-resend-notice");
      expect(notice).toBeInTheDocument();
      expect(notice).toHaveAttribute("role", "status");
    } finally {
      vi.useRealTimers();
    }
  });

  it("#326: the resend confirmation is the SAME regardless of the email (no existence branch)", async () => {
    // The on-screen response to a resend is generic and identical in every case —
    // the account-exists fact is disclosed out-of-band by email, never here. Drive
    // two different emails and assert the same neutral notice copy both times.
    async function noticeTextFor(emailValue: string): Promise<string> {
      searchParams = new URLSearchParams({ email: emailValue });
      vi.useFakeTimers();
      try {
        render(<VerifyPage />);
        const resend = screen.getByTestId("verify-resend");
        act(() => {
          vi.advanceTimersByTime(30_000);
        });
        fireEvent.click(resend);
        await act(async () => {
          await Promise.resolve();
        });
        const text = screen.getByTestId("verify-resend-notice").textContent ?? "";
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

  it("hides resend when there is no email destination to target (bare deep-link)", () => {
    searchParams = new URLSearchParams();
    render(<VerifyPage />);
    expect(screen.queryByTestId("verify-resend")).not.toBeInTheDocument();
    // …but the dual-affordance paths still render.
    expect(screen.getByTestId("verify-submit")).toBeInTheDocument();
    expect(screen.getByTestId("verify-go-to-login")).toBeInTheDocument();
  });

  it("auto-submits the fixed-length code (no manual click) and verifies it (EARS-16 path preserved)", async () => {
    const user = userEvent.setup();
    render(<VerifyPage />);

    const codeInput = screen.getByRole("textbox");
    await user.click(codeInput);
    await user.keyboard(VERIFY_CODE);

    // The 6-char code auto-submits via the field's onComplete — no click on
    // verify-submit needed.
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, code: VERIFY_CODE }),
    );
  });
});
