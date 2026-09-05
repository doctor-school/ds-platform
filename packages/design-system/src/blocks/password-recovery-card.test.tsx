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
  PasswordRecoveryCard,
  type PasswordRecoveryCardCopy,
  type PasswordRecoveryCompleteValues,
  type PasswordRecoveryRequestValues,
  type PasswordRecoveryStage,
} from "./password-recovery-card";

/**
 * `<PasswordRecoveryCard>` (#1666 slice B) — the shared password-recovery
 * composition. These assertions cover the BLOCK's contract only: copy-as-props, the
 * host-controlled stage, both forms' handler payloads, the error/notice slots and
 * the #267 resend cooldown. The portal's EARS-numbered behavioural oracle
 * (transport, EARS-16 mapping, routing) stays at app level in
 * `apps/portal/app/reset/page.test.tsx`.
 */

/** Neutral, product-free copy — every rendered string must come from here. */
const copy: PasswordRecoveryCardCopy = {
  title: "copy.title",
  titleComplete: "copy.titleComplete",
  descriptionRequest: "copy.descriptionRequest",
  descriptionComplete: (destination) =>
    `copy.descriptionComplete:${destination}`,
  backToSignIn: "copy.backToSignIn",
  request: {
    identifierLabel: "copy.request.identifierLabel",
    identifierPlaceholder: "copy.request.identifierPlaceholder",
    submit: "copy.request.submit",
  },
  complete: {
    codeLabel: "copy.complete.codeLabel",
    newPasswordLabel: "copy.complete.newPasswordLabel",
    passwordPolicyHint: "copy.complete.passwordPolicyHint",
    submit: "copy.complete.submit",
    startOver: "copy.complete.startOver",
    resend: "copy.complete.resend",
    resendCountdown: (seconds) => `copy.complete.resendIn:${seconds}`,
  },
};

/** Permissive resolver — the HOST owns validation, so the block just forwards values. */
const passthrough =
  <T extends FieldValues>(): Resolver<T> =>
  async (values) => ({ values, errors: {} });

function setup(
  overrides: {
    stage?: PasswordRecoveryStage;
    identifier?: string;
    onRequest?: (values: PasswordRecoveryRequestValues) => void;
    onComplete?: (
      values: PasswordRecoveryCompleteValues,
    ) => Promise<void> | void;
    onResend?: () => void;
    onRestart?: () => void;
    requestError?: React.ReactNode;
    completeError?: React.ReactNode;
    resendError?: React.ReactNode;
    notice?: React.ReactNode;
    resendNonce?: number;
  } = {},
) {
  return render(
    <PasswordRecoveryCard
      copy={copy}
      stage={overrides.stage ?? "request"}
      identifier={overrides.identifier ?? ""}
      links={{ login: "/login" }}
      request={{
        resolver: passthrough<PasswordRecoveryRequestValues>(),
        onSubmit: overrides.onRequest ?? vi.fn(),
        error: overrides.requestError,
        captchaSlot: <div data-testid="request-captcha" />,
      }}
      complete={{
        resolver: passthrough<PasswordRecoveryCompleteValues>(),
        onSubmit: overrides.onComplete ?? vi.fn(),
        error: overrides.completeError,
        resendError: overrides.resendError,
        resendNonce: overrides.resendNonce ?? 0,
        onResend: overrides.onResend ?? vi.fn(),
        onRestart: overrides.onRestart ?? vi.fn(),
        notice: overrides.notice,
        captchaSlot: <div data-testid="resend-captcha" />,
      }}
    />,
  );
}

afterEach(cleanup);

describe("<PasswordRecoveryCard>", () => {
  it("renders every visible string from the copy prop, with the title as the page h1", () => {
    setup();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "copy.title",
    );
    expect(screen.getByText("copy.descriptionRequest")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "copy.backToSignIn" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.getByTestId("reset-request-submit")).toHaveTextContent(
      "copy.request.submit",
    );
    expect(screen.getByTestId("request-captcha")).toBeInTheDocument();
    // No product copy leaks out of the package: nothing rendered is outside the prop.
    expect(document.body.textContent).not.toMatch(/[А-Яа-я]/);
  });

  it("hands the request identifier to the host handler and surfaces the host's error", async () => {
    const onRequest = vi.fn();
    setup({ onRequest, requestError: "host-request-error" });

    fireEvent.change(screen.getByLabelText("copy.request.identifierLabel"), {
      target: { value: "doc@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-request-submit"));
    });

    // RHF forwards the submit event as a second argument; the block adds nothing.
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: "doc@example.com" }),
      expect.anything(),
    );
    expect(screen.getByText("host-request-error")).toBeInTheDocument();
  });

  // The stage is host-controlled — it flips only once the host's protected request
  // actually succeeded, exactly as `<LoginCard>`'s `sentIdentifier` does.
  it("shows the complete step with the masked destination once the host flips the stage", () => {
    setup({ stage: "complete", identifier: "doc@example.com" });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "copy.titleComplete",
    );
    expect(
      screen.getByText("copy.descriptionComplete:d•••@e•••.com"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("reset-request-submit"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("copy.complete.newPasswordLabel"),
    ).toBeInTheDocument();
  });

  it("submits the completion with the held identifier and surfaces the completion error", async () => {
    const onComplete = vi.fn();
    setup({
      stage: "complete",
      identifier: "doc@example.com",
      onComplete,
      completeError: "host-complete-error",
    });

    fireEvent.change(screen.getByLabelText("copy.complete.newPasswordLabel"), {
      target: { value: "Sup3r$ecretPw!9" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "copy.complete.submit" }),
      );
    });

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "doc@example.com",
        newPassword: "Sup3r$ecretPw!9",
      }),
    );
    expect(screen.getByText("host-complete-error")).toBeInTheDocument();
  });

  it("calls the host's «start over» — returning to the request step is the host's move", () => {
    const onRestart = vi.fn();
    setup({ stage: "complete", identifier: "doc@example.com", onRestart });

    fireEvent.click(screen.getByTestId("reset-restart"));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("disables resend while the cooldown runs, then re-enables it and calls the host", () => {
    vi.useFakeTimers();
    try {
      const onResend = vi.fn();
      setup({ stage: "complete", identifier: "doc@example.com", onResend });

      const resend = screen.getByTestId("reset-resend");
      expect(resend).toBeDisabled();
      expect(resend).toHaveTextContent("copy.complete.resendIn:30");

      act(() => vi.advanceTimersByTime(30_000));

      expect(resend).not.toBeDisabled();
      expect(resend).toHaveTextContent("copy.complete.resend");
      fireEvent.click(resend);
      expect(onResend).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the host's resend error and the #326 neutral acknowledgement in their own slots", () => {
    setup({
      stage: "complete",
      identifier: "doc@example.com",
      resendError: "host-resend-error",
      notice: "host-notice",
    });

    expect(screen.getByText("host-resend-error")).toBeInTheDocument();
    expect(screen.getByTestId("resend-captcha")).toBeInTheDocument();
    const notice = screen.getByTestId("reset-resend-notice");
    expect(notice).toHaveTextContent("host-notice");
    // A success ack, never an error surface (#326).
    expect(notice).toHaveAttribute("role", "status");
  });
});
