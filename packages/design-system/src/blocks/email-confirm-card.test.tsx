import * as React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldValues, Resolver } from "react-hook-form";

import {
  EmailConfirmCard,
  type EmailConfirmCardCopy,
  type EmailConfirmCardProps,
  type EmailConfirmResendProps,
  type EmailConfirmValues,
} from "./email-confirm-card";

/**
 * `<EmailConfirmCard>` — the post-registration code step (003 EARS-24 amended,
 * EARS-42). These assertions cover the BLOCK's contract only: copy-as-props, the
 * code form's handler payload, the server-confirmed success row, the back
 * control and the #267 resend cooldown. The behavioural oracle (transport, the
 * held registration values, routing) is the `@ds/auth-flow` step's own:
 * `packages/auth-flow/src/verify/verify-door.test.tsx`.
 */

/** Neutral, product-free copy — every rendered string must come from here. */
const copy: EmailConfirmCardCopy = {
  title: "copy.title",
  description: (destination) => `copy.description:${destination}`,
  codeLabel: "copy.codeLabel",
  submit: "copy.submit",
  codeAccepted: "copy.codeAccepted",
  resend: "copy.resend",
  resendCountdown: (seconds) => `copy.resendIn:${seconds}`,
  back: "copy.back",
};

/** Permissive resolver — the HOST owns validation, so the block just forwards values. */
const passthrough =
  <T extends FieldValues>(): Resolver<T> =>
  async (values) => ({ values, errors: {} });

function props(
  overrides: Partial<Omit<EmailConfirmCardProps, "resend">> & {
    resend?: Partial<EmailConfirmResendProps>;
  } = {},
): EmailConfirmCardProps {
  const { resend, ...rest } = overrides;
  return {
    copy,
    email: "doc@example.com",
    destination: "d•••@e•••.com",
    resolver: passthrough<EmailConfirmValues>(),
    onSubmit: vi.fn(),
    onBack: vi.fn(),
    ...rest,
    resend: {
      nonce: 0,
      onResend: vi.fn(),
      captchaSlot: <div data-testid="resend-captcha" />,
      ...resend,
    },
  };
}

function setup(overrides: Parameters<typeof props>[0] = {}) {
  return render(<EmailConfirmCard {...props(overrides)} />);
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
    expect(screen.getByText("copy.codeLabel")).toBeInTheDocument();
    expect(screen.getByTestId("verify-submit")).toHaveTextContent(
      "copy.submit",
    );
    expect(screen.getByTestId("verify-back")).toHaveTextContent("copy.back");
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

    rerender(<EmailConfirmCard {...props({ succeeded: true })} />);
    expect(screen.getByTestId("verify-succeeded")).toHaveTextContent(
      "copy.codeAccepted",
    );
  });

  // #2469 — an accepted code is spent; a second submit would be refused (400)
  // and draw an error under the success row.
  it("003 EARS-3 (#2469): after acceptance no click, Enter or re-typed code submits again", async () => {
    const onSubmit = vi.fn();
    setup({ onSubmit, succeeded: true });

    const submit = screen.getByTestId("verify-submit");
    expect(submit).toBeDisabled();
    await act(async () => {
      fireEvent.click(submit);
      fireEvent.submit(submit.closest("form")!);
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox"));
    await user.keyboard("482913{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders no error of its own — the host's already-localized string is what shows", () => {
    setup({ error: "host-error" });

    expect(screen.getByText("host-error")).toBeInTheDocument();
  });

  // 003 EARS-24 amended / EARS-42: the one code step — no co-equal
  // «already registered» block; the way out is the back control.
  it("003 EARS-42: the step is the one code step — six cells, back control, no already-registered block", async () => {
    const onBack = vi.fn();
    setup({ onBack });

    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "6");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("verify-back"));
    });
    expect(onBack).toHaveBeenCalledTimes(1);
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

  it("renders the host's resend error in the plate and the after-resend notice in its own slot", () => {
    vi.useFakeTimers();
    try {
      setup({ resend: { error: "host-resend-error", notice: "host-notice" } });

      expect(screen.getByText("host-resend-error")).toBeInTheDocument();
      expect(screen.getByTestId("resend-captcha")).toBeInTheDocument();
      const notice = screen.getByTestId("verify-resend-notice");
      expect(notice).toHaveTextContent("host-notice");
      // A success ack, never an error surface (#326).
      expect(notice).toHaveAttribute("role", "status");
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * #2027 — no credential may ride a URL before hydration: a `<form>` with no
 * `method` is a GET, so a native pre-hydration submit would put the code in the
 * URL. Asserted over EVERY form the block renders.
 */
describe("#2027 <EmailConfirmCard> pre-hydration submit", () => {
  it("EARS-4.4: the confirmation form posts — a native submit never puts the one-time code in the URL", () => {
    vi.useFakeTimers();
    try {
      const { container } = setup();
      const forms = container.querySelectorAll("form");
      expect(forms.length).toBeGreaterThan(0);
      for (const form of forms) {
        expect(form.getAttribute("method")).toBe("post");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The block drawn to the canvas «ШАГ КОДА» (`design-source/auth.dc.html` 53-85). */
describe("<EmailConfirmCard> canvas code step", () => {
  it("003 EARS-16: an operation failure is ONE banner above the title, the code and the resend alike", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = setup({ error: "host-error" });

      const banner = screen.getByTestId("verify-error");
      expect(banner).toHaveTextContent("host-error");
      // Canvas 53-56: the plate stands where the eye enters, before the <h1>.
      const heading = screen.getByRole("heading", { level: 1 });
      expect(
        banner.compareDocumentPosition(heading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // The refused resend reads in the SAME plate, not a second one.
      rerender(
        <EmailConfirmCard
          {...props({ resend: { error: "host-resend-error" } })}
        />,
      );
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByTestId("verify-error")).toHaveTextContent(
        "host-resend-error",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("003 EARS-25: the resend link is the canvas's 13px / 800 label, the notice 13px / 1.5", () => {
    vi.useFakeTimers();
    try {
      setup({ resend: { notice: "host-notice" } });

      expect(screen.getByTestId("verify-resend")).toHaveClass(
        "text-caption",
        "font-extrabold",
      );
      expect(screen.getByTestId("verify-resend-notice")).toHaveClass(
        "text-caption",
        "leading-normal",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("#2027: a host may rename the test ids through one map, the shipped ids staying the defaults", () => {
    vi.useFakeTimers();
    try {
      setup({ testIds: { root: "verify-screen", submit: "confirm-submit" } });

      expect(screen.getByTestId("verify-screen")).toBeInTheDocument();
      expect(screen.getByTestId("confirm-submit")).toBeInTheDocument();
      expect(screen.getByTestId("verify-back")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("021 EARS-2 / EARS-3: the return-context plate stands above the card only when supplied, as on the registration door", () => {
    vi.useFakeTimers();
    try {
      render(
        <EmailConfirmCard {...props({ testIds: { returnContext: "plate" } })} />,
      );
      expect(screen.queryByTestId("plate")).toBeNull();

      cleanup();
      render(
        <EmailConfirmCard
          {...props({
            returnContextSlot: <span>back to the webinar</span>,
            testIds: { returnContext: "plate" },
          })}
        />,
      );
      const plate = screen.getByTestId("plate");
      expect(plate).toHaveTextContent("back to the webinar");
      // Above the card: the plate precedes the page title in document order.
      const title = screen.getByRole("heading", { level: 1 });
      expect(
        plate.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
