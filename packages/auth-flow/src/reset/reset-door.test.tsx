// @vitest-environment jsdom
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ONE password-recovery flow (#2027 PR 1.8, tech spec §2.7 rows 78–85) —
 * both storefronts mount `<ResetRoute>`, which renders THIS door; the route's
 * own server decisions are pinned by `reset-route.test.tsx`.
 *
 * The ids arrive from the retired `apps/portal/app/reset/page.test.tsx` and
 * `apps/doctor/components/reset-screen.test.tsx`: the behaviour is no longer a
 * host composition but this package unit, so every case runs on BOTH host
 * fixtures — the doctor host gains the cases only the Academy pinned (the
 * challenge, the reveal toggle, the pending affordances) and the reverse.
 *
 * Mocked seams: the BFF factory (`createAuthClient`), the router (the observable
 * outcome), the 005 EARS-2 completion command at its transport entry, and the
 * challenge widget (it needs a site key and a network).
 */
type CaptchaProps = {
  requestKey: number | null;
  onToken: (token?: string) => void;
};

const h = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  completePasswordReset: vi.fn(),
  registerForEvent: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  captchaMode: "bypass" as "bypass" | "manual",
  captchaProps: undefined as CaptchaProps | undefined,
}));

// STABLE router object: a fresh object per render refires effects in a loop.
const router = { push: h.push, replace: h.replace, refresh: h.refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// `next/link` wants the App-Router context this tier does not mount; the anchor
// it renders is what these assertions are about, so a passthrough is honest.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({
    requestPasswordReset: (...args: unknown[]) =>
      h.requestPasswordReset(...args),
    completePasswordReset: (...args: unknown[]) =>
      h.completePasswordReset(...args),
  }),
}));

vi.mock("@ds/events-storefront/client", () => ({
  registerForEvent: (...args: unknown[]) => h.registerForEvent(...args),
  RegistrationError: class extends Error {},
}));

vi.mock("@ds/design-system/blocks", async () => {
  const React = await import("react");
  const actual = await vi.importActual<
    typeof import("@ds/design-system/blocks")
  >("@ds/design-system/blocks");
  return {
    ...actual,
    BotProtectionField: (props: CaptchaProps) => {
      h.captchaProps = props;
      React.useEffect(() => {
        if (h.captchaMode === "bypass" && props.requestKey !== null) {
          props.onToken(undefined);
        }
      }, [props.onToken, props.requestKey]);
      return <div data-testid="bot-protection-field" />;
    },
  };
});

import { AuthError } from "../client/auth-client";
import { resolveAuthFlowCopy } from "../copy";
import type { AuthFlowHostConfig } from "../host-config";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { ResetDoor } from "./reset-door";

const IDENTIFIER = "doctor@clinic.ru";
const RESET_CODE = "PVDC3R";
const NEW_PASSWORD = "Sup3r$ecretPw!9";

beforeEach(() => {
  h.requestPasswordReset.mockReset().mockResolvedValue({});
  h.completePasswordReset.mockReset().mockResolvedValue({});
  h.registerForEvent.mockReset().mockResolvedValue({ registered: true });
  h.push.mockReset();
  h.replace.mockReset();
  h.refresh.mockReset();
  h.captchaMode = "bypass";
  h.captchaProps = undefined;
});
afterEach(cleanup);

/** The HTML a subtree renders to — the assertion is about markup, not interaction. */
function renderToStaticMarkup(node: ReactNode): string {
  const { container } = render(<>{node}</>);
  const html = container.innerHTML;
  cleanup();
  return html;
}

/** The request form settles one microtask in. */
async function flushMount() {
  await act(async () => {
    await Promise.resolve();
  });
}

const HOSTS: ReadonlyArray<[string, AuthFlowHostConfig]> = [
  ["Academy", ACADEMY_FIXTURE],
  ["doctor storefront", DOCTOR_FIXTURE],
];

describe.each(HOSTS)("the ONE recovery flow on the %s host", (_, config) => {
  const copy = resolveAuthFlowCopy(config).reset;
  const errors = resolveAuthFlowCopy(config).errors;
  const fields = resolveAuthFlowCopy(config).fields;

  function mount(
    props: Partial<{
      loginHref: string;
      landing: string;
      returnTarget: string | null;
    }> = {},
  ) {
    return render(
      <ResetDoor
        config={config}
        loginHref={props.loginHref ?? config.routes.login}
        landing={props.landing ?? config.routes.account}
        returnTarget={props.returnTarget ?? null}
      />,
    );
  }

  /** Fill the identifier and run the EARS-11 initiate step. */
  async function requestCode(identifier = IDENTIFIER) {
    const user = userEvent.setup();
    await screen.findByTestId("reset-request-submit");
    await user.type(screen.getByLabelText(copy.identifierLabel), identifier);
    await user.click(screen.getByTestId("reset-request-submit"));
    await waitFor(() =>
      expect(screen.getByLabelText(copy.codeLabel)).toBeTruthy(),
    );
    return user;
  }

  /** Fill and submit the complete step (code + new password). */
  async function completeReset(
    user: ReturnType<typeof userEvent.setup>,
    password = NEW_PASSWORD,
  ) {
    const codeInput = screen.getByLabelText(copy.codeLabel);
    await user.click(codeInput);
    await user.keyboard(RESET_CODE);
    await waitFor(() => expect(codeInput).toHaveValue(RESET_CODE));
    await user.type(screen.getByLabelText(copy.newPasswordLabel), password);
    await user.click(screen.getByRole("button", { name: copy.completeSubmit }));
  }

  describe("rows 78–80: the first paint, the initiate, no existence disclosed", () => {
    it("003 EARS-11: the first paint is the SHARED PasswordRecoveryCard in the package RU copy, back to THIS host sign-in", () => {
      const html = renderToStaticMarkup(
        <ResetDoor
          config={config}
          loginHref={config.routes.login}
          landing={config.routes.account}
        />,
      );

      // The block's own testid — proof the card is projected, not re-built.
      expect(html).toContain('data-testid="reset-request-submit"');
      expect(html).toContain(copy.title);
      expect(html).toContain(copy.description);
      expect(html).toContain(copy.identifierLabel);
      expect(html).toContain(`href="${config.routes.login}"`);
      // The #1933/#1958 crossing is gone: recovery ends at this host's door.
      expect(html).not.toContain("academy.doctor.school");
    });

    it("003 EARS-11: the initiate step POSTs the typed identifier through the host BFF client", async () => {
      mount();
      await requestCode();

      // Row 18: the captcha token is the client's SECOND argument, never a body
      // field; the bypassed challenge in this tier mints none.
      expect(h.requestPasswordReset).toHaveBeenCalledWith(
        { identifier: IDENTIFIER },
        undefined,
      );
    });

    it("EARS-17: the initial reset request waits for a fresh challenge token", async () => {
      h.captchaMode = "manual";
      const user = userEvent.setup();
      mount();
      await screen.findByTestId("reset-request-submit");
      await user.type(screen.getByLabelText(copy.identifierLabel), IDENTIFIER);
      await user.click(screen.getByTestId("reset-request-submit"));

      expect(h.requestPasswordReset).not.toHaveBeenCalled();
      await waitFor(() => expect(h.captchaProps?.requestKey).not.toBeNull());
      act(() => h.captchaProps?.onToken("fresh-reset-token"));
      await waitFor(() =>
        expect(h.requestPasswordReset).toHaveBeenCalledTimes(1),
      );
      expect(h.requestPasswordReset).toHaveBeenCalledWith(
        expect.anything(),
        "fresh-reset-token",
      );
    });

    it("003 EARS-16: an UNKNOWN identifier reaches the very same code step — the screen discloses no existence", async () => {
      mount();
      await requestCode("nobody@nowhere.example");

      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        copy.completeTitle,
      );
      expect(screen.queryByTestId("reset-request-submit")).toBeNull();
    });

    it("003 EARS-11: a malformed identifier is refused with the package RU sentence before any request", async () => {
      const user = userEvent.setup();
      mount();
      await screen.findByTestId("reset-request-submit");
      await user.type(screen.getByLabelText(copy.identifierLabel), "not-an-id");
      await user.click(screen.getByTestId("reset-request-submit"));

      await waitFor(() =>
        expect(screen.getByText(fields.identifier.invalid)).toBeTruthy(),
      );
      expect(h.requestPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe("row 81: the resend (#267) and its neutral acknowledgement (#326)", () => {
    it("resend is disabled during the cooldown, then re-enables and re-calls the REAL requestPasswordReset", async () => {
      // Fake timers from the start so the cooldown interval is fake from
      // creation; all interaction is `fireEvent` (userEvent hangs under them).
      vi.useFakeTimers();
      try {
        mount();
        await flushMount();
        fireEvent.change(screen.getByLabelText(copy.identifierLabel), {
          target: { value: IDENTIFIER },
        });
        fireEvent.click(screen.getByTestId("reset-request-submit"));
        await act(async () => Promise.resolve());
        expect(h.requestPasswordReset).toHaveBeenCalledTimes(1);

        const resend = screen.getByTestId("reset-resend");
        expect(resend).toBeDisabled();
        act(() => vi.advanceTimersByTime(30_000));
        expect(resend).not.toBeDisabled();

        fireEvent.click(resend);
        await act(async () => Promise.resolve());
        expect(h.requestPasswordReset).toHaveBeenCalledTimes(2);
        expect(h.requestPasswordReset).toHaveBeenLastCalledWith(
          { identifier: IDENTIFIER },
          undefined,
        );
        // The cooldown restarts on the successful resend.
        expect(resend).toBeDisabled();
        // #326: a polite status, not a destructive error.
        const notice = screen.getByTestId("reset-resend-notice");
        expect(notice).toHaveAttribute("role", "status");
      } finally {
        vi.useRealTimers();
      }
    });

    it("EARS-17: reset-code resend uses a new challenge while reset completion stays challenge-free", async () => {
      vi.useFakeTimers();
      try {
        mount();
        await flushMount();
        fireEvent.change(screen.getByLabelText(copy.identifierLabel), {
          target: { value: IDENTIFIER },
        });
        fireEvent.click(screen.getByTestId("reset-request-submit"));
        await act(async () => Promise.resolve());
        expect(h.requestPasswordReset).toHaveBeenCalledTimes(1);

        h.captchaMode = "manual";
        act(() => vi.advanceTimersByTime(30_000));
        fireEvent.click(screen.getByTestId("reset-resend"));
        expect(h.requestPasswordReset).toHaveBeenCalledTimes(1);
        expect(h.captchaProps?.requestKey).not.toBeNull();
        act(() => h.captchaProps?.onToken("fresh-reset-resend-token"));
        await act(async () => Promise.resolve());
        expect(h.requestPasswordReset).toHaveBeenCalledTimes(2);
        expect(h.requestPasswordReset).toHaveBeenLastCalledWith(
          expect.anything(),
          "fresh-reset-resend-token",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("#326: the resend confirmation is the SAME regardless of the identifier (no existence branch)", async () => {
      async function noticeTextFor(idValue: string): Promise<string> {
        vi.useFakeTimers();
        try {
          mount();
          await flushMount();
          fireEvent.change(screen.getByLabelText(copy.identifierLabel), {
            target: { value: idValue },
          });
          fireEvent.click(screen.getByTestId("reset-request-submit"));
          await act(async () => Promise.resolve());
          act(() => vi.advanceTimersByTime(30_000));
          fireEvent.click(screen.getByTestId("reset-resend"));
          await act(async () => Promise.resolve());
          const text =
            screen.getByTestId("reset-resend-notice").textContent ?? "";
          cleanup();
          return text;
        } finally {
          vi.useRealTimers();
        }
      }

      const first = await noticeTextFor("registered@example.com");
      const second = await noticeTextFor("rarely-seen@example.com");
      // Masked the same way for two addresses of one shape, and phrased
      // conditionally — never «we found you».
      expect(first).toBe(second);
      expect(first).toBe(
        copy.resendAcknowledged.replace("{destination}", "r•••@e•••.com"),
      );
    });
  });

  describe("rows 82–83: completion with the held identifier, the reveal toggle, the landing", () => {
    it("EARS-17: ingests the code after the toggle and completes reset challenge-free", async () => {
      mount();
      const user = await requestCode();
      h.captchaMode = "manual";

      await completeReset(user);

      await waitFor(() =>
        expect(h.completePasswordReset).toHaveBeenCalledTimes(1),
      );
      // The code typed into the late-mounted field reaches the body, with the
      // HELD identifier (the #212/#211 detachment dropped it to "").
      expect(h.completePasswordReset).toHaveBeenCalledWith({
        identifier: IDENTIFIER,
        code: RESET_CODE,
        newPassword: NEW_PASSWORD,
      });
      expect(h.captchaProps?.requestKey).toBeNull();
    });

    it("003 EARS-38: the new-password field carries the shared reveal toggle", async () => {
      mount();
      const user = await requestCode();
      const password = screen.getByLabelText(copy.newPasswordLabel);
      expect(password).toHaveAttribute("type", "password");

      await user.click(
        screen.getByRole("button", { name: copy.reveal.showAria }),
      );
      expect(password).toHaveAttribute("type", "text");

      await user.click(
        screen.getByRole("button", { name: copy.reveal.hideAria }),
      );
      expect(password).toHaveAttribute("type", "password");
    });

    it("EARS-12: when the reset completes, the page routes to /account (auto-login), not /login", async () => {
      mount();
      const user = await requestCode();
      await completeReset(user);

      await waitFor(() =>
        expect(h.push).toHaveBeenCalledWith(config.routes.account),
      );
      expect(h.push).not.toHaveBeenCalledWith(config.routes.login);
    });

    it("008 EARS-5 (#2281): the auto-login refreshes the router after the landing push, so Back re-reads the header", async () => {
      mount();
      const user = await requestCode();
      await completeReset(user);

      await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
      expect(h.push.mock.invocationCallOrder[0]!).toBeLessThan(
        h.refresh.mock.invocationCallOrder[0]!,
      );
    });

    it("#2027 S4: a completed reset lands on the carried page through the shared rule, not the fixed cabinet", async () => {
      mount({
        landing: "/account/events",
        returnTarget: "/account/events",
      });
      const user = await requestCode();
      await completeReset(user);

      await waitFor(() =>
        expect(h.push).toHaveBeenCalledWith("/account/events"),
      );
      expect(h.push).not.toHaveBeenCalledWith(config.routes.account);
    });

    it("#2027 S4: an эфир arrival is COMPLETED (005 EARS-2) before the visitor lands on it", async () => {
      const eventPath = config.routes.eventPathTemplate.replace(
        ":slug",
        "prp-pri-gonartroze",
      );
      mount({ landing: eventPath, returnTarget: eventPath });
      const user = await requestCode();
      await completeReset(user);

      await waitFor(() => expect(h.push).toHaveBeenCalledTimes(1));
      expect(h.registerForEvent).toHaveBeenCalledTimes(1);
      expect(h.push.mock.calls[0]![0]).toContain("prp-pri-gonartroze");
    });

    it("#2027 S3: the «Вернуться ко входу» link carries the arrival target onward into /login", () => {
      const html = renderToStaticMarkup(
        <ResetDoor
          config={config}
          loginHref="/login?returnTo=%2Faccount%2Fevents"
          landing="/account/events"
          returnTarget="/account/events"
        />,
      );

      expect(html).toContain('href="/login?returnTo=%2Faccount%2Fevents"');
      expect(html).toContain(copy.backToSignIn);
    });
  });

  describe("row 84: refusals stay on their step with the package RU sentence", () => {
    it("003 EARS-16: a REFUSED completion shows the package RU sentence and keeps the doctor on the code step", async () => {
      h.completePasswordReset.mockRejectedValue(
        new AuthError(400, "invalid code"),
      );
      mount();
      const user = await requestCode();
      await completeReset(user);

      await waitFor(() =>
        expect(screen.getByText(copy.completeFailed)).toBeTruthy(),
      );
      // The api English never reaches the doctor, and nothing navigated away.
      expect(screen.queryByText("invalid code")).toBeNull();
      expect(h.push).not.toHaveBeenCalled();
    });

    it("003 EARS-11: a refused INITIATE keeps the doctor on the request step with the package RU sentence", async () => {
      h.requestPasswordReset.mockRejectedValue(
        new AuthError(400, "upstream refused"),
      );
      const user = userEvent.setup();
      mount();
      await screen.findByTestId("reset-request-submit");
      await user.type(screen.getByLabelText(copy.identifierLabel), IDENTIFIER);
      await user.click(screen.getByTestId("reset-request-submit"));

      await waitFor(() =>
        expect(screen.getByText(copy.requestFailed)).toBeTruthy(),
      );
      expect(screen.getByTestId("reset-request-submit")).toBeTruthy();
    });

    it("003 EARS-11: an unavailable INITIATE (5xx) renders the shared dictionary sentence", async () => {
      h.requestPasswordReset.mockRejectedValue(
        new AuthError(500, "upstream is down"),
      );
      const user = userEvent.setup();
      mount();
      await screen.findByTestId("reset-request-submit");
      await user.type(screen.getByLabelText(copy.identifierLabel), IDENTIFIER);
      await user.click(screen.getByTestId("reset-request-submit"));

      await waitFor(() =>
        expect(screen.getByText(errors.unavailable)).toBeTruthy(),
      );
      expect(screen.queryByText("upstream is down")).toBeNull();
    });

    it("003 EARS-36: a too-short new password renders the RU length copy and never reaches the BFF", async () => {
      mount();
      const user = await requestCode();
      await completeReset(user, "short");

      // The canvas hint and the refusal are the same length sentence in ONE slot
      // (hint OR error), so the refusal is read off the field's invalid state.
      await waitFor(() =>
        expect(screen.getByLabelText(copy.newPasswordLabel)).toHaveAttribute(
          "aria-invalid",
          "true",
        ),
      );
      expect(screen.getAllByText(fields.password.invalid)).toHaveLength(1);
      expect(h.completePasswordReset).not.toHaveBeenCalled();
    });

    it("003 EARS-36: a class-free 8+ password is accepted — length is the only client rule", async () => {
      mount();
      const user = await requestCode();
      await completeReset(user, "abcdefgh");

      await waitFor(() =>
        expect(h.completePasswordReset).toHaveBeenCalledWith(
          expect.objectContaining({ newPassword: "abcdefgh" }),
        ),
      );
    });
  });

  describe("row 85: «Начать заново»", () => {
    it("«Начать заново» returns to the request step with an empty box, dropping the held identifier", async () => {
      mount();
      const user = await requestCode();
      expect(screen.getByLabelText(copy.newPasswordLabel)).toBeTruthy();

      await user.click(screen.getByTestId("reset-restart"));

      await waitFor(() =>
        expect(screen.getByTestId("reset-request-submit")).toBeTruthy(),
      );
      expect(screen.queryByLabelText(copy.newPasswordLabel)).toBeNull();
      expect(
        (screen.getByLabelText(copy.identifierLabel) as HTMLInputElement).value,
      ).toBe("");

      // A fresh request goes out for the NEW identifier, not the dropped one.
      await user.type(
        screen.getByLabelText(copy.identifierLabel),
        "other@clinic.ru",
      );
      await user.click(screen.getByTestId("reset-request-submit"));
      await waitFor(() =>
        expect(h.requestPasswordReset).toHaveBeenLastCalledWith(
          { identifier: "other@clinic.ru" },
          undefined,
        ),
      );
    });
  });

  describe("#337: submit pending affordances", () => {
    it("shows spinner + aria-busy on the request submit while requestPasswordReset is in flight", async () => {
      const user = userEvent.setup();
      h.requestPasswordReset.mockImplementationOnce(
        () => new Promise(() => {}),
      );
      mount();
      await screen.findByTestId("reset-request-submit");
      await user.type(screen.getByLabelText(copy.identifierLabel), IDENTIFIER);
      const submit = screen.getByTestId("reset-request-submit");
      expect(submit).not.toHaveAttribute("aria-busy");

      await user.click(submit);

      await waitFor(() => {
        expect(h.requestPasswordReset).toHaveBeenCalledTimes(1);
        expect(submit).toHaveAttribute("aria-busy", "true");
      });
      expect(submit.querySelector("svg.animate-spin")).not.toBeNull();
    });

    it("shows spinner + aria-busy on the complete submit while completePasswordReset is in flight", async () => {
      mount();
      const user = await requestCode();
      h.completePasswordReset.mockImplementationOnce(
        () => new Promise(() => {}),
      );
      await completeReset(user);

      const submit = screen.getByRole("button", { name: copy.completeSubmit });
      await waitFor(() => {
        expect(h.completePasswordReset).toHaveBeenCalledTimes(1);
        expect(submit).toHaveAttribute("aria-busy", "true");
      });
      expect(submit.querySelector("svg.animate-spin")).not.toBeNull();
    });
  });
});
