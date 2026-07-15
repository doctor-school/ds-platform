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
// #675: rendering the page mounts the <AuthShell> auth-surface guard, which reads
// `authClient.session()` on mount — default it to the unauthenticated path so the
// surface renders as before (the authed branch lives in components/auth-shell.test.tsx).
const session = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    verify: (body: unknown) => verify(body),
    login: (body: unknown) => login(body),
    resendVerification: (body: unknown) => resendVerification(body),
    session: () => session(),
  },
  AuthError: class extends Error {},
}));

// No held password by default (deep-link path → route to /login after verify);
// the 005 EARS-2 tests below set a held credential to drive the auto-login replay.
let heldRegistration: { identifier: string; password: string } | null = null;
vi.mock("@/lib/pending-registration", () => ({
  takePendingRegistration: () => heldRegistration,
}));

// 005 EARS-2: the post-auth registration resume fires the real EARS-1 command
// through this client — mocked so these tests assert the resume wiring only.
const registerForEvent = vi.fn().mockResolvedValue({ registered: true });
vi.mock("@/lib/registration-client", () => ({
  registerForEvent: (slug: string) => registerForEvent(slug),
}));

const EMAIL = "doc@example.com";
const VERIFY_CODE = "PVDC3R";

beforeEach(() => {
  replace.mockClear();
  push.mockClear();
  verify.mockClear();
  login.mockClear();
  resendVerification.mockClear();
  registerForEvent.mockClear();
  heldRegistration = null;
  searchParams = new URLSearchParams({ email: EMAIL });
  // Reset the URL (incl. any fragment) via replaceState — assigning
  // `window.location.hash` directly schedules a jsdom fragment-navigation timer
  // that outlives the test and trips the #434 orphan-timer guard.
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

/**
 * Wait past the #675 <AuthShell> session-guard (real timers): the guard renders
 * nothing until `session()` resolves (to `null` → anonymous), so gate on a stable
 * verify control before interacting.
 */
async function renderVerify() {
  render(<VerifyPage />);
  await screen.findByTestId("verify-submit");
}

/**
 * Flush the #675 session-guard microtask under FAKE timers (a `findBy*` poll would
 * hang while timers are faked), after which the verify surface is in the DOM.
 */
async function flushAuthGuard() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("/verify dual-affordance + resend (#227/#267)", () => {
  it("keeps BOTH co-equal paths: the code form AND the sign-in / reset actions", async () => {
    await renderVerify();
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
      await flushAuthGuard(); // #675: mount the verify surface past the session-guard.
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
        await flushAuthGuard(); // #675: mount the verify surface past the session-guard.
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

  it("hides resend when there is no email destination to target (bare deep-link)", async () => {
    searchParams = new URLSearchParams();
    await renderVerify();
    expect(screen.queryByTestId("verify-resend")).not.toBeInTheDocument();
    // …but the dual-affordance paths still render.
    expect(screen.getByTestId("verify-submit")).toBeInTheDocument();
    expect(screen.getByTestId("verify-go-to-login")).toBeInTheDocument();
  });

  it("auto-submits the fixed-length code (no manual click) and verifies it (EARS-16 path preserved)", async () => {
    const user = userEvent.setup();
    await renderVerify();

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

  it("#337: shows spinner + aria-busy on the verify submit while the verify call is in flight", async () => {
    // The submit must read as "working", not a static disabled button that looks hung
    // (the #333 Stage-B owner finding). The page drives `Button.loading` from
    // `isSubmitting`, so the submit gains `aria-busy` + the spinner. Hold the verify
    // call pending so the in-flight state is observable.
    const user = userEvent.setup();
    verify.mockImplementationOnce(() => new Promise(() => {}));
    await renderVerify();

    const submit = screen.getByTestId("verify-submit");
    expect(submit).not.toHaveAttribute("aria-busy");

    const codeInput = screen.getByRole("textbox");
    await user.click(codeInput);
    await user.keyboard(VERIFY_CODE);

    await waitFor(() => {
      expect(verify).toHaveBeenCalledTimes(1);
      expect(submit).toHaveAttribute("aria-busy", "true");
    });
    expect(submit.querySelector("svg.animate-spin")).not.toBeNull();
  });
});

/**
 * 005 EARS-2 — the /verify hop of the guest-through-auth round-trip: the guest
 * registered carrying `?returnTo=/webinars/:slug`; once the code is accepted and
 * the auto-login replay establishes the session, the SAME `RegisterForEvent`
 * (EARS-1) fires for the carried event and the doctor lands back on that event
 * page registered — never re-searching, never tapping «Участвовать» again. With
 * no held credential the /login fallback carries the context onward; a hostile
 * returnTo is rejected at the guard (land on /account, register nothing).
 */
describe("005 EARS-2 guest-through-auth completion on /verify", () => {
  async function enterCode() {
    const user = userEvent.setup();
    await renderVerify();
    const codeInput = screen.getByRole("textbox");
    await user.click(codeInput);
    await user.keyboard(VERIFY_CODE);
  }

  it("EARS-2: on verify success with a held credential and a carried event context, the system shall register for that event and land on its page", async () => {
    searchParams = new URLSearchParams({
      email: EMAIL,
      returnTo: "/webinars/ahilles-042",
    });
    heldRegistration = { identifier: EMAIL, password: "Sup3r$ecretPw!9" };
    await enterCode();

    await waitFor(() => {
      // The auto-login replay establishes the session…
      expect(login).toHaveBeenCalledTimes(1);
      // …then the SAME RegisterForEvent fires for the carried slug…
      expect(registerForEvent).toHaveBeenCalledWith("ahilles-042");
      // …and the doctor lands back on the originally chosen event page.
      expect(replace).toHaveBeenCalledWith("/webinars/ahilles-042");
    });
  });

  it("EARS-2: with no held credential, the /login fallback carries the event context onward", async () => {
    searchParams = new URLSearchParams({
      email: EMAIL,
      returnTo: "/webinars/ahilles-042",
    });
    await enterCode();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/login?returnTo=%2Fwebinars%2Fahilles-042",
      ),
    );
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("EARS-2: a cross-origin returnTo is rejected — the auto-login lands on «Мои события» (/account/events), nothing registers", async () => {
    searchParams = new URLSearchParams({
      email: EMAIL,
      returnTo: "//evil.example",
    });
    heldRegistration = { identifier: EMAIL, password: "Sup3r$ecretPw!9" };
    await enterCode();

    // #769 facade re-point — the default post-login landing is «Мои события».
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/account/events"));
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("EARS-2: the co-equal «Войти» action carries the event context onward into /login", async () => {
    searchParams = new URLSearchParams({
      email: EMAIL,
      returnTo: "/webinars/ahilles-042",
    });
    await renderVerify();

    expect(screen.getByTestId("verify-go-to-login")).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fwebinars%2Fahilles-042",
    );
  });
});

/**
 * 003 EARS-24 — the COLD email-button path (#904). The branded verification email's
 * CTA points at `/verify#email=<addr>`: the identifier rides the URL FRAGMENT (never
 * sent to the server → the #869 scanner-prefetch invariant holds), so on a cold open
 * with NO `?email=` query the screen seeds the account from the fragment and the
 * submit works. Previously a cold bare `/verify` left the hidden `email` field empty →
 * Zod-blocked → `handleSubmit` never called `onSubmit` → the submit was a SILENT
 * no-op (the exact dead end the owner hit on live prod, 2026-07-14).
 */
describe("003 EARS-24 cold email-button /verify#email= path (#904)", () => {
  it("seeds the email from the URL fragment when there is no ?email= query, and the code reaches the api", async () => {
    // Cold open: no query identifier, the email rides the fragment (URL-encoded).
    searchParams = new URLSearchParams();
    window.history.replaceState(null, "", "/verify#email=doc%40example.com");
    const user = userEvent.setup();
    await renderVerify();

    const codeInput = screen.getByRole("textbox");
    await user.click(codeInput);
    await user.keyboard(VERIFY_CODE);

    // The fragment-seeded email is submitted with the code — no more silent no-op.
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, code: VERIFY_CODE }),
    );
  });

  it("routes a cold verify (no held password) to /login", async () => {
    searchParams = new URLSearchParams();
    window.history.replaceState(null, "", "/verify#email=doc%40example.com");
    heldRegistration = null; // cold open — no held credential in this fresh tab.
    const user = userEvent.setup();
    await renderVerify();

    const codeInput = screen.getByRole("textbox");
    await user.click(codeInput);
    await user.keyboard(VERIFY_CODE);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(login).not.toHaveBeenCalled();
  });

  it("surfaces a VISIBLE error (never a silent no-op) when a submit is blocked with no identifier", async () => {
    // Truly bare /verify: no query, no fragment → the hidden email field is empty →
    // the submit is Zod-blocked. It MUST show a visible, localized error instead of
    // silently doing nothing (a11y + correctness). i18n is passthrough here, so the
    // catalog KEY is what renders.
    searchParams = new URLSearchParams();
    window.history.replaceState(null, "", "/verify");
    const user = userEvent.setup();
    await renderVerify();

    await user.click(screen.getByTestId("verify-submit"));

    await waitFor(() =>
      expect(screen.getByText("verifyMissingIdentifier")).toBeInTheDocument(),
    );
    // The blocked submit reached NO network — it is surfaced, not fired.
    expect(verify).not.toHaveBeenCalled();
  });
});
