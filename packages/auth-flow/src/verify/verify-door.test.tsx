// @vitest-environment jsdom
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
 * The ONE confirmation step (#2027 PR 1.7, tech spec §2.6 rows 65–77) as the
 * Academy's `/verify` route mounts it: `<VerifyEntry>` seeds the address and
 * hands it to `<VerifyDoor>`, the body the doctor storefront mounts inline too
 * (`register/inline-confirmation.test.tsx` pins that host's exits).
 *
 * The ids arrive from `apps/portal/app/verify/page.test.tsx`: the behaviour is
 * no longer an Academy page composition but this package unit, so the
 * assertions follow the code and run over `ACADEMY_FIXTURE`.
 *
 * Mocked seams: the BFF factory (`createAuthClient`), the router (the observable
 * outcome), the 005 EARS-2 completion command at its transport entry, and the
 * challenge widget (it needs a site key and a network). The held-credential
 * slot is the real one.
 */
type CaptchaProps = {
  requestKey: number | null;
  onToken: (token?: string) => void;
};

const h = vi.hoisted(() => ({
  confirm: vi.fn(),
  login: vi.fn(),
  resendVerification: vi.fn(),
  registerForEvent: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  captchaMode: "bypass" as "bypass" | "manual",
  captchaProps: undefined as CaptchaProps | undefined,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: h.replace, refresh: h.refresh }),
}));

vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({
    confirm: (...args: unknown[]) => h.confirm(...args),
    login: (...args: unknown[]) => h.login(...args),
    resendVerification: (...args: unknown[]) => h.resendVerification(...args),
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

import {
  clearPendingRegistration,
  setPendingRegistration,
} from "@ds/design-system/blocks";

import { AuthError } from "../client/auth-client";
import { resolveAuthFlowCopy } from "../copy";
import { ACADEMY_FIXTURE } from "../test-support/host-config-fixtures";
import { VerifyEntry } from "./verify-entry";

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3r$ecretPw!9";
const CODE = "PVDC3R";
const COPY = resolveAuthFlowCopy(ACADEMY_FIXTURE).verify;

beforeEach(() => {
  h.confirm.mockReset().mockResolvedValue({ status: "verified" });
  h.login.mockReset().mockResolvedValue({});
  h.resendVerification
    .mockReset()
    .mockResolvedValue({ status: "resend_requested" });
  h.registerForEvent.mockReset().mockResolvedValue({ registered: true });
  h.push.mockReset();
  h.replace.mockReset();
  h.refresh.mockReset();
  h.captchaMode = "bypass";
  h.captchaProps = undefined;
  clearPendingRegistration();
  // Reset the URL (incl. any fragment) via replaceState — assigning the hash
  // schedules a jsdom navigation timer that outlives the test.
  window.history.replaceState(null, "", "/");
  // jsdom runs no layout; the `input-otp` field probes the point under the pointer.
  document.elementFromPoint = () => document.body;
});

afterEach(() => {
  cleanup();
  clearPendingRegistration();
  window.history.replaceState(null, "", "/");
});

type Arrival = { email?: string; returnTo?: string };

/** The Academy route's client body, as `VerifyRoute` hands it the arrival. */
function mount(arrival: Arrival = { email: EMAIL }) {
  return render(
    <VerifyEntry
      config={ACADEMY_FIXTURE}
      email={arrival.email}
      landing="/webinars"
      returnTo={arrival.returnTo ?? null}
    />,
  );
}

async function mountSettled(arrival?: Arrival) {
  mount(arrival);
  await screen.findByTestId("verify-submit");
}

/** Drain the mount microtask under FAKE timers (a `findBy*` poll would hang). */
async function flushMount() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** The 6-char code submits itself once the last character lands (003 EARS-24). */
async function enterCode(arrival?: Arrival) {
  const user = userEvent.setup();
  await mountSettled(arrival);
  await user.click(screen.getByRole("textbox"));
  await user.keyboard(CODE);
}

function hold() {
  setPendingRegistration({ identifier: EMAIL, password: PASSWORD });
}

describe("003 /verify dual-affordance + resend (#227/#267)", () => {
  it("003 EARS-17: verification-code confirmation stays challenge-free", async () => {
    h.captchaMode = "manual";
    await enterCode();

    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    expect(h.captchaProps?.requestKey).toBeNull();
  });

  it("003 EARS-17: an enabled resend click executes a fresh challenge and its solve resends exactly once", async () => {
    h.captchaMode = "manual";
    vi.useFakeTimers();
    try {
      mount();
      await flushMount();
      const resend = screen.getByTestId("verify-resend");
      act(() => vi.advanceTimersByTime(30_000));
      fireEvent.click(resend);

      expect(h.resendVerification).not.toHaveBeenCalled();
      expect(h.captchaProps?.requestKey).not.toBeNull();
      act(() => h.captchaProps?.onToken("fresh-verify-resend-token"));
      await act(async () => Promise.resolve());

      expect(h.resendVerification).toHaveBeenCalledTimes(1);
      expect(h.resendVerification).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: EMAIL }),
        "fresh-verify-resend-token",
      );
      act(() => h.captchaProps?.onToken("fresh-verify-resend-token"));
      expect(h.resendVerification).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("verify-resend-notice")).toBeInTheDocument();
      expect(h.captchaProps?.requestKey).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("003 EARS-24: keeps BOTH co-equal paths — the code form AND the sign-in / reset actions", async () => {
    await mountSettled();

    expect(screen.getByTestId("verify-submit")).toBeInTheDocument();
    expect(screen.getByTestId("verify-go-to-login")).toBeInTheDocument();
    expect(screen.getByTestId("verify-go-to-reset")).toBeInTheDocument();
  });

  it("003 EARS-25: resend is disabled during cooldown, re-enables after, hits the dedicated endpoint, and re-arms", async () => {
    vi.useFakeTimers();
    try {
      mount();
      await flushMount();
      const resend = screen.getByTestId("verify-resend");
      expect(resend).toBeDisabled();

      act(() => vi.advanceTimersByTime(30_000));
      expect(resend).not.toBeDisabled();

      fireEvent.click(resend);
      await act(async () => {
        await Promise.resolve();
      });
      expect(h.resendVerification).toHaveBeenCalledTimes(1);
      expect(h.resendVerification).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: EMAIL }),
        undefined,
      );
      expect(h.confirm).not.toHaveBeenCalled();
      expect(resend).toBeDisabled();
      const notice = screen.getByTestId("verify-resend-notice");
      expect(notice).toHaveAttribute("role", "status");
    } finally {
      vi.useRealTimers();
    }
  });

  it("003 EARS-16: the resend acknowledgement is the SAME whatever the address (no existence branch)", async () => {
    async function noticeTextFor(email: string): Promise<string> {
      vi.useFakeTimers();
      try {
        mount({ email });
        await flushMount();
        act(() => vi.advanceTimersByTime(30_000));
        fireEvent.click(screen.getByTestId("verify-resend"));
        await act(async () => {
          await Promise.resolve();
        });
        const text =
          screen.getByTestId("verify-resend-notice").textContent ?? "";
        cleanup();
        return text;
      } finally {
        vi.useRealTimers();
      }
    }

    const first = await noticeTextFor("doc-registered@example.com");
    const second = await noticeTextFor("dan-never-seen@example.com");
    expect(first).toBe(second);
    expect(first).toBe(
      "Если регистрация ещё не подтверждена, мы повторно отправили код на d•••@e•••.com.",
    );
  });

  it("003 EARS-24: hides resend when there is no address to target (bare deep-link)", async () => {
    await mountSettled({});

    expect(screen.queryByTestId("verify-resend")).not.toBeInTheDocument();
    expect(screen.getByTestId("verify-submit")).toBeInTheDocument();
    expect(screen.getByTestId("verify-go-to-login")).toBeInTheDocument();
    expect(
      screen.getByText(COPY.fallbackDestination, { exact: false }),
    ).toBeInTheDocument();
  });

  it("003 EARS-3: auto-submits the fixed-length code (no manual click) and confirms it", async () => {
    await enterCode();

    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    // The Academy's 003 verify command takes the address and the code, nothing else.
    expect(h.confirm).toHaveBeenCalledWith({ email: EMAIL, code: CODE });
  });

  it("003 EARS-3 (#337): shows spinner + aria-busy on the submit while the confirm call is in flight", async () => {
    h.confirm.mockImplementationOnce(() => new Promise(() => {}));
    const user = userEvent.setup();
    await mountSettled();
    const submit = screen.getByTestId("verify-submit");
    expect(submit).not.toHaveAttribute("aria-busy");

    await user.click(screen.getByRole("textbox"));
    await user.keyboard(CODE);

    await waitFor(() => {
      expect(h.confirm).toHaveBeenCalledTimes(1);
      expect(submit).toHaveAttribute("aria-busy", "true");
    });
    expect(submit.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("003 EARS-3: the canvas success banner stands while the replay runs, only after the server accepted", async () => {
    hold();
    h.login.mockImplementationOnce(() => new Promise(() => {}));
    await enterCode();

    expect(await screen.findByTestId("verify-succeeded")).toHaveTextContent(
      COPY.codeAccepted,
    );
  });
});

describe("005 EARS-2 guest-through-auth completion on /verify", () => {
  it("005 EARS-2: on success with a held credential and a carried event context, the system shall register for that event and land on its page", async () => {
    hold();
    await enterCode({ email: EMAIL, returnTo: "/webinars/ahilles-042" });

    await waitFor(() => {
      expect(h.login).toHaveBeenCalledTimes(1);
      expect(h.registerForEvent).toHaveBeenCalledWith("ahilles-042");
      expect(h.replace).toHaveBeenCalledWith("/webinars/ahilles-042");
    });
  });

  it("008 EARS-5 (#2281): the auto-login refreshes the router after the landing replace, so Back re-reads the header", async () => {
    hold();
    await enterCode();

    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.login).toHaveBeenCalledTimes(1);
    expect(h.replace.mock.invocationCallOrder[0]!).toBeLessThan(
      h.refresh.mock.invocationCallOrder[0]!,
    );
  });

  it("005 EARS-2: with no held credential, the /login fallback carries the event context onward", async () => {
    await enterCode({ email: EMAIL, returnTo: "/webinars/ahilles-042" });

    await waitFor(() =>
      expect(h.push).toHaveBeenCalledWith(
        "/login?returnTo=%2Fwebinars%2Fahilles-042",
      ),
    );
    expect(h.registerForEvent).not.toHaveBeenCalled();
  });

  it("005 EARS-2: a cross-origin returnTo is rejected — the auto-login lands on the discovery listing (`/webinars`, 013 EARS-15), nothing registers", async () => {
    hold();
    await enterCode({ email: EMAIL, returnTo: "//evil.example" });

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/webinars"));
    expect(h.registerForEvent).not.toHaveBeenCalled();
  });

  it("005 EARS-2: the co-equal «Войти» action carries the event context onward into /login", async () => {
    await mountSettled({ email: EMAIL, returnTo: "/webinars/ahilles-042" });

    expect(screen.getByTestId("verify-go-to-login")).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fwebinars%2Fahilles-042",
    );
  });

  // #2027 rule S3: both co-equal actions carry the target ALIKE.
  it("#2027 S3: the co-equal «Сбросить пароль» action carries the arrival target onward into /reset", async () => {
    await mountSettled({ email: EMAIL, returnTo: "/webinars/ahilles-042" });

    expect(screen.getByTestId("verify-go-to-reset")).toHaveAttribute(
      "href",
      "/reset?returnTo=%2Fwebinars%2Fahilles-042",
    );
  });
});

describe("003 EARS-24 cold email-button /verify#email= path (#904)", () => {
  it("003 EARS-24: seeds the email from the URL fragment when there is no ?email= query, and the code reaches the api", async () => {
    window.history.replaceState(null, "", "/verify#email=doc%40example.com");
    await enterCode({});

    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    expect(h.confirm).toHaveBeenCalledWith({ email: EMAIL, code: CODE });
  });

  it("003 EARS-24: a host with no deep-link entry never reads the fragment", async () => {
    window.history.replaceState(null, "", "/verify#email=doc%40example.com");
    render(
      <VerifyEntry
        config={{ ...ACADEMY_FIXTURE, verify: { deepLinkEntry: false } }}
        landing="/webinars"
        returnTo={null}
      />,
    );
    await screen.findByTestId("verify-submit");

    expect(screen.queryByTestId("verify-resend")).not.toBeInTheDocument();
  });

  it("003 EARS-39: a cold verify (no held password: reload, restored tab, expired hold) routes to /login", async () => {
    window.history.replaceState(null, "", "/verify#email=doc%40example.com");
    await enterCode({});

    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/login"));
    expect(h.login).not.toHaveBeenCalled();
  });

  it("003 EARS-39: a login replay the IdP refuses keeps the registrant on the verification step with the generic error, no routing", async () => {
    hold();
    h.login.mockRejectedValueOnce(new AuthError(401, "Unauthorized"));
    await enterCode();

    await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(COPY.failed)).toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("verify-succeeded")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("003 EARS-24: surfaces a VISIBLE error (never a silent no-op) when a submit is blocked with no identifier", async () => {
    window.history.replaceState(null, "", "/verify");
    const user = userEvent.setup();
    await mountSettled({});

    await user.click(screen.getByTestId("verify-submit"));

    expect(await screen.findByTestId("verify-error")).toHaveTextContent(
      COPY.missingIdentifier,
    );
    expect(h.confirm).not.toHaveBeenCalled();
  });
});

describe("rows 10-15: one error plate, the shared dictionary", () => {
  it("017 #1933.10: a 429 on the confirm command reads as the rate-limit sentence, never «Код не подошёл»", async () => {
    h.confirm.mockRejectedValue(new AuthError(429, "Too Many Requests"));
    await enterCode();

    expect(await screen.findByTestId("verify-error")).toHaveTextContent(
      resolveAuthFlowCopy(ACADEMY_FIXTURE).errors.tooManyAttempts,
    );
    expect(screen.queryByText(COPY.failed)).toBeNull();
  });
});
