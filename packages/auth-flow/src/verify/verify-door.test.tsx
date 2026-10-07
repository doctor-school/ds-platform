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
 * hands it to `<VerifyDoor>`. The doctor storefront mounts the same step on its
 * own `/verify` (003 EARS-24); `verify-step.test.tsx` runs it over that host.
 *
 * The ids arrive from `apps/portal/app/verify/page.test.tsx`: the behaviour is
 * no longer an Academy page composition but this package unit, so the
 * assertions follow the code and run over `ACADEMY_FIXTURE`.
 *
 * Mocked seams: the BFF factory (`createAuthClient`), the router (the observable
 * outcome), the 005 EARS-2 completion command at its transport entry, and the
 * challenge widget (it needs a site key and a network). The held-registration
 * slot is the real one. `login` stays on the mocked client only so every
 * success path can prove it is never called (003 EARS-41: no replay).
 */
type CaptchaProps = {
  requestKey: number | null;
  onToken: (token?: string) => void;
};

const h = vi.hoisted(() => ({
  verify: vi.fn(),
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
    verify: (...args: unknown[]) => h.verify(...args),
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
  peekPendingRegistration,
  setPendingRegistration,
} from "@ds/design-system/blocks";

import { AuthError } from "../client/auth-client";
import { resolveAuthFlowCopy } from "../copy";
import {
  clearStoredReturnTarget,
  readStoredReturnTarget,
} from "../client/return-target-store";
import { RETURN_TARGET_PARKING } from "../host-config";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { VerifyEntry } from "./verify-entry";

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3r$ecretPw!9";
const CODE = "482913";
const COPY = resolveAuthFlowCopy(ACADEMY_FIXTURE).verify;

beforeEach(() => {
  h.verify.mockReset().mockResolvedValue({ status: "verified" });
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

/**
 * The Academy route's client body, as `VerifyRoute` hands it the arrival. The
 * targets are handed RAW (the route hands guard-reconstructed ones), so every
 * guard below the mount is exercised against the hostile value too.
 */
function mount(arrival: Arrival = { email: EMAIL }) {
  const target = arrival.returnTo ?? null;
  return render(
    <VerifyEntry
      config={ACADEMY_FIXTURE}
      email={arrival.email}
      landing="/webinars"
      returnTo={target}
      returnTarget={target}
      carriedTarget={target}
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

/** The 6-digit code submits itself once the last digit lands (003 EARS-24). */
async function enterCode(arrival?: Arrival) {
  const user = userEvent.setup();
  await mountSettled(arrival);
  await user.click(screen.getByRole("textbox"));
  await user.keyboard(CODE);
}

/** What the Academy register door holds for this step (003 EARS-41). */
const REGISTRATION = {
  password: PASSWORD,
  consent: [{ purpose: "tos", version: "2026-01" }],
};

function hold() {
  setPendingRegistration({
    identifier: EMAIL,
    registration: REGISTRATION,
    form: { email: EMAIL, password: PASSWORD, promoCode: "", consents: {} },
  });
}

describe("003 /verify dual-affordance + resend (#227/#267)", () => {
  it("003 EARS-17: verification-code confirmation stays challenge-free", async () => {
    h.captchaMode = "manual";
    await enterCode();

    await waitFor(() => expect(h.verify).toHaveBeenCalledTimes(1));
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

  it("003 EARS-42: the code step offers the code form and «← Изменить почту» — no co-equal «Войти» / «Сбросить пароль» way out", async () => {
    await mountSettled();

    expect(screen.getByTestId("verify-submit")).toHaveTextContent(COPY.submit);
    expect(screen.getByTestId("verify-back")).toHaveTextContent(COPY.back);
    expect(screen.queryByTestId("verify-go-to-login")).toBeNull();
    expect(screen.queryByTestId("verify-go-to-reset")).toBeNull();
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
      expect(h.verify).not.toHaveBeenCalled();
      expect(resend).toBeDisabled();
      const notice = screen.getByTestId("verify-resend-notice");
      expect(notice).toHaveAttribute("role", "status");
    } finally {
      vi.useRealTimers();
    }
  });

  it("003 EARS-16: the resend acknowledgement is one sentence whatever the address, naming only the typed address (no existence branch)", async () => {
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
    // Canvas 81-83 — one sentence for either address, naming the address
    // exactly as typed (#2607) and nothing about whether it has an account.
    expect(first).toBe("Мы отправили новый код на doc-registered@example.com.");
    expect(second).toBe("Мы отправили новый код на dan-never-seen@example.com.");
  });

  it("003 EARS-3: auto-submits the fixed-length code (no manual click) and confirms it", async () => {
    await enterCode();

    await waitFor(() => expect(h.verify).toHaveBeenCalledTimes(1));
    // The Academy's 003 verify command takes the address and the code, nothing else.
    expect(h.verify).toHaveBeenCalledWith({ email: EMAIL, code: CODE });
  });

  it("003 EARS-3 (#337): shows spinner + aria-busy on the submit while the confirm call is in flight", async () => {
    h.verify.mockImplementationOnce(() => new Promise(() => {}));
    const user = userEvent.setup();
    await mountSettled();
    const submit = screen.getByTestId("verify-submit");
    expect(submit).not.toHaveAttribute("aria-busy");

    await user.click(screen.getByRole("textbox"));
    await user.keyboard(CODE);

    await waitFor(() => {
      expect(h.verify).toHaveBeenCalledTimes(1);
      expect(submit).toHaveAttribute("aria-busy", "true");
    });
    expect(submit.querySelector("svg.animate-spin")).not.toBeNull();
  });

  it("003 EARS-3: the canvas success banner stands while the landing completes, only after the server accepted", async () => {
    hold();
    h.registerForEvent.mockImplementationOnce(() => new Promise(() => {}));
    await enterCode({ email: EMAIL, returnTo: "/webinars/ahilles-042" });

    expect(await screen.findByTestId("verify-succeeded")).toHaveTextContent(
      COPY.codeAccepted,
    );
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("003 EARS-3: a refused code never shows the success banner", async () => {
    h.verify.mockRejectedValue(new AuthError(400, "Bad Request"));
    await enterCode();

    expect(await screen.findByTestId("verify-error")).toHaveTextContent(
      COPY.failed,
    );
    expect(screen.queryByTestId("verify-succeeded")).toBeNull();
  });
});

describe("005 EARS-2 guest-through-auth completion on /verify", () => {
  it("005 EARS-2: on an accepted code with held values and a carried event context, the system shall register for that event and land on its page", async () => {
    hold();
    await enterCode({ email: EMAIL, returnTo: "/webinars/ahilles-042" });

    await waitFor(() => {
      expect(h.registerForEvent).toHaveBeenCalledWith("ahilles-042");
      expect(h.replace).toHaveBeenCalledWith("/webinars/ahilles-042");
    });
    // 003 EARS-41 — the held values went WITH the code; the answer is the
    // session, so nothing is replayed.
    expect(h.verify).toHaveBeenCalledWith({
      email: EMAIL,
      code: CODE,
      registration: REGISTRATION,
    });
    expect(h.login).not.toHaveBeenCalled();
  });

  it("008 EARS-5 (#2281): the confirmed sign-in refreshes the router after the landing replace, so Back re-reads the header", async () => {
    hold();
    await enterCode();

    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.login).not.toHaveBeenCalled();
    expect(h.replace.mock.invocationCallOrder[0]!).toBeLessThan(
      h.refresh.mock.invocationCallOrder[0]!,
    );
  });

  it("005 EARS-2: a cold step (no held values) is signed in by the code alone and still completes the carried event context", async () => {
    await enterCode({ email: EMAIL, returnTo: "/webinars/ahilles-042" });

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/webinars/ahilles-042"),
    );
    expect(h.registerForEvent).toHaveBeenCalledWith("ahilles-042");
    expect(h.verify).toHaveBeenCalledWith({ email: EMAIL, code: CODE });
    expect(h.push).not.toHaveBeenCalled();
    expect(h.login).not.toHaveBeenCalled();
  });

  it("005 EARS-2: a cross-origin returnTo is rejected — the auto-login lands on the discovery listing (`/webinars`, 013 EARS-15), nothing registers", async () => {
    hold();
    await enterCode({ email: EMAIL, returnTo: "//evil.example" });

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/webinars"));
    expect(h.registerForEvent).not.toHaveBeenCalled();
  });

  it("003 EARS-42 / #2027 S3: «← Изменить почту» returns to the registration form, carrying the event context onward", async () => {
    const user = userEvent.setup();
    await mountSettled({ email: EMAIL, returnTo: "/webinars/ahilles-042" });

    await user.click(screen.getByTestId("verify-back"));

    expect(h.push).toHaveBeenCalledWith(
      "/register?returnTo=%2Fwebinars%2Fahilles-042",
    );
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("003 EARS-42 / #2027 S3: a cross-origin carried target is dropped at «← Изменить почту»", async () => {
    const user = userEvent.setup();
    await mountSettled({ email: EMAIL, returnTo: "//evil.example" });

    await user.click(screen.getByTestId("verify-back"));

    expect(h.push).toHaveBeenCalledWith("/register");
  });

  it("003 EARS-42: stepping back keeps the held values, so the form refills from them", async () => {
    hold();
    const user = userEvent.setup();
    await mountSettled();

    await user.click(screen.getByTestId("verify-back"));

    expect(peekPendingRegistration(EMAIL)?.registration).toEqual(REGISTRATION);
  });
});

describe("021 EARS-10 (#2455, owner decision Б): an эфир that no longer exists lands on the default", () => {
  afterEach(() => clearStoredReturnTarget());

  it.each([
    ["Академия", ACADEMY_FIXTURE, "/webinars/gone", "/webinars"],
    ["Витрина", DOCTOR_FIXTURE, "/events/gone", "/events"],
  ])(
    "021 EARS-10: on %s the confirmed doctor lands on the default landing even when the vanished эфир page is parked",
    async (_host, config, gone, landing) => {
      // Both hosts park (014 EARS-6, #2443) the arrival target on `/register`
      // and on `/verify` itself, so the vanished эфир is in the parked cookie
      // when the mount resolves it to no target.
      document.cookie = `${RETURN_TARGET_PARKING.name}=${encodeURIComponent(gone)}; Path=/`;
      hold();
      const user = userEvent.setup();
      render(
        <VerifyEntry
          config={config}
          email={EMAIL}
          landing={landing}
          returnTo={gone}
          returnTarget={null}
          carriedTarget={gone}
        />,
      );
      await screen.findByTestId("verify-submit");
      await user.click(screen.getByRole("textbox"));
      await user.keyboard(CODE);

      await waitFor(() => expect(h.replace).toHaveBeenCalledWith(landing));
      expect(h.replace).toHaveBeenCalledTimes(1);
      expect(h.registerForEvent).not.toHaveBeenCalled();
      // Consumed once (014 EARS-6): a later sign-in never lands on it either.
      expect(readStoredReturnTarget()).toBeNull();
    },
  );
});

describe("003 EARS-41: one submission — the code, with the held values while this tab has them", () => {
  it("003 EARS-41: a cold step (reload, restored tab, expired hold) submits the code alone and lands signed in — never routed to /login", async () => {
    await enterCode({ email: EMAIL });

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/webinars"));
    expect(h.verify).toHaveBeenCalledWith({ email: EMAIL, code: CODE });
    expect(h.push).not.toHaveBeenCalled();
    expect(h.login).not.toHaveBeenCalled();
  });

  it("003 EARS-41: a hold for ANOTHER address is never submitted with this one's code", async () => {
    setPendingRegistration({
      identifier: "someone-else@example.com",
      registration: REGISTRATION,
      form: { email: "someone-else@example.com", password: PASSWORD, promoCode: "", consents: {} },
    });
    await enterCode({ email: EMAIL });

    await waitFor(() => expect(h.verify).toHaveBeenCalledTimes(1));
    expect(h.verify).toHaveBeenCalledWith({ email: EMAIL, code: CODE });
  });

  it("003 EARS-41: an accepted code wipes the held values", async () => {
    hold();
    await enterCode();

    await waitFor(() => expect(h.replace).toHaveBeenCalledTimes(1));
    expect(peekPendingRegistration()).toBeNull();
  });

  it("003 EARS-16 / EARS-41: a refused code keeps the visitor on the step with the generic error and the held values kept for the retry", async () => {
    hold();
    h.verify.mockRejectedValueOnce(new AuthError(400, "Bad Request"));
    await enterCode();

    expect(await screen.findByTestId("verify-error")).toHaveTextContent(
      COPY.failed,
    );
    expect(h.push).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.login).not.toHaveBeenCalled();
    expect(screen.queryByTestId("verify-succeeded")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(peekPendingRegistration(EMAIL)?.registration).toEqual(REGISTRATION);
  });

  it("003 EARS-3 (#2455): the one 003 command carries the address and the code only, even with a carried target", async () => {
    await enterCode({ email: EMAIL, returnTo: "/webinars/ahilles-042" });

    await waitFor(() => expect(h.verify).toHaveBeenCalledTimes(1));
    expect(h.verify).toHaveBeenCalledWith({ email: EMAIL, code: CODE });
  });
});

describe("003 EARS-40: a /verify with no address goes to /register (#2394)", () => {
  it("003 EARS-40: a bare entry (no ?email=, no #email=) replaces onto /register and never shows the step", async () => {
    window.history.replaceState(null, "", "/verify");
    mount({});

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/register"));
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(h.push).not.toHaveBeenCalled();
    expect(screen.queryByTestId("verify-card")).not.toBeInTheDocument();
    expect(screen.queryByText("ваш аккаунт", { exact: false })).toBeNull();
  });

  it("003 EARS-40: a bare entry carries a same-origin returnTo onward to /register", async () => {
    window.history.replaceState(
      null,
      "",
      "/verify?returnTo=%2Fwebinars%2Fahilles-042",
    );
    mount({ returnTo: "/webinars/ahilles-042" });

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith(
        "/register?returnTo=%2Fwebinars%2Fahilles-042",
      ),
    );
    expect(screen.queryByTestId("verify-card")).not.toBeInTheDocument();
  });

  it("003 EARS-40: a cross-origin returnTo is dropped at the hop, never propagated into /register", async () => {
    window.history.replaceState(null, "", "/verify");
    mount({ returnTo: "https://evil.example/phish" });

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/register"));
  });

  it("003 EARS-40: the ?email= seed renders the step with the address as typed and its resend, no redirect", async () => {
    await mountSettled({ email: EMAIL });

    expect(screen.getByTestId("verify-card")).toHaveTextContent(
      `Мы отправили код на ${EMAIL}.`,
    );
    expect(screen.getByTestId("verify-resend")).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("003 EARS-42 (#2607): the address stands bold exactly as typed, and a long one wraps inside the column", async () => {
    const LONG =
      "anna.konstantinova-rozhdestvenskaya.cardiology@regional-clinical-hospital.example.ru";
    await mountSettled({ email: LONG });

    const address = screen.getByText(LONG);
    expect(address.tagName).toBe("STRONG");
    expect(address).toHaveClass("wrap-anywhere");
  });

  it("003 EARS-29 (#2455): the verification mail carries no link, so a URL fragment is never an address — a bare query goes to /register", async () => {
    window.history.replaceState(null, "", "/verify#email=doc%40example.com");
    mount({});

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/register"));
    expect(screen.queryByTestId("verify-card")).not.toBeInTheDocument();
  });
});

describe("rows 10-15: one error plate, the shared dictionary", () => {
  it("017 #1933.10: a 429 on the confirm command reads as the rate-limit sentence, never «Код не подошёл»", async () => {
    h.verify.mockRejectedValue(new AuthError(429, "Too Many Requests"));
    await enterCode();

    expect(await screen.findByTestId("verify-error")).toHaveTextContent(
      resolveAuthFlowCopy(ACADEMY_FIXTURE).errors.tooManyAttempts,
    );
    expect(screen.queryByText(COPY.failed)).toBeNull();
  });

  it("003 EARS-16: a resend withdraws the refused-code sentence, so the plate says the resend's own failure", async () => {
    // Real time keeps flowing for the typing; the 30 s cooldown is skipped by hand.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      h.verify.mockRejectedValue(new AuthError(400, "Bad Request"));
      h.resendVerification.mockRejectedValue(
        new AuthError(429, "Too Many Requests"),
      );
      mount();
      await flushMount();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole("textbox"));
      await user.keyboard(CODE);
      await flushMount();
      expect(screen.getByTestId("verify-error")).toHaveTextContent(COPY.failed);

      act(() => vi.advanceTimersByTime(30_000));
      fireEvent.click(screen.getByTestId("verify-resend"));
      await flushMount();
      await flushMount();

      expect(screen.getByTestId("verify-error")).toHaveTextContent(
        resolveAuthFlowCopy(ACADEMY_FIXTURE).errors.tooManyAttempts,
      );
      expect(screen.queryByText(COPY.failed)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("021 EARS-2: the return-context plate on the confirmation step", () => {
  it("021 EARS-2: draws the plate the registration door drew, above the card, under the register door's test id", async () => {
    render(
      <VerifyEntry
        config={ACADEMY_FIXTURE}
        email={EMAIL}
        landing="/webinars"
        returnTo="/events/e1"
        returnContextPlate={<p>Вы вернётесь к этому эфиру</p>}
      />,
    );
    await screen.findByTestId("verify-submit");

    expect(screen.getByTestId("registration-return-context")).toHaveTextContent(
      "Вы вернётесь к этому эфиру",
    );
  });

  it("021 EARS-3: no plate supplied, no frame rendered", async () => {
    await mountSettled();
    expect(screen.queryByTestId("registration-return-context")).toBeNull();
  });
});
