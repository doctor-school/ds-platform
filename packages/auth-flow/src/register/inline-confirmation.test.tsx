// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The INLINE CONFIRMATION STEP of the shared registration door (#2027 PR 1.6,
 * rows 51 + 76): the step a host with no `/verify` route of its own runs on the
 * door itself.
 *
 * The ids arrive verbatim from `apps/doctor/components/registration-screen.test.tsx`
 * — the behaviour they describe is no longer a doctor-host projection but this
 * package unit, so each one now runs over `DOCTOR_FIXTURE`, the fixture whose
 * `routes.verify` is `undefined` and therefore the one host shape that can reach
 * this panel at all. The form step and the row-51 fork INTO this panel are
 * asserted in `register-door.test.tsx`; everything past the accepted code is
 * here.
 *
 * Mocked seams, and why each is the honest one:
 *   - `../client/auth-client` — the panel builds its client from `config.api`
 *     (`createAuthClient`), so the BFF seam is that factory, never a prop.
 *   - `next/navigation` — the router IS the observable outcome of 021 EARS-10.
 *   - `@ds/events-storefront/client` — the 005 EARS-2 completion command, mocked
 *     at the transport ENTRY the shared rule imports it from; the RULE above the
 *     mock is the real shared one.
 *   - `BotProtectionField` — the real widget needs a site key and a network.
 * The held-credential slot (`pending-registration`) is NOT mocked: what these
 * tests assert is the wiring across confirm → login → completion, and mocking
 * the unit under the wiring would assert the mock.
 */

const h = vi.hoisted(() => ({
  confirm: vi.fn(),
  login: vi.fn(),
  resendVerification: vi.fn(),
  registerForEvent: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  calls: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: h.replace }),
}));

vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({
    confirm: (...args: unknown[]) => {
      h.calls.push("confirm");
      return h.confirm(...args);
    },
    login: (...args: unknown[]) => {
      h.calls.push("login");
      return h.login(...args);
    },
    resendVerification: (...args: unknown[]) => h.resendVerification(...args),
  }),
}));

vi.mock("@ds/events-storefront/client", () => ({
  registerForEvent: (...args: unknown[]) => {
    h.calls.push("register-for-event");
    return h.registerForEvent(...args);
  },
  RegistrationError: class extends Error {},
}));

vi.mock("@ds/design-system/blocks", async () => {
  const React = await import("react");
  const actual = await vi.importActual<
    typeof import("@ds/design-system/blocks")
  >("@ds/design-system/blocks");
  return {
    ...actual,
    BotProtectionField: () => <div data-testid="bot-protection-field" />,
  };
});

import {
  clearPendingRegistration,
  setPendingRegistration,
  takePendingRegistration,
} from "@ds/design-system/blocks";

import { AuthError } from "../client/auth-client";
import { resolveAuthFlowCopy } from "../copy";
import { DOCTOR_FIXTURE } from "../test-support/host-config-fixtures";
import { RegistrationConfirmation } from "./inline-confirmation";

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3rSecret!";
const CODE = "PVDC3R";
/** The doctor-host projection of the arrival's confirm INTENT (021 #1945). */
const RETURN_TARGET = "/events/kardio";
/** Rule S3 — what the ROUTE carries onward, in the canonical vocabulary. */
const CARRIED_TARGET = "/webinars/kardio";

const REGISTER_COPY = resolveAuthFlowCopy(DOCTOR_FIXTURE).register;
if (!REGISTER_COPY?.confirm) {
  throw new Error("DOCTOR_FIXTURE must state the inline confirmation copy");
}
const CONFIRM_COPY = REGISTER_COPY.confirm;

beforeEach(() => {
  h.calls.length = 0;
  // The shipped EARS-10 body, verbatim in shape: the landing is read off it, so
  // a loose stub would let the navigation silently pick the wrong branch.
  h.confirm.mockReset().mockResolvedValue({
    status: "verified",
    credited: null,
    profileCompletion: null,
    primaryAction: { kind: "return", href: "/events/kardio" },
    secondaryAction: { href: "/account" },
  });
  h.login.mockReset().mockResolvedValue({});
  h.resendVerification.mockReset().mockResolvedValue(undefined);
  h.registerForEvent.mockReset().mockResolvedValue(undefined);
  h.push.mockReset();
  h.replace.mockReset();
  clearPendingRegistration();
  // jsdom runs no layout and the `input-otp` code field probes the point under
  // the pointer on a timer; without the stub the first interaction throws.
  document.elementFromPoint = () => document.body;
});

afterEach(() => {
  cleanup();
  clearPendingRegistration();
});

/**
 * `delay: null` is not a speed tweak, it is what makes this tier deterministic:
 * the default setup awaits a real timer between every keystroke, and one journey
 * here types a six-character code through the real field.
 */
function setupUser() {
  return userEvent.setup({ delay: null });
}

type PanelProps = {
  landing?: string;
  returnTarget?: string | null;
  carriedTarget?: string | null;
};

/** The panel as the door mounts it, with a credential already held by default. */
function renderPanel(props: PanelProps = {}, options?: { held?: boolean }) {
  if (options?.held !== false) {
    setPendingRegistration({ identifier: EMAIL, password: PASSWORD });
  }
  return render(
    <RegistrationConfirmation
      config={DOCTOR_FIXTURE}
      email={EMAIL}
      landing={props.landing ?? "/events"}
      returnTarget={
        props.returnTarget === undefined ? RETURN_TARGET : props.returnTarget
      }
      carriedTarget={
        props.carriedTarget === undefined ? CARRIED_TARGET : props.carriedTarget
      }
    />,
  );
}

/**
 * The shared code field submits ITSELF once the last character lands (003
 * EARS-24 — nobody presses a button for a code they finished typing), so typing
 * IS the submit; clicking the button on top would send the command twice.
 */
async function submitCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(CONFIRM_COPY.codeLabel), CODE);
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
    renderPanel();

    await submitCode(user);

    await waitFor(() =>
      expect(h.registerForEvent).toHaveBeenCalledWith("kardio"),
    );
    // Order is the contract, and it is the SAME order the Academy ships: the
    // session must exist before the command (the api answers a guest with a
    // 401), and the doctor must not be navigated before they are actually on
    // the roster — the эфир page would otherwise open still asking them to
    // register.
    expect(h.calls).toEqual(["confirm", "login", "register-for-event"]);
    expect(h.replace).not.toHaveBeenCalled();
    await act(async () => completeRegistration());
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/events/kardio"),
    );
  });

  it("005 EARS-2: a direct arrival carries no эфир — the doctor is landed and NO registration fires", async () => {
    const user = setupUser();
    renderPanel({ returnTarget: null, carriedTarget: null });

    await submitCode(user);

    await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
    expect(h.registerForEvent).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["confirm", "login"]);
  });

  it("005 EARS-2: a refused registration never strands the doctor — they are landed anyway", async () => {
    // Best-effort by the shared rule's contract: a transient failure or a gating
    // refusal is not a reason to withhold the outcome of the confirmation the
    // doctor DID complete. The truth about the roster is re-read per viewer on
    // the эфир page itself (005 EARS-4).
    h.registerForEvent.mockRejectedValue(new Error("upstream down"));
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/events/kardio"),
    );
  });
});

describe("021 EARS-15 (#1996): the doctor is signed in after email confirmation", () => {
  it("021 EARS-15: when the confirm succeeds and a password is held, system shall replay the login before the success state", async () => {
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
    // The real 003 EARS-5 command, with the credential the doctor just chose —
    // the session comes from the login route, never from the confirm route.
    expect(h.login).toHaveBeenCalledWith({
      identifier: EMAIL,
      password: PASSWORD,
    });
    // Order is the contract: confirm first (the code is the thing being
    // proven), login second, and only then the navigation — a hop fired before
    // the replay would land a guest on the event page.
    expect(h.calls).toEqual(["confirm", "login", "register-for-event"]);
    // EARS-10 (amended 2026-09-17) — the code screen is left by NAVIGATION,
    // with no interstitial in between.
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/events/kardio"),
    );
    expect(h.replace).toHaveBeenCalledTimes(1);
    // The take is single-shot: the credential is gone the moment it is
    // replayed, so nothing survives the journey to be replayed a second time.
    expect(takePendingRegistration(EMAIL)).toBeNull();
  });

  it("021 EARS-15.2: with no held password, system shall route to the sign-in door with the return context instead of the honoured target", async () => {
    // The credential-loss case (003 EARS-39): a reload, a restored tab, or a
    // hold past its TTL leaves the module slot empty between the submit and the
    // code.
    const user = setupUser();
    renderPanel({}, { held: false });

    await submitCode(user);

    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    // The Academy rule, whole: no held credential means no session, and a
    // doctor with no session is sent to sign in CARRYING the return context —
    // never walked onto the эфир as a guest. Rule S3: the CARRY vocabulary,
    // which the door re-parses on the far side.
    await waitFor(() =>
      expect(h.push).toHaveBeenCalledWith(
        `/login?returnTo=${encodeURIComponent(CARRIED_TARGET)}`,
      ),
    );
    expect(h.login).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["confirm"]);
    // The onward hop exists ONLY for a doctor who is signed in.
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("021 EARS-15.3: a replay the login refuses routes to the same sign-in door, with the slot wiped and no onward hop", async () => {
    // The concrete journey: the doctor re-registered the same email with a
    // SECOND password, 003 EARS-16 answered identically, and the IdP still holds
    // the first one — so the replay is refused with the generic 401 and there is
    // no session, exactly as if nothing had been held.
    h.login.mockRejectedValue(new Error("invalid credentials"));
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    await waitFor(() => expect(h.login).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(h.push).toHaveBeenCalledWith(
        `/login?returnTo=${encodeURIComponent(CARRIED_TARGET)}`,
      ),
    );
    // Not a failed CONFIRMATION — the code was accepted, so the doctor is never
    // told to type it again.
    expect(screen.queryByText(CONFIRM_COPY.failed)).toBeNull();
    expect(h.replace).not.toHaveBeenCalled();
    // The take consumes; it does not roll back on error.
    expect(takePendingRegistration(EMAIL)).toBeNull();
  });
});

/**
 * 021 EARS-10 (#1546, amended 2026-09-17) — the confirmed doctor is NAVIGATED,
 * and the owner's objection is exactly the failure this tier pins: an
 * interstitial asking for one more tap after the code has already been accepted.
 *
 * The three branches are the three href sources of the clause, asserted here
 * through the whole panel because the unit tier (`./confirm-landing.test.ts`)
 * can only prove the choice, not that the choice reaches the router.
 */
describe("021 EARS-10 (amended 2026-09-17): the confirmed doctor lands directly, with no success card", () => {
  it("021 EARS-10: a live carried target replaces the confirmation screen with the эфир itself", async () => {
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/events/kardio"),
    );
    // Nothing stands between the accepted code and the эфир: no outcome card,
    // and no «в личный кабинет» second action to read past.
    expect(screen.queryByTestId("registration-success")).toBeNull();
  });

  it("021 EARS-10: a cold arrival lands on the DOOR's LD-4 decision, not the API's default", async () => {
    // Nothing was carried, so the confirm route answers with its own default
    // `/events`; the door decided with 017's remembered specialty, which the
    // confirmation API does not have.
    h.confirm.mockResolvedValue({
      status: "verified",
      credited: null,
      profileCompletion: null,
      primaryAction: { kind: "landing", href: "/events" },
      secondaryAction: { href: "/account" },
    });
    const user = setupUser();
    renderPanel({
      landing: "/events?specialty=kardiologiya",
      returnTarget: null,
      carriedTarget: null,
    });

    await submitCode(user);

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/events?specialty=kardiologiya"),
    );
  });

  it("021 EARS-10: a target that went stale lands on the honest destination the server picked (LD-8)", async () => {
    // The эфир ended between the arrival and the code. The server re-validated
    // the target with the verification it had just performed and named the
    // nearest honest destination; the client has no better answer, so the
    // doctor is taken there instead of being shown a card explaining it.
    h.confirm.mockResolvedValue({
      status: "verified",
      credited: null,
      profileCompletion: null,
      primaryAction: {
        kind: "landing",
        href: "/events/kardio",
        reason: "ended",
      },
      secondaryAction: { href: "/account" },
    });
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/events/kardio"),
    );
  });
});

describe("017 #1933.10 (#2001): the confirmation step tells a rate limit from a wrong code", () => {
  it("017 #1933.10: a 429 on the confirm command reads as the rate-limit sentence, never «Код не подошёл»", async () => {
    // The api rate-limits the verification route (@RateLimited, 10 per user per
    // 15 min), so the eleventh wrong code inside the window comes back 429 — not
    // a verdict on the code. Before #2001 this host printed the wrong-code line
    // for it and sent the doctor back to retyping a code that could not pass.
    h.confirm.mockRejectedValue(new AuthError(429, "Too Many Requests"));
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    await screen.findByText(resolveAuthFlowCopy(DOCTOR_FIXTURE).errors.tooManyAttempts);
    expect(screen.queryByText(CONFIRM_COPY.failed)).toBeNull();
  });
});

describe("rows 51 + 76: the panel's words and hops are the host's data", () => {
  it("021 EARS-19: the confirm command carries the reconstructed target, and the description names the masked address", async () => {
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    await waitFor(() =>
      expect(h.confirm).toHaveBeenCalledWith({
        email: EMAIL,
        code: CODE,
        returnTo: RETURN_TARGET,
      }),
    );
  });

  it("021 EARS-13: the co-equal sign-in and recovery affordances carry the rule S3 target onward", () => {
    renderPanel();

    const carried = `?returnTo=${encodeURIComponent(CARRIED_TARGET)}`;
    expect(
      screen
        .getByRole("link", { name: CONFIRM_COPY.goToSignIn })
        .getAttribute("href"),
    ).toBe(`${DOCTOR_FIXTURE.routes.login}${carried}`);
    expect(
      screen
        .getByRole("link", { name: CONFIRM_COPY.goToReset })
        .getAttribute("href"),
    ).toBe(`${DOCTOR_FIXTURE.routes.reset}${carried}`);
  });
});
