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
  return {
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

vi.mock("@/lib/auth-flow-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-flow-client")>()),
  authClient: {
    requestPasswordReset: h.requestPasswordReset,
    completePasswordReset: h.completePasswordReset,
  },
}));

// The `@ds/auth-flow/errors` dictionary is NOT mocked: the RU sentence a doctor
// reads is this host's own copy, so it is asserted through the real mapping —
// which branches on the real `AuthError` thrown below.

import { AuthError } from "@ds/auth-flow/client";

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
    const html = renderToStaticMarkup(
      <ResetScreen loginHref="/login" landing="/account" />,
    );

    // The block's own testid — proof the card is projected, not re-built here.
    expect(html).toContain('data-testid="reset-request-submit"');
    expect(html).toContain("Восстановление пароля");
    expect(html).toContain("Почта или телефон");
    // The #1933/#1958 crossing is gone: recovery ends at the storefront door.
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("academy.doctor.school");
  });

  it("003 EARS-11: the initiate step POSTs the typed identifier through the host BFF client", async () => {
    render(<ResetScreen loginHref="/login" landing="/account" />);

    await requestCode("doctor@clinic.ru");

    await waitFor(() =>
      // Row 18: the captcha token is the client's SECOND argument now, never a
      // body field; with no site key configured in jsdom it is absent.
      expect(h.requestPasswordReset).toHaveBeenCalledWith(
        { identifier: "doctor@clinic.ru" },
        undefined,
      ),
    );
  });

  it("003 EARS-16: an UNKNOWN identifier reaches the very same code step — the screen discloses no existence", async () => {
    // The BFF answers identically for an unknown subject, so the host has
    // nothing to branch on and must advance regardless.
    render(<ResetScreen loginHref="/login" landing="/account" />);

    await requestCode("nobody@nowhere.example");

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        "Новый пароль",
      ),
    );
    expect(screen.getByLabelText("Код из сообщения")).toBeTruthy();
    expect(screen.queryByTestId("reset-request-submit")).toBeNull();
  });

  it("003 EARS-12: completing sends the code with the HELD identifier and lands on this host /account, signed in", async () => {
    render(<ResetScreen loginHref="/login" landing="/account" />);
    const user = await requestCode("doctor@clinic.ru");
    await waitFor(() =>
      expect(screen.getByLabelText("Код из сообщения")).toBeTruthy(),
    );

    await user.type(screen.getByLabelText("Код из сообщения"), CODE);
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
      new AuthError(400, "invalid code"),
    );
    render(<ResetScreen loginHref="/login" landing="/account" />);
    const user = await requestCode();
    await waitFor(() =>
      expect(screen.getByLabelText("Код из сообщения")).toBeTruthy(),
    );

    await user.type(screen.getByLabelText("Код из сообщения"), CODE);
    await user.type(screen.getByLabelText("Новый пароль"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Сменить пароль" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Не удалось сменить пароль. Проверьте код и попробуйте ещё раз.",
        ),
      ).toBeTruthy(),
    );
    // The api English never reaches the doctor, and nothing navigated away.
    expect(screen.queryByText("invalid code")).toBeNull();
    expect(h.push).not.toHaveBeenCalled();
  });

  it("003 EARS-11: a refused INITIATE keeps the doctor on the request step with the host RU sentence", async () => {
    h.requestPasswordReset.mockRejectedValue(
      new AuthError(500, "upstream is down"),
    );
    render(<ResetScreen loginHref="/login" landing="/account" />);

    await requestCode();

    await waitFor(() =>
      expect(
        screen.getByText(
          "Сервис временно недоступен. Попробуйте ещё раз через минуту.",
        ),
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
      render(<ResetScreen loginHref="/login" landing="/account" />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.type(
        screen.getByLabelText("Почта или телефон"),
        "doctor@clinic.ru",
      );
      await user.click(screen.getByTestId("reset-request-submit"));
      await waitFor(() =>
        expect(screen.queryByTestId("reset-resend")).toBeTruthy(),
      );

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
      expect(h.requestPasswordReset).toHaveBeenLastCalledWith(
        { identifier: "doctor@clinic.ru" },
        undefined,
      );
      // Neutral, identical for every visitor, and masked — never "we found you".
      await waitFor(() =>
        expect(screen.getByTestId("reset-resend-notice").textContent).toContain(
          "Отправили код ещё раз на",
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("«Начать заново» returns to the request step with an empty box, dropping the held identifier", async () => {
    render(<ResetScreen loginHref="/login" landing="/account" />);
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

/**
 * Rules S3 + S4 of the auth-flow standard (`packages/auth-flow/README.md`) —
 * recovery is a door like the others, so it CARRIES.
 *
 * The screen hard-coded both ends of the journey: «Вспомнили пароль» went to a
 * bare `/login`, and completion always pushed the fixed `/account`. A doctor who
 * reached recovery from a gated эфир therefore restarted that journey from
 * scratch, and one who reached it from the cabinet lost the page below it. Both
 * ends are now props the route resolves through the shared helpers, so the value
 * this screen navigates to is always a guard reconstruction and never a string
 * it assembled itself.
 */
describe("#2027 S3/S4: /reset carries the arrival target through recovery", () => {
  it("003 EARS-11: «Вспомнили пароль» goes back to the door STILL carrying the target", () => {
    const html = renderToStaticMarkup(
      <ResetScreen loginHref="/login?returnTo=%2Faccount" landing="/account" />,
    );

    expect(html).toContain('href="/login?returnTo=%2Faccount"');
    // Not the bare literal it used to render beside it.
    expect(html).not.toContain('href="/login"');
  });

  it("003 EARS-12: completion lands on the CARRIED target, not the fixed cabinet", async () => {
    render(
      <ResetScreen
        loginHref="/login?returnTo=%2Fevents%2Fprp-pri-gonartroze"
        landing="/events/prp-pri-gonartroze"
      />,
    );
    const user = await requestCode("doctor@clinic.ru");
    await waitFor(() =>
      expect(screen.getByLabelText("Код из сообщения")).toBeTruthy(),
    );

    await user.type(screen.getByLabelText("Код из сообщения"), CODE);
    await user.type(screen.getByLabelText("Новый пароль"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Сменить пароль" }));

    await waitFor(() =>
      expect(h.push).toHaveBeenCalledWith("/events/prp-pri-gonartroze"),
    );
    // The server tree is still re-read — #221's auto-login is unchanged.
    expect(h.refresh).toHaveBeenCalled();
  });
});
