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

import type { ConsentTier } from "@ds/schemas";
import {
  MARKETING_COMMUNICATIONS_PURPOSE,
  PARTNER_DATA_SHARING_PURPOSE,
} from "@ds/schemas";
import {
  clearPendingRegistration,
  setPendingRegistration,
  takePendingRegistration,
} from "@ds/design-system/blocks";

/**
 * 021 EARS-15 / 003 EARS-39 (#1996) — the doctor storefront is SIGNED IN after
 * it confirms the email.
 *
 * The defect this tier exists to catch: `/v1/storefront/doctor/confirm` verifies
 * the email and mints no session, so before #1996 the doctor landed on the event
 * page as a guest and «Участвовать» asked them to register again. The fix is the
 * Academy's mechanism, not a storefront-local one — the SHARED held-password
 * slot (`@ds/design-system/blocks` → `pending-registration.ts`) replayed through
 * the real 003 EARS-5 login. The slot is therefore NOT mocked here: what these
 * tests assert is the wiring across register → confirm → login, and mocking the
 * unit under the wiring would assert the mock.
 *
 * jsdom, the tier `vitest.config.ts` reserves for client-side BEHAVIOUR (the
 * `@vitest-environment` docblock, as `account-screen.test.tsx` opened): the
 * assertions are about the ORDER of two commands and a state change, which no
 * static-markup render can observe. The visual result of the same journey is
 * driven in a real browser by `e2e/register-return.spec.ts`.
 */

// jsdom has no layout engine, so `document.elementFromPoint` is absent and the
// `input-otp` code field probes it on a timer — the same stub the portal and the
// design-system tiers install in their setup files, inline here because this is
// the doctor app's only OTP-bearing jsdom test.
if (typeof document !== "undefined" && !document.elementFromPoint) {
  (
    document as unknown as { elementFromPoint: () => Element | null }
  ).elementFromPoint = () => null;
}

const h = vi.hoisted(() => ({
  registerDoctor: vi.fn(),
  confirmDoctorEmail: vi.fn(),
  resendVerification: vi.fn(),
  login: vi.fn(),
  registerForEvent: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  calls: [] as string[],
}));

vi.mock("@/lib/storefront-auth-client", () => ({
  registerDoctor: (...args: unknown[]) => {
    h.calls.push("register");
    return h.registerDoctor(...args);
  },
  confirmDoctorEmail: (...args: unknown[]) => {
    h.calls.push("confirm");
    return h.confirmDoctorEmail(...args);
  },
  resendVerification: (...args: unknown[]) => h.resendVerification(...args),
}));

vi.mock("@/lib/auth-client", () => ({
  login: (...args: unknown[]) => {
    h.calls.push("login");
    return h.login(...args);
  },
}));

// The sign-in door the Academy rule routes to is a REAL route on this host
// (#1939), so what is stubbed here is the navigator, not the destination: the
// assertion is «which path was pushed», which is the whole of the no-dead-end
// clause that is observable in jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: h.replace }),
}));

/**
 * 005 EARS-2 (#2005) — the `RegisterForEvent` command the completion-on-return
 * rule fires. The mocked seam is the package's `./client` transport ENTRY, not
 * the barrel: `completeReturnTarget` imports `registerForEvent` from that entry
 * inside the package, so mocking the barrel leaves that import untouched and the
 * command unobserved. The RULE above the mock is the real shared one.
 */
vi.mock("@ds/events-storefront/client", () => ({
  registerForEvent: (...args: unknown[]) => {
    h.calls.push("register-for-event");
    return h.registerForEvent(...args);
  },
  RegistrationError: class extends Error {},
}));

import { RegistrationScreen } from "@/components/registration-screen";

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3rSecret!";
const CODE = "PVDC3R";
/**
 * The doctor-host projection of the arrival's return target (`/events/<slug>`,
 * 021 #1945) — the value the register page hands the screen, and the one the
 * sign-in hop has to carry onward for the round-trip to close.
 */
const RETURN_TARGET = "/events/kardio";

const CONSENT_TIERS: readonly ConsentTier[] = [
  {
    tier: "access-conditions",
    items: [
      {
        purpose: PARTNER_DATA_SHARING_PURPOSE,
        required: true,
        statement: "Согласие на передачу данных партнёру",
        dataComposition: ["ФИО"],
        excluded: ["Телефон"],
      },
    ],
  },
  {
    tier: "marketing",
    items: [
      {
        purpose: MARKETING_COMMUNICATIONS_PURPOSE,
        required: false,
        statement: "Хочу получать письма о новых школах и событиях",
      },
    ],
  },
];

beforeEach(() => {
  h.calls.length = 0;
  h.registerDoctor.mockReset().mockResolvedValue(undefined);
  // The shipped EARS-9/EARS-10 body, verbatim in shape: the success card is
  // built from it, so a loose stub would let the card silently not render.
  h.confirmDoctorEmail.mockReset().mockResolvedValue({
    status: "verified",
    credited: null,
    profileCompletion: null,
    primaryAction: { kind: "return", href: "/events/kardio" },
    secondaryAction: { href: "/account" },
  });
  h.login.mockReset().mockResolvedValue({});
  h.registerForEvent.mockReset().mockResolvedValue(undefined);
  h.push.mockReset();
  h.replace.mockReset();
  clearPendingRegistration();
});

afterEach(() => {
  cleanup();
  clearPendingRegistration();
});

/**
 * `delay: null` is not a speed tweak, it is what makes this tier deterministic.
 * The default `userEvent.setup()` awaits a real `setTimeout` BETWEEN EVERY
 * KEYSTROKE, and one journey here types an email, a password and a six-digit
 * code through the real form — dozens of timer round-trips, each also flushing a
 * React `act()` cycle. On the worktree that fits inside the 5 s default; on the
 * shared CI runner it did not, and `021 EARS-15` timed out at
 * `registration-screen.test.tsx:157` in `core / unit` while asserting nothing
 * about time. With `delay: null` the keystrokes are dispatched synchronously, so
 * the test measures the wiring it is about and not the runner it happens to be
 * on. Raising `testTimeout` would have hidden the same unbounded wait behind a
 * bigger number.
 */
function setupUser() {
  return userEvent.setup({ delay: null });
}

function renderScreen() {
  return render(
    <RegistrationScreen
      landing="/events"
      returnTarget={RETURN_TARGET}
      consentTiers={CONSENT_TIERS}
    />,
  );
}

/** Every access condition the EARS-12 submit precondition requires. */
async function fillRegisterForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("register-email"), EMAIL);
  await user.type(screen.getByTestId("register-password"), PASSWORD);
  for (const box of screen
    .getByTestId("registration-form")
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    if (!box.checked) await user.click(box);
  }
}

/** Drive the real register form to the code step, exactly as a doctor does. */
async function submitRegistration(user: ReturnType<typeof userEvent.setup>) {
  await fillRegisterForm(user);
  await user.click(screen.getByTestId("register-submit"));
  await screen.findByLabelText(/Код из письма/);
}

/**
 * The shared code field submits ITSELF once the last character lands (003
 * EARS-24 — the doctor never presses a button for a code they finished typing),
 * so typing IS the submit; clicking «Подтвердить» on top would send the confirm
 * command twice.
 */
async function submitCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Код из письма/), CODE);
}

describe("005 EARS-2 (#2005): the confirmed doctor is registered to the эфир they came from", () => {
  it("005 EARS-2: after the held-password replay, system shall fire RegisterForEvent for the carried эфир before the success state", async () => {
    let completeRegistration!: () => void;
    h.registerForEvent.mockReturnValue(
      new Promise<void>((resolve) => {
        completeRegistration = resolve;
      }),
    );
    const user = setupUser();
    renderScreen();

    // Credentials are setup for this command-order test: one real change per
    // field still runs RHF validation, without rendering every partial email
    // and password. Keep consent/submit clicks and OTP typing as interactions;
    // the latter exercises the real last-character auto-submit boundary.
    fireEvent.change(screen.getByTestId("register-email"), {
      target: { value: EMAIL },
    });
    fireEvent.change(screen.getByTestId("register-password"), {
      target: { value: PASSWORD },
    });
    for (const box of screen
      .getByTestId("registration-form")
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      if (!box.checked) await user.click(box);
    }
    await user.click(screen.getByTestId("register-submit"));
    await screen.findByLabelText(/Код из письма/);
    await submitCode(user);

    await waitFor(() =>
      expect(h.registerForEvent).toHaveBeenCalledWith("kardio"),
    );
    // Order is the contract, and it is the SAME order the Academy ships: the
    // session must exist before the command (the api answers a guest with a
    // 401), and the success card must not paint before the doctor is actually
    // on the roster — its «вернуться к эфиру» action would otherwise land them
    // on a card still asking them to register.
    expect(h.calls).toEqual([
      "register",
      "confirm",
      "login",
      "register-for-event",
    ]);
    expect(screen.queryByTestId("registration-success-primary")).toBeNull();
    await act(async () => completeRegistration());
    await waitFor(() =>
      expect(screen.getByTestId("registration-success-primary")).toBeTruthy(),
    );
  });

  it("005 EARS-2: a direct arrival carries no эфир — the success state stands and NO registration fires", async () => {
    const user = setupUser();
    render(
      <RegistrationScreen landing="/events" consentTiers={CONSENT_TIERS} />,
    );

    await submitRegistration(user);
    await submitCode(user);

    await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
    expect(h.registerForEvent).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["register", "confirm", "login"]);
  });

  it("005 EARS-2: a refused registration never strands the doctor — the success state still stands", async () => {
    // Best-effort by the shared rule's contract: a transient failure or a gating
    // refusal is not a reason to withhold the outcome of the confirmation the
    // doctor DID complete. The truth about the roster is re-read per viewer on
    // the эфир page itself (005 EARS-4).
    h.registerForEvent.mockRejectedValue(new Error("upstream down"));
    const user = setupUser();
    renderScreen();

    await submitRegistration(user);
    await submitCode(user);

    await waitFor(() =>
      expect(screen.getByTestId("registration-success-primary")).toBeTruthy(),
    );
  });
});

describe("021 EARS-15 (#1996): the doctor is signed in after email confirmation", () => {
  it("021 EARS-15: when the confirm succeeds and a password is held, system shall replay the login before the success state", async () => {
    const user = setupUser();
    renderScreen();

    await submitRegistration(user);
    await submitCode(user);

    await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
    // The real 003 EARS-5 command, with the credential the doctor just chose —
    // the session comes from the login route, never from the confirm route.
    expect(h.login).toHaveBeenCalledWith({
      identifier: EMAIL,
      password: PASSWORD,
    });
    // Order is the contract: confirm first (the code is the thing being
    // proven), login second, and only then the success state — a success card
    // rendered before the replay would send a guest to the event page. The
    // carried эфир is completed on the far side of the replay (005 EARS-2,
    // #2005); it is asserted in its own describe below, and named here so this
    // sequence stays the whole sequence.
    expect(h.calls).toEqual([
      "register",
      "confirm",
      "login",
      "register-for-event",
    ]);
    // EARS-10 — the success state REPLACES the code screen.
    await waitFor(() =>
      expect(screen.queryByLabelText(/Код из письма/)).toBeNull(),
    );
    // The take is single-shot: the credential is gone the moment it is
    // replayed, so nothing survives the journey to be replayed a second time.
    expect(takePendingRegistration(EMAIL)).toBeNull();
  });

  it("021 EARS-15.2: with no held password, system shall route to the sign-in door with the return context instead of a success card", async () => {
    const user = setupUser();
    renderScreen();

    await submitRegistration(user);
    // The credential-loss case (003 EARS-39) reproduced at the seam that
    // actually loses it: the module slot is emptied between the register submit
    // and the code — a reload, a restored tab, or a hold past its TTL.
    clearPendingRegistration();
    await submitCode(user);

    await waitFor(() => expect(h.confirmDoctorEmail).toHaveBeenCalledTimes(1));
    // The Academy rule, whole: no held credential means no session, and a
    // doctor with no session is sent to sign in CARRYING the return context —
    // never handed a success card that would walk them onto the эфир as a guest.
    await waitFor(() =>
      expect(h.push).toHaveBeenCalledWith(
        `/login?returnTo=${encodeURIComponent(RETURN_TARGET)}`,
      ),
    );
    expect(h.login).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["register", "confirm"]);
    // The success state exists ONLY for a doctor who is signed in.
    expect(screen.queryByTestId("registration-success-primary")).toBeNull();
  });

  it("021 EARS-15.3: a replay the login refuses routes to the same sign-in door, with the slot wiped and no success card", async () => {
    // The concrete journey: the doctor re-registered the same email with a
    // SECOND password, 003 EARS-16 answered identically, and the IdP still holds
    // the first one — so the replay is refused with the generic 401 and there is
    // no session, exactly as if nothing had been held.
    h.login.mockRejectedValue(new Error("invalid credentials"));
    const user = setupUser();
    renderScreen();

    await submitRegistration(user);
    await submitCode(user);

    await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(h.push).toHaveBeenCalledWith(
        `/login?returnTo=${encodeURIComponent(RETURN_TARGET)}`,
      ),
    );
    // Not a failed CONFIRMATION — the code was accepted, so the doctor is never
    // told to type it again.
    expect(
      screen.queryByText("Код не подошёл. Попробуйте ещё раз."),
    ).toBeNull();
    expect(screen.queryByTestId("registration-success-primary")).toBeNull();
    // The take consumes; it does not roll back on error.
    expect(takePendingRegistration(EMAIL)).toBeNull();
  });

  it("021 EARS-15.4: the password is held only AFTER registerDoctor succeeded", async () => {
    h.registerDoctor.mockRejectedValue(new Error("rejected"));
    const user = setupUser();
    renderScreen();

    await fillRegisterForm(user);
    await user.click(screen.getByTestId("register-submit"));

    await waitFor(() => expect(h.registerDoctor).toHaveBeenCalledTimes(1));
    // A rejected command leaves NO credential behind for a later confirm to
    // replay: the slot is still empty after the failed submit.
    expect(takePendingRegistration(EMAIL)).toBeNull();
  });

  it("021 EARS-15.4.1: a stale hold from an earlier attempt is dropped at the top of the submit, so a rejected command leaves nothing behind", async () => {
    // A prior attempt in this same tab already parked a credential in the
    // single shared slot (TTL 5 min), exactly as a completed register submit
    // does before the doctor backs out and starts over.
    setPendingRegistration({ identifier: EMAIL, password: "St4le!Pass" });
    h.registerDoctor.mockRejectedValue(new Error("rejected"));
    const user = setupUser();
    renderScreen();

    await fillRegisterForm(user);
    await user.click(screen.getByTestId("register-submit"));

    await waitFor(() => expect(h.registerDoctor).toHaveBeenCalledTimes(1));
    // The clear runs BEFORE the command, so the failure cannot preserve the
    // stale password — the same top-of-submit invariant the Academy runs.
    expect(takePendingRegistration(EMAIL)).toBeNull();
  });
});
