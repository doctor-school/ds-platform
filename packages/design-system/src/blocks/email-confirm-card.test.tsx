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

/**
 * #2027 — no credential may ride a URL before hydration.
 *
 * Every auth `<form>` in this package is submitted by a handler that only exists
 * once the bundle has run. A visitor who presses the button before that submits
 * NATIVELY, and a `<form>` with no `method` is a GET: the password, the
 * identifier and the one-time code go into the query string, the browser
 * history and every access log on the way. `method="post"` moves them into the
 * request body, which is the whole of the fix — the submitted path is unchanged,
 * `action` stays off so the browser uses the current document URL, and the
 * rendered surface is byte-identical, so there is no visual delta to review.
 *
 * Asserted over EVERY form the block renders rather than by test id, so a form
 * added later cannot quietly reintroduce the leak.
 */
describe("#2027 <EmailConfirmCard> pre-hydration submit", () => {
  it("EARS-4.4: the confirmation form posts — a native submit never puts the one-time code in the URL", () => {
    const { container } = setup();
    const forms = container.querySelectorAll("form");
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(form.getAttribute("method")).toBe("post");
    }
  });
});

/**
 * #2027 PR 1.7 — the block drawn to the canvas «Подтверждение» screen
 * (`design-source/auth.dc.html` 53-56, 212-244).
 */
describe("#2027 <EmailConfirmCard> canvas «Подтверждение»", () => {
  it("003 EARS-16: an operation failure is ONE banner above the title, the code and the resend alike", () => {
    const { rerender } = setup({ error: "host-error" });

    const banner = screen.getByTestId("verify-error");
    expect(banner).toHaveTextContent("host-error");
    // Canvas 53-56: the plate stands where the eye enters, before the <h1>.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(
      banner.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // `повтор` — the refused resend reads in the SAME plate, not a second one.
    rerender(
      <EmailConfirmCard
        copy={copy}
        email="doc@example.com"
        destination="d•••@e•••.com"
        resolver={passthrough<EmailConfirmValues>()}
        onSubmit={vi.fn()}
        links={{ login: "/login", reset: "/reset" }}
        resend={{ nonce: 0, onResend: vi.fn(), error: "host-resend-error" }}
      />,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByTestId("verify-error")).toHaveTextContent(
      "host-resend-error",
    );
  });

  it("003 EARS-24: both eyebrows are the auth family's faint 11px/800 label", () => {
    setup();

    for (const name of [
      "copy.newAccountHeading",
      "copy.existingAccountHeading",
    ]) {
      expect(screen.getByRole("heading", { name })).toHaveClass(
        "text-eyebrow",
        "text-faint",
      );
    }
  });

  it("003 EARS-24: the hint and the resend notice are the canvas's small 13px / 1.5 text (canvas 231, 237)", () => {
    setup({ resend: { notice: "host-notice" } });

    expect(screen.getByText("copy.existingAccountHint")).toHaveClass(
      "text-caption",
      "leading-normal",
    );
    expect(screen.getByTestId("verify-resend-notice")).toHaveClass(
      "text-caption",
      "leading-normal",
    );
  });

  it("003 EARS-24: the already-registered actions share a wrapping row (canvas 238-241)", () => {
    setup();

    const row = screen.getByTestId("verify-go-to-login").parentElement;
    expect(row).toHaveClass("flex", "flex-wrap", "gap-3");
    expect(row).not.toHaveClass("flex-col");
  });

  it("#2027: a host may rename the test ids through one map, the shipped ids staying the defaults", () => {
    render(
      <EmailConfirmCard
        copy={copy}
        email="doc@example.com"
        destination="d•••@e•••.com"
        resolver={passthrough<EmailConfirmValues>()}
        onSubmit={vi.fn()}
        links={{ login: "/login", reset: "/reset" }}
        testIds={{ root: "verify-screen", submit: "confirm-submit" }}
      />,
    );

    expect(screen.getByTestId("verify-screen")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-submit")).toBeInTheDocument();
    expect(screen.getByTestId("verify-go-to-login")).toBeInTheDocument();
  });

  it("021 EARS-2 / EARS-3: the return-context plate stands above the card only when supplied, as on the registration door", () => {
    const props = {
      copy,
      email: "doc@example.com",
      destination: "d•••@e•••.com",
      resolver: passthrough<EmailConfirmValues>(),
      onSubmit: vi.fn(),
      links: { login: "/login", reset: "/reset" },
    };
    render(
      <EmailConfirmCard {...props} testIds={{ returnContext: "plate" }} />,
    );
    expect(screen.queryByTestId("plate")).toBeNull();

    cleanup();
    render(
      <EmailConfirmCard
        {...props}
        returnContextSlot={<span>back to the webinar</span>}
        testIds={{ returnContext: "plate" }}
      />,
    );
    const plate = screen.getByTestId("plate");
    expect(plate).toHaveTextContent("back to the webinar");
    // Above the card: the plate precedes the page title in document order.
    const title = screen.getByRole("heading", { level: 1 });
    expect(
      plate.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
