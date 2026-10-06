// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The CLIENT HALF of the `/verify` route (`VerifyEntry`: the address gate and
 * the confirmation step) on the doctor storefront. Every host confirms on
 * `/verify` through the one 003 command (#2455); the server decision handed
 * across the boundary is pinned in `verify-route.test.tsx`, the hop INTO the
 * route in `register-door.test.tsx`, and everything past the accepted code here.
 *
 * Mocked seams, and why each is the honest one:
 *   - `../client/auth-client` — the panel builds its client from `config.api`
 *     (`createAuthClient`), so the BFF seam is that factory, never a prop.
 *   - `next/navigation` — the router IS the observable outcome of 021 EARS-10.
 *   - `@ds/events-storefront/client` — the 005 EARS-2 completion command, mocked
 *     at the transport ENTRY the shared rule imports it from; the RULE above the
 *     mock is the real shared one.
 *   - `BotProtectionField` — the real widget needs a site key and a network.
 * The held-registration slot (`pending-registration`) is NOT mocked: what these
 * tests assert is the wiring across confirm → completion, and mocking the unit
 * under the wiring would assert the mock. `login` stays on the mocked client so
 * every journey can prove it is never called (003 EARS-41: no replay).
 */

const h = vi.hoisted(() => ({
  verify: vi.fn(),
  login: vi.fn(),
  resendVerification: vi.fn(),
  registerForEvent: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  calls: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: h.replace, refresh: h.refresh }),
}));

vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({
    verify: (...args: unknown[]) => {
      h.calls.push("verify");
      return h.verify(...args);
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
  MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
  PARTNER_DATA_SHARING_PURPOSE,
  PARTNER_DATA_SHARING_REQUIRED_CODE,
} from "@ds/schemas";
import {
  PENDING_TTL_MS,
  clearPendingRegistration,
  peekPendingRegistration,
  setPendingRegistration,
} from "@ds/design-system/blocks";

import { AuthError } from "../client/auth-client";
import { resolveAuthFlowCopy } from "../copy";
import { DOCTOR_FIXTURE } from "../test-support/host-config-fixtures";
import { VerifyEntry } from "./verify-entry";

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3rSecret!";
const CODE = "PVDC3R";
/** The doctor-host projection of the arrival's confirm INTENT (021 #1945). */
const RETURN_TARGET = "/events/kardio";
/** Rule S3 — what the ROUTE carries onward, in the canonical vocabulary. */
const CARRIED_TARGET = "/webinars/kardio";

/** The ONE confirmation dictionary (#2027 PR 1.7) — the same words on every host. */
const CONFIRM_COPY = resolveAuthFlowCopy(DOCTOR_FIXTURE).verify;
/** What the doctor register door holds for this step (003 EARS-41, 021 EARS-4). */
const REGISTRATION = {
  password: PASSWORD,
  medicalWorkerDeclaration: true as const,
  consent: [
    {
      purpose: PARTNER_DATA_SHARING_PURPOSE,
      version: DOCTOR_FIXTURE.consents!.wordingVersion,
    },
  ],
};

beforeEach(() => {
  h.calls.length = 0;
  // The 003 answer names no destination: the landing is the shared client
  // resolution's, whatever the confirm command says.
  h.verify.mockReset().mockResolvedValue({ status: "verified" });
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
  resolveSignedInLanding?: () => Promise<string>;
  resolveCompletionTarget?: () => Promise<{
    returnTarget: string | null;
    landing: string;
  }>;
  returnTarget?: string | null;
  carriedTarget?: string | null;
};

/**
 * The step as the `/verify` route mounts it after the registration door's hop,
 * with the registration values that door held (003 EARS-41) by default.
 */
function renderPanel(props: PanelProps = {}, options?: { held?: boolean }) {
  if (options?.held !== false) {
    setPendingRegistration({
      identifier: EMAIL,
      registration: REGISTRATION,
      form: { email: EMAIL, password: PASSWORD, promoCode: "", consents: {} },
    });
  }
  return render(
    <VerifyEntry
      config={DOCTOR_FIXTURE}
      email={EMAIL}
      returnTo={CARRIED_TARGET}
      landing={props.landing ?? "/events"}
      {...(props.resolveSignedInLanding
        ? { resolveSignedInLanding: props.resolveSignedInLanding }
        : {})}
      {...(props.resolveCompletionTarget
        ? { resolveCompletionTarget: props.resolveCompletionTarget }
        : {})}
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
  it("005 EARS-2: once the code is accepted, system shall fire RegisterForEvent for the carried эфир before the doctor is navigated", async () => {
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
    // 401) — the accepted verify sets it (003 EARS-41) — and the doctor must
    // not be navigated before they are actually on the roster: the эфир page
    // would otherwise open still asking them to register.
    expect(h.calls).toEqual(["verify", "register-for-event"]);
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

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/events"));
    expect(h.registerForEvent).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["verify"]);
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

describe("003 EARS-41 / 021 EARS-15: the doctor is signed in by the accepted code itself", () => {
  it("003 EARS-41: the held registration values go WITH the code to the doctor host's verify command, and nothing is replayed", async () => {
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    await waitFor(() =>
      expect(h.verify).toHaveBeenCalledWith({
        email: EMAIL,
        code: CODE,
        registration: REGISTRATION,
      }),
    );
    // The accepted verify answer IS the session (003 EARS-41): there is no
    // second credential call to make.
    expect(h.login).not.toHaveBeenCalled();
    expect(h.calls).toEqual(["verify", "register-for-event"]);
    // EARS-10 (amended 2026-09-17) — the code screen is left by NAVIGATION,
    // with no interstitial in between.
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/events/kardio"),
    );
    expect(h.replace).toHaveBeenCalledTimes(1);
    // An accepted code wipes the hold: nothing survives to be sent twice.
    expect(peekPendingRegistration()).toBeNull();
  });

  it("003 EARS-41: with no held values (reload, restored tab), the code alone signs the doctor in and the honoured target is still reached", async () => {
    const user = setupUser();
    renderPanel({}, { held: false });

    await submitCode(user);

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/events/kardio"),
    );
    expect(h.verify).toHaveBeenCalledWith({ email: EMAIL, code: CODE });
    expect(h.login).not.toHaveBeenCalled();
    // Never sent to sign in by hand: the confirmation is the sign-in.
    expect(h.push).not.toHaveBeenCalled();
  });

  it("003 EARS-41: a hold past its TTL is not sent — the code goes alone, exactly as with no hold at all", async () => {
    const user = setupUser();
    renderPanel();
    const expired = Date.now() + PENDING_TTL_MS + 1;
    const clock = vi.spyOn(Date, "now").mockReturnValue(expired);
    try {
      await submitCode(user);

      await waitFor(() =>
        expect(h.replace).toHaveBeenCalledWith("/events/kardio"),
      );
      expect(h.verify).toHaveBeenCalledWith({ email: EMAIL, code: CODE });
      expect(h.login).not.toHaveBeenCalled();
      expect(h.push).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it("003 EARS-16 / EARS-41: a refused code keeps the doctor on the step with the generic error, the held values kept for the retry, no routing", async () => {
    h.verify.mockRejectedValueOnce(new AuthError(400, "Bad Request"));
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    expect(await screen.findByText(CONFIRM_COPY.failed)).toBeTruthy();
    expect(h.push).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.login).not.toHaveBeenCalled();
    // Still the confirmation step: the code field is on screen.
    expect(screen.getByLabelText(CONFIRM_COPY.codeLabel)).toBeTruthy();
    expect(peekPendingRegistration(EMAIL)?.registration).toEqual(REGISTRATION);
  });
});

describe("021 EARS-12: a 021 access-condition refusal on the doctor verify reads as the registration door reads it", () => {
  const consentCopy = resolveAuthFlowCopy(DOCTOR_FIXTURE).consents;

  it.each([
    [
      "partner-data consent",
      PARTNER_DATA_SHARING_REQUIRED_CODE,
      consentCopy.partnerDataItem.unmet!,
    ],
    [
      "medical-worker declaration",
      MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
      consentCopy.medicalWorkerDeclaration.unmet!,
    ],
  ])(
    "021 EARS-12: a 422 for the %s says the condition's own unmet sentence, never the code-failed one",
    async (_kind, code, sentence) => {
      h.verify.mockRejectedValueOnce(new AuthError(422, "refused", code));
      const user = setupUser();
      renderPanel();

      await submitCode(user);

      expect(await screen.findByTestId("verify-error")).toHaveTextContent(
        sentence,
      );
      expect(screen.queryByText(CONFIRM_COPY.failed)).toBeNull();
      expect(h.replace).not.toHaveBeenCalled();
    },
  );

  it("003 EARS-16: a 422 with no 021 refusal code stays the generic code-failed sentence", async () => {
    h.verify.mockRejectedValueOnce(new AuthError(422, "refused", "other"));
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    expect(await screen.findByTestId("verify-error")).toHaveTextContent(
      CONFIRM_COPY.failed,
    );
  });
});

/**
 * 021 EARS-10 (amended 2026-09-29, owner decision Б) — the confirmed doctor is
 * NAVIGATED to the page of the эфир they came from, by the same client
 * resolution the Академия uses (005 EARS-2 completion). Whether that эфир still
 * exists was decided by the `/verify` arrival (`returnTarget` is `null` when it
 * does not — pinned in `verify-route.test.tsx`); an ended or full эфир keeps its
 * page, which states that itself.
 */
describe("021 EARS-10 (amended 2026-09-29): the confirmed doctor lands on the originating эфир, with no success card", () => {
  it("021 EARS-10: a carried эфир replaces the confirmation screen with the эфир page itself", async () => {
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/events/kardio"),
    );
    // Nothing stands between the accepted code and the эфир: no outcome card.
    expect(screen.queryByTestId("registration-success")).toBeNull();
  });

  it("021 EARS-10: no carried эфир (a direct arrival, or one that no longer exists) lands on the door's LD-4 decision", async () => {
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

  it("021 EARS-10 (#2455): the эфир judged gone when the code is accepted is no target — the doctor lands on the answer's landing", async () => {
    const user = setupUser();
    renderPanel({
      resolveCompletionTarget: vi
        .fn()
        .mockResolvedValue({ returnTarget: null, landing: "/" }),
    });

    await submitCode(user);

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/"));
    expect(h.registerForEvent).not.toHaveBeenCalled();
  });

  it("021 EARS-10 (#2455): a completion-time check that cannot be asked is not «gone» — the эфир page stays the landing", async () => {
    const user = setupUser();
    renderPanel({
      resolveCompletionTarget: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await submitCode(user);

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/events/kardio"),
    );
    expect(h.registerForEvent).toHaveBeenCalledWith("kardio");
  });
});

describe("017 #1933.10 (#2001): the confirmation step tells a rate limit from a wrong code", () => {
  it("017 #1933.10: a 429 on the confirm command reads as the rate-limit sentence, never «Код не подошёл»", async () => {
    // The api rate-limits the verification route (@RateLimited, 10 per user per
    // 15 min), so the eleventh wrong code inside the window comes back 429 — not
    // a verdict on the code. Before #2001 this host printed the wrong-code line
    // for it and sent the doctor back to retyping a code that could not pass.
    h.verify.mockRejectedValue(new AuthError(429, "Too Many Requests"));
    const user = setupUser();
    renderPanel();

    await submitCode(user);

    await screen.findByText(
      resolveAuthFlowCopy(DOCTOR_FIXTURE).errors.tooManyAttempts,
    );
    expect(screen.queryByText(CONFIRM_COPY.failed)).toBeNull();
  });
});

describe("003 EARS-24 / row 76: the step's words and hops on the doctor /verify", () => {
  it("003 EARS-42: the doctor /verify draws the canvas code step — heading, the address as typed, 6 cells, «← Изменить почту», no «Войти» / «Сбросить пароль»", () => {
    renderPanel();

    expect(screen.getByText(CONFIRM_COPY.title)).toBeTruthy();
    expect(screen.getByTestId("verify-card")).toHaveTextContent(
      `Мы отправили код на ${EMAIL}.`,
    );
    const field = screen.getByLabelText(CONFIRM_COPY.codeLabel);
    expect(field).toHaveAttribute("maxlength", "6");
    expect(screen.getByTestId("verify-submit")).toHaveTextContent(
      CONFIRM_COPY.submit,
    );
    expect(screen.getByTestId("verify-resend")).toBeTruthy();
    expect(screen.getByTestId("verify-back")).toHaveTextContent(
      CONFIRM_COPY.back,
    );
    expect(screen.queryByTestId("verify-go-to-login")).toBeNull();
    expect(screen.queryByTestId("verify-go-to-reset")).toBeNull();
  });

  it("003 EARS-40: a doctor /verify with no address is replaced onto the registration door, the carried target kept", () => {
    render(
      <VerifyEntry
        config={DOCTOR_FIXTURE}
        landing="/events"
        returnTo={CARRIED_TARGET}
      />,
    );

    expect(screen.queryByTestId("verify-card")).toBeNull();
    expect(h.replace).toHaveBeenCalledWith(
      `/register?returnTo=${encodeURIComponent(CARRIED_TARGET)}`,
    );
  });

  it("003 EARS-3 (#2455): the doctor confirms with the address and the code — no target travels with them", async () => {
    const user = setupUser();
    renderPanel({}, { held: false });

    await submitCode(user);

    await waitFor(() =>
      expect(h.verify).toHaveBeenCalledWith({ email: EMAIL, code: CODE }),
    );
  });

  /** «← Изменить почту» on the doctor code step, pressed; the hop it made. */
  async function backHref() {
    await setupUser().click(screen.getByTestId("verify-back"));
    return h.push.mock.calls[0]?.[0] as string;
  }

  it("021 EARS-13 / 003 EARS-42: «← Изменить почту» carries the rule S3 target back to the registration door", async () => {
    renderPanel();

    expect(await backHref()).toBe(
      `${DOCTOR_FIXTURE.routes.register}?returnTo=${encodeURIComponent(CARRIED_TARGET)}`,
    );
  });

  it("021 EARS-13: with no carried target «← Изменить почту» is the plain registration route", async () => {
    renderPanel({ carriedTarget: null });

    expect(await backHref()).toBe(DOCTOR_FIXTURE.routes.register);
  });

  it.each([
    ["a protocol-relative", "//evil.example/steal"],
    ["an absolute cross-origin", "https://evil.example"],
  ])(
    "021 EARS-13: %s carried target never decorates «← Изменить почту» on the doctor code step",
    async (_kind, hostile) => {
      renderPanel({ carriedTarget: hostile });

      const href = await backHref();
      expect(href).toBe(DOCTOR_FIXTURE.routes.register);
      expect(href).not.toContain("evil.example");
    },
  );
});

describe("021 EARS-3 (#2333): the confirmed-and-signed-in doctor lands by the NEW session", () => {
  // 003 EARS-3 — `POST /v1/auth/verify` answers `{ status: "verified" }` only;
  // the landing is the step's own decision.
  const VERIFIED = { status: "verified" } as const;

  it("021 EARS-3: a cold arrival re-decides the landing once the accepted code signed the doctor in", async () => {
    h.verify.mockResolvedValue(VERIFIED);
    const resolveSignedInLanding = vi.fn(async () => {
      h.calls.push("re-decide");
      return "/events";
    });
    const user = setupUser();
    renderPanel({
      landing: "/",
      returnTarget: null,
      carriedTarget: null,
      resolveSignedInLanding,
    });

    await submitCode(user);

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/events"));
    // Decided with the session the accepted verify just created, never before it.
    expect(h.calls).toEqual(["verify", "re-decide"]);
  });

  it("021 EARS-3: a failed re-decision falls back to the guest-time landing", async () => {
    h.verify.mockResolvedValue(VERIFIED);
    const user = setupUser();
    renderPanel({
      landing: "/",
      returnTarget: null,
      carriedTarget: null,
      resolveSignedInLanding: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await submitCode(user);

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/"));
  });

  it("005 EARS-2: a carried эфир the server honoured still wins over the re-decided landing", async () => {
    const user = setupUser();
    renderPanel({
      resolveSignedInLanding: vi.fn().mockResolvedValue("/events"),
    });

    await submitCode(user);

    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/events/kardio"),
    );
  });
});
