// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

import { RegistrationScreen } from "@/components/registration-screen";

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3rSecret!";
const CODE = "PVDC3R";

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
  clearPendingRegistration();
});

afterEach(() => {
  cleanup();
  clearPendingRegistration();
});

function renderScreen() {
  return render(
    <RegistrationScreen landing="/events" consentTiers={CONSENT_TIERS} />,
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

describe("021 EARS-15 (#1996): the doctor is signed in after email confirmation", () => {
  it("021 EARS-15: when the confirm succeeds and a password is held, system shall replay the login before the success state", async () => {
    const user = userEvent.setup();
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
    // rendered before the replay would send a guest to the event page.
    expect(h.calls).toEqual(["register", "confirm", "login"]);
    // EARS-10 — the success state REPLACES the code screen.
    await waitFor(() =>
      expect(screen.queryByLabelText(/Код из письма/)).toBeNull(),
    );
    // The take is single-shot: the credential is gone the moment it is
    // replayed, so nothing survives the journey to be replayed a second time.
    expect(takePendingRegistration(EMAIL)).toBeNull();
  });

  it("021 EARS-15.2: with no held password the confirm still succeeds and NO login is replayed", async () => {
    const user = userEvent.setup();
    renderScreen();

    await submitRegistration(user);
    // The reload case (003 EARS-39 no-dead-end) reproduced at the seam that
    // actually loses the credential: the module slot is emptied between the
    // register submit and the code. The doctor host renders both steps in ONE
    // component with no route change, so a real reload lands on the empty
    // register form and the doctor re-registers (003 EARS-16 answers
    // identically) — either way the confirmation itself is never blocked.
    clearPendingRegistration();
    await submitCode(user);

    await waitFor(() => expect(h.confirmDoctorEmail).toHaveBeenCalledTimes(1));
    expect(h.login).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["register", "confirm"]);
  });

  it("021 EARS-15.3: a replay that throws is not a failed confirmation — the success state still renders", async () => {
    h.login.mockRejectedValue(new Error("login unavailable"));
    const user = userEvent.setup();
    renderScreen();

    await submitRegistration(user);
    await submitCode(user);

    await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
    // The email IS verified, so the screen states that fact; the doctor is a
    // verified guest who signs in from the header, which is the honest outcome.
    await waitFor(() =>
      expect(screen.queryByLabelText(/Код из письма/)).toBeNull(),
    );
    expect(screen.queryByText("Код не подошёл. Попробуйте ещё раз.")).toBeNull();
    // The other half of the clause: the slot is wiped whether the replay
    // succeeded or threw — the take consumes, it does not roll back on error.
    expect(takePendingRegistration(EMAIL)).toBeNull();
  });

  it("021 EARS-15.4: the password is held only AFTER registerDoctor succeeded", async () => {
    h.registerDoctor.mockRejectedValue(new Error("rejected"));
    const user = userEvent.setup();
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
    const user = userEvent.setup();
    renderScreen();

    await fillRegisterForm(user);
    await user.click(screen.getByTestId("register-submit"));

    await waitFor(() => expect(h.registerDoctor).toHaveBeenCalledTimes(1));
    // The clear runs BEFORE the command, so the failure cannot preserve the
    // stale password — the same top-of-submit invariant the Academy runs.
    expect(takePendingRegistration(EMAIL)).toBeNull();
  });
});
