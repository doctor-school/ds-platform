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
  EmailConfirmCard,
  type EmailConfirmCardCopy,
  type EmailConfirmResendProps,
  type EmailConfirmValues,
} from "./email-confirm-card";

/**
 * `<EmailConfirmCard>` (#1666 slice B) — the shared post-registration confirmation
 * composition. These assertions cover the BLOCK's contract only: copy-as-props, the
 * code form's handler payload, the server-confirmed success row, the two co-equal
 * already-registered actions and the #267 resend cooldown. The portal's
 * EARS-numbered behavioural oracle (transport, the auto-login replay, the #904
 * fragment identifier) stays at app level in `apps/portal/app/verify/page.test.tsx`.
 */

/** Neutral, product-free copy — every rendered string must come from here. */
const copy: EmailConfirmCardCopy = {
  title: "copy.title",
  description: (destination) => `copy.description:${destination}`,
  newAccountHeading: "copy.newAccountHeading",
  codeLabel: "copy.codeLabel",
  submit: "copy.submit",
  codeAccepted: "copy.codeAccepted",
  resend: "copy.resend",
  resendCountdown: (seconds) => `copy.resendIn:${seconds}`,
  existingAccountHeading: "copy.existingAccountHeading",
  existingAccountHint: "copy.existingAccountHint",
  goToSignIn: "copy.goToSignIn",
  goToReset: "copy.goToReset",
};

/** Permissive resolver — the HOST owns validation, so the block just forwards values. */
const passthrough =
  <T extends FieldValues>(): Resolver<T> =>
  async (values) => ({ values, errors: {} });

function setup(
  overrides: {
    email?: string | undefined;
    destination?: string;
    onSubmit?: (values: EmailConfirmValues) => Promise<void> | void;
    error?: React.ReactNode;
    succeeded?: boolean;
    resend?: Partial<EmailConfirmResendProps> | null;
  } = {},
) {
  const resend: EmailConfirmResendProps | undefined =
    overrides.resend === null
      ? undefined
      : {
          nonce: 0,
          onResend: vi.fn(),
          captchaSlot: <div data-testid="resend-captcha" />,
          ...overrides.resend,
        };
  return render(
    <EmailConfirmCard
      copy={copy}
      email={overrides.email ?? "doc@example.com"}
      destination={overrides.destination ?? "d•••@e•••.com"}
      resolver={passthrough<EmailConfirmValues>()}
      onSubmit={overrides.onSubmit ?? vi.fn()}
      error={overrides.error}
      succeeded={overrides.succeeded ?? false}
      links={{ login: "/login", reset: "/reset" }}
      resend={resend}
    />,
  );
}

afterEach(cleanup);

describe("<EmailConfirmCard>", () => {
  it("renders every visible string from the copy prop, with the title as the page h1", () => {
    setup();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "copy.title",
    );
    expect(
      screen.getByText("copy.description:d•••@e•••.com"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("verify-submit")).toHaveTextContent(
      "copy.submit",
    );
    expect(screen.getByText("copy.existingAccountHint")).toBeInTheDocument();
    // No product copy leaks out of the package: nothing rendered is outside the prop.
    expect(document.body.textContent).not.toMatch(/[А-Яа-я]/);
  });

  it("hands the carried address plus the typed code to the host handler", async () => {
    const onSubmit = vi.fn();
    setup({ onSubmit });

    await act(async () => {
      fireEvent.click(screen.getByTestId("verify-submit"));
    });

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ email: "doc@example.com" }),
      expect.anything(),
    );
  });

  // Presentation only: the row appears when the HOST says the server accepted the
  // code, never optimistically from a submit.
  it("shows the success row only when the host reports a server-confirmed acceptance", () => {
    const { rerender } = setup();
    expect(screen.queryByTestId("verify-succeeded")).not.toBeInTheDocument();

    rerender(
      <EmailConfirmCard
        copy={copy}
        email="doc@example.com"
        destination="d•••@e•••.com"
        resolver={passthrough<EmailConfirmValues>()}
        onSubmit={vi.fn()}
        succeeded
        links={{ login: "/login", reset: "/reset" }}
      />,
    );
    expect(screen.getByTestId("verify-succeeded")).toHaveTextContent(
      "copy.codeAccepted",
    );
  });

  it("renders no error of its own — the host's already-localized string is what shows", () => {
    setup({ error: "host-error" });

    expect(screen.getByText("host-error")).toBeInTheDocument();
  });

  // EARS-16: the surface never branches on account existence, so the
  // already-registered owner's two actions are always present and co-equal.
  it("always offers the two already-registered actions at the host's targets", () => {
    setup();

    expect(screen.getByTestId("verify-go-to-login")).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByTestId("verify-go-to-reset")).toHaveAttribute(
      "href",
      "/reset",
    );
  });

  it("disables resend while the cooldown runs, then re-enables it and calls the host", () => {
    vi.useFakeTimers();
    try {
      const onResend = vi.fn();
      setup({ resend: { onResend } });

      const resend = screen.getByTestId("verify-resend");
      expect(resend).toBeDisabled();
      expect(resend).toHaveTextContent("copy.resendIn:30");

      act(() => vi.advanceTimersByTime(30_000));

      expect(resend).not.toBeDisabled();
      expect(resend).toHaveTextContent("copy.resend");
      fireEvent.click(resend);
      expect(onResend).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the host's resend error and the #326 neutral acknowledgement in their own slots", () => {
    setup({ resend: { error: "host-resend-error", notice: "host-notice" } });

    expect(screen.getByText("host-resend-error")).toBeInTheDocument();
    expect(screen.getByTestId("resend-captcha")).toBeInTheDocument();
    const notice = screen.getByTestId("verify-resend-notice");
    expect(notice).toHaveTextContent("host-notice");
    // A success ack, never an error surface (#326).
    expect(notice).toHaveAttribute("role", "status");
  });

  // A bare deep-link has no destination to resend to, so the host omits the whole
  // group rather than letting the control fire an empty request.
  it("hides the resend control entirely when the host omits the resend wiring", () => {
    setup({ email: undefined, resend: null });

    expect(screen.queryByTestId("verify-resend")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("verify-resend-notice"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("verify-submit")).toBeInTheDocument();
  });
});
