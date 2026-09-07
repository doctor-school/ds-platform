// @vitest-environment jsdom
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 003 EARS-11/12/16 (#1989) — the BEHAVIOUR of the doctor storefront's `/reset`
 * projection: exactly the half the shared `<PasswordRecoveryCard>` does not own.
 *
 * The composition itself — the two stage forms, the resend footer, the cooldown
 * timer, the acknowledgement slot — is asserted once in
 * `packages/design-system/src/blocks/password-recovery-card.test.tsx`. What is
 * pinned HERE is the host contract: which BFF command each submit runs, that the
 * screen advances on ANY accepted initiate (EARS-16 leaks no existence), that
 * completion lands on THIS host's `/account` with the server tree re-read, and
 * that a failed command surfaces the doctor-owned RU sentence rather than the
 * api's English.
 */

const h = vi.hoisted(() => {
  class AuthError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code?: string,
    ) {
      super(message);
      this.name = "AuthError";
    }
  }
  return {
    AuthError,
    requestPasswordReset: vi.fn(),
    completePasswordReset: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
  };
});

// STABLE router object, for the reason `account-screen.test.tsx` records: a
// fresh object per render refires effects in a loop.
const router = { push: h.push, refresh: h.refresh, replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// `next/link` wants the App-Router context this tier does not mount; the anchor
// it renders is the thing these assertions are about, so a passthrough is honest.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@/lib/auth-client", () => ({
  AuthError: h.AuthError,
  authClient: {
    requestPasswordReset: h.requestPasswordReset,
    completePasswordReset: h.completePasswordReset,
  },
}));

// `lib/auth-error-message.ts` is NOT mocked: the RU sentence a doctor reads is
// part of what this screen owns, so it is asserted through the real mapping —
// which branches on the same `AuthError` class mocked above.

import { ResetScreen } from "@/components/reset-screen";

const CODE = "PVDC3R";
const NEW_PASSWORD = "Sup3r$ecretPw!9";

beforeEach(() => {
  vi.clearAllMocks();
  h.requestPasswordReset.mockResolvedValue({ ok: true });
  h.completePasswordReset.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

/** Fill the identifier and run the EARS-11 initiate step. */
async function requestCode(identifier = "doctor@clinic.ru") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Почта или телефон"), identifier);
  await user.click(screen.getByTestId("reset-request-submit"));
  return user;
}

describe("003 EARS-11/12 #1989: the doctor /reset projection", () => {
  it("003 EARS-11: the first paint is the SHARED PasswordRecoveryCard in this host RU copy, back to THIS host sign-in", () => {
    const html = renderToStaticMarkup(<ResetScreen />);

    // The block's own testid — proof the card is projected, not re-built here.
    expect(html).toContain('data-testid="reset-request-submit"');
    expect(html).toContain("Восстановление пароля");
    expect(html).toContain("Почта или телефон");
    // The #1933/#1958 crossing is gone: recovery ends at the storefront door.
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("academy.doctor.school");
  });

  it("003 EARS-11: the initiate step POSTs the typed identifier through the host BFF client", async () => {
    render(<ResetScreen />);

    await requestCode("doctor@clinic.ru");

    await waitFor(() =>
      expect(h.requestPasswordReset).toHaveBeenCalledWith({
        identifier: "doctor@clinic.ru",
      }),
    );
  });

  it("003 EARS-16: an UNKNOWN identifier reaches the very same code step — the screen discloses no existence", async () => {
    // The BFF answers identically for an unknown subject, so the host has
    // nothing to branch on and must advance regardless.
    render(<ResetScreen />);

    await requestCode("nobody@nowhere.example");

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1 }).textContent,
      ).toContain("Новый пароль"),
    );
    expect(screen.getByLabelText("Код из письма")).toBeTruthy();
    expect(screen.queryByTestId("reset-request-submit")).toBeNull();
  });

  it("003 EARS-12: completing sends the code with the HELD identifier and lands on this host /account, signed in", async () => {
    render(<ResetScreen />);
    const user = await requestCode("doctor@clinic.ru");
    await waitFor(() =>
      expect(screen.getByLabelText("Код из письма")).toBeTruthy(),
    );

    await user.type(screen.getByLabelText("Код из письма"), CODE);
    await user.type(screen.getByLabelText("Новый пароль"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Сменить пароль" }));

    await waitFor(() =>
      expect(h.completePasswordReset).toHaveBeenCalledWith({
        identifier: "doctor@clinic.ru",
        code: CODE,
        newPassword: NEW_PASSWORD,
      }),
    );
    // #221 auto-login: the response minted a session ON THIS ORIGIN, so the
    // doctor goes to the authenticated area, and the server tree is re-read so
    // the 017 header flips to the signed-in cluster.
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/account"));
    expect(h.refresh).toHaveBeenCalled();
  });

  it("003 EARS-16: a REFUSED completion shows this host RU sentence and keeps the doctor on the code step", async () => {
    h.completePasswordReset.mockRejectedValue(
      new h.AuthError(400, "invalid code"),
    );
    render(<ResetScreen />);
    const user = await requestCode();
    await waitFor(() =>
      expect(screen.getByLabelText("Код из письма")).toBeTruthy(),
    );

    await user.type(screen.getByLabelText("Код из письма"), CODE);
    await user.type(screen.getByLabelText("Новый пароль"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Сменить пароль" }));

    await waitFor(() =>
      expect(
        screen.getByText("Не удалось сменить пароль. Проверьте код и попробуйте ещё раз."),
      ).toBeTruthy(),
    );
    // The api English never reaches the doctor, and nothing navigated away.
    expect(screen.queryByText("invalid code")).toBeNull();
    expect(h.push).not.toHaveBeenCalled();
  });

  it("003 EARS-11: a refused INITIATE keeps the doctor on the request step with the host RU sentence", async () => {
    h.requestPasswordReset.mockRejectedValue(
      new h.AuthError(500, "upstream is down"),
    );
    render(<ResetScreen />);

    await requestCode();

    await waitFor(() =>
      expect(
        screen.getByText("Сервис временно недоступен. Попробуйте ещё раз через минуту."),
      ).toBeTruthy(),
    );
    expect(screen.getByTestId("reset-request-submit")).toBeTruthy();
  });

  it("#267: the resend re-runs the INITIATE for the held identifier and acknowledges it neutrally (#326)", async () => {
    // The block's 30-second cooldown is real time, so this case — and only this
    // case — runs on a faked clock; `shouldAdvanceTime` keeps `userEvent`'s own
    // internal delays working while it is installed.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ResetScreen />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.type(
        screen.getByLabelText("Почта или телефон"),
        "doctor@clinic.ru",
      );
      await user.click(screen.getByTestId("reset-request-submit"));
      await waitFor(() => expect(screen.queryByTestId("reset-resend")).toBeTruthy());

      // Cooling down right after the first send — the timer itself is the
      // block's business and is asserted there; what matters here is WHICH
      // command the control runs once it opens.
      await act(async () => {
        vi.advanceTimersByTime(31_000);
      });
      await user.click(screen.getByTestId("reset-resend"));

      await waitFor(() =>
        expect(h.requestPasswordReset).toHaveBeenCalledTimes(2),
      );
      expect(h.requestPasswordReset).toHaveBeenLastCalledWith({
        identifier: "doctor@clinic.ru",
      });
      // Neutral, identical for every visitor, and masked — never "we found you".
      await waitFor(() =>
        expect(
          screen.getByTestId("reset-resend-notice").textContent,
        ).toContain("Отправили код ещё раз на"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("«Начать заново» returns to the request step with an empty box, dropping the held identifier", async () => {
    render(<ResetScreen />);
    const user = await requestCode("doctor@clinic.ru");
    await waitFor(() =>
      expect(screen.getByTestId("reset-restart")).toBeTruthy(),
    );

    await user.click(screen.getByTestId("reset-restart"));

    await waitFor(() =>
      expect(screen.getByTestId("reset-request-submit")).toBeTruthy(),
    );
    expect(
      (screen.getByLabelText("Почта или телефон") as HTMLInputElement).value,
    ).toBe("");
  });
});
