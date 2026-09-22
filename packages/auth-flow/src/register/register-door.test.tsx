// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The CLIENT REGISTRATION DOOR of the shared auth flow (#2027 PR 1.6, gate rows
 * 47-64): one composition of the design-system `<RegisterCard>`, hosted by both
 * storefronts through host CONFIG alone.
 *
 * The ids arrive from `apps/doctor/components/registration-screen.test.tsx` and
 * `apps/portal/app/register/page.test.tsx`: the behaviour they describe is no
 * longer a per-host projection but the package door, so each runs over the
 * fixture whose branch it is about and over BOTH fixtures where the rule is
 * host-neutral - which is the point of the lift. The scenarios of the INLINE
 * confirmation step (021 EARS-10/15 beyond the submit) belong to that unit and
 * stay with it; this file owns the form step and the row-51 fork out of it.
 *
 * Mocked seams, and why each is the honest one:
 *   - `../client/auth-client` - the door builds its client from `config.api`
 *     (`createAuthClient`), so the BFF seam is that factory, never a prop.
 *   - `next/navigation` - the router is the observable effect of row 51.
 *   - `BotProtectionField` - the real widget needs a Yandex site key and a
 *     network; the DOOR's contract is that the command resumes exactly once with
 *     the minted token, which the stub can hand over on demand.
 * The held-credential slot (`pending-registration`) is NOT mocked: what these
 * tests assert is the wiring around it, and mocking it would assert the mock.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

const register = vi.fn();
vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({ register }),
}));

type CaptchaProps = {
  requestKey: number | null;
  onToken: (token?: string) => void;
  onError: (reason: "expired" | "unavailable" | "incomplete") => void;
};
let captchaMode: "bypass" | "manual" = "bypass";
let captchaProps: CaptchaProps | undefined;
vi.mock("@ds/design-system/blocks", async () => {
  const React = await import("react");
  const actual = await vi.importActual<
    typeof import("@ds/design-system/blocks")
  >("@ds/design-system/blocks");
  return {
    ...actual,
    BotProtectionField: (props: CaptchaProps) => {
      captchaProps = props;
      React.useEffect(() => {
        if (captchaMode === "bypass" && props.requestKey !== null) {
          props.onToken(undefined);
        }
      }, [props.onToken, props.requestKey]);
      return <div data-testid="bot-protection-field" />;
    },
  };
});

import {
  MARKETING_COMMUNICATIONS_PURPOSE,
  PARTNER_DATA_SHARING_PURPOSE,
} from "@ds/schemas";
import {
  clearPendingRegistration,
  maskDestination,
  setPendingRegistration,
  takePendingRegistration,
} from "@ds/design-system/blocks";

import { AuthError } from "../client/auth-client";
import { resolveAuthFlowCopy } from "../copy";
import type { AuthFlowHostConfig } from "../host-config";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { RegisterDoor } from "./register-door";
import { BotProtectionErrorCodes } from "@ds/schemas";

/** Both host shapes, for every rule the door owns rather than a host states. */
const HOSTS: readonly (readonly [string, AuthFlowHostConfig])[] = [
  ["academy", ACADEMY_FIXTURE],
  ["doctor", DOCTOR_FIXTURE],
];

const EMAIL = "doctor@clinic.ru";
const PASSWORD = "Sup3rSecret2026!";

/** The props the MOUNT resolves; every scenario varies only what it is about. */
type DoorProps = {
  landing?: string;
  returnTo?: string | null;
  returnTarget?: string | null;
  carriedTarget?: string | null;
  returnContextPlate?: import("react").ReactNode;
};

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  register.mockReset().mockResolvedValue({ status: "pending_verification" });
  captchaMode = "bypass";
  captchaProps = undefined;
  clearPendingRegistration();
  // jsdom runs no layout and `userEvent` probes the point under the pointer
  // before every click; without the stub the first click throws.
  document.elementFromPoint = () => document.body;
});

afterEach(() => {
  cleanup();
  clearPendingRegistration();
});

/** No fake timers here, so the typing delay is pure wall-clock waiting. */
const setupUser = () => userEvent.setup({ delay: null });

async function renderDoor(config: AuthFlowHostConfig, props: DoorProps = {}) {
  render(<RegisterDoor config={config} landing="/" {...props} />);
  await screen.findByTestId("register-submit");
}

/** The form as a visitor leaves it before submitting: typed, every box ticked. */
async function fillForm(
  user: ReturnType<typeof setupUser>,
  values: { email?: string; password?: string } = {},
) {
  await user.type(screen.getByTestId("register-email"), values.email ?? EMAIL);
  await user.type(
    screen.getByTestId("register-password"),
    values.password ?? PASSWORD,
  );
  const boxes = screen
    .getByTestId("registration-form")
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  for (const box of Array.from(boxes)) {
    if (!box.checked) await user.click(box);
  }
}

/** Fill and submit in one step — the shape almost every scenario needs. */
async function submitForm(
  config: AuthFlowHostConfig,
  props: DoorProps = {},
  values: { email?: string; password?: string } = {},
) {
  const user = setupUser();
  await renderDoor(config, props);
  await fillForm(user, values);
  await user.click(screen.getByTestId("register-submit"));
  return user;
}

/** An `AuthError` the door's callers branch on, by CODE or by status. */
const authError = (status: number, code?: string) =>
  new AuthError(status, "refused", code);

/** The body the last accepted command carried. */
const lastBody = () =>
  register.mock.calls[register.mock.calls.length - 1]?.[0] as Record<
    string,
    unknown
  >;

describe("003 EARS-17 / 021 EARS-19.4: the challenge runs BEFORE the command", () => {
  it.each(HOSTS)(
    "003 EARS-17: the %s door mints the token first, and the registration carries it on its FIRST call",
    async (_name, config) => {
      captchaMode = "manual";

      await submitForm(config);
      await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());
      // No tokenless probe reaches the api while the challenge is in flight.
      expect(register).not.toHaveBeenCalled();

      act(() => captchaProps?.onToken("minted-token"));

      await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
      expect(register.mock.calls[0]?.[1]).toBe("minted-token");
      // …and the resumed body is the one the visitor submitted, not a re-read
      // of a form they may have touched since.
      expect(register.mock.calls[0]?.[0]).toMatchObject({ email: EMAIL });
    },
  );

  it.each(HOSTS)(
    "021 EARS-19.4: a challenge the api still REQUIRES on the %s door reads as that host's challenge sentence, in the challenge block",
    async (_name, config) => {
      register
        .mockReset()
        .mockRejectedValue(authError(403, BotProtectionErrorCodes.required));

      await submitForm(config);

      await waitFor(() =>
        expect(screen.getByTestId("register-captcha-error")).toHaveTextContent(
          resolveAuthFlowCopy(config).botProtection.required,
        ),
      );
      // A refused challenge is never a failed command…
      expect(screen.queryByTestId("register-command-error")).toBeNull();
      // …and the visitor may try again right away.
      expect(screen.getByTestId("register-submit")).toBeEnabled();
    },
  );

  it.each(HOSTS)(
    "021 EARS-19.4: a token the api REFUSES on the %s door reads as that host's refused-challenge sentence, and the typed form survives",
    async (_name, config) => {
      captchaMode = "manual";
      register
        .mockReset()
        .mockRejectedValue(authError(403, BotProtectionErrorCodes.rejected));

      await submitForm(config);
      await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());
      act(() => captchaProps?.onToken("spent-token"));

      await waitFor(() =>
        expect(screen.getByTestId("register-captcha-error")).toHaveTextContent(
          resolveAuthFlowCopy(config).botProtection.rejected,
        ),
      );
      expect(screen.queryByTestId("register-command-error")).toBeNull();
      // A retry is a re-submit, not a re-type: nothing was wiped.
      expect(screen.getByTestId("register-email")).toHaveValue(EMAIL);
      expect(screen.getByTestId("register-password")).toHaveValue(PASSWORD);
    },
  );
});

describe("#337 / gate row 63: how the in-flight submit reads", () => {
  it("#337: the Academy submit states the wait with the loading affordance", async () => {
    let release: (() => void) | undefined;
    register.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );

    await submitForm(ACADEMY_FIXTURE);

    const submit = await screen.findByTestId("register-submit");
    await waitFor(() => expect(submit).toHaveAttribute("aria-busy", "true"));
    expect(submit.querySelector(".animate-spin")).not.toBeNull();

    act(() => release?.());
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("#2027: the doctor door reads its pending submit exactly as the Academy one does", async () => {
    // The owner's rule (PR #2338): a field — and the control that submits it —
    // is ONE thing on both storefronts. The door used to go plainly inert here
    // while the Academy spun; that host fork is gone with `pendingAffordance`.
    let release: (() => void) | undefined;
    register.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );

    await submitForm(DOCTOR_FIXTURE);

    const submit = await screen.findByTestId("register-submit");
    await waitFor(() => expect(submit).toHaveAttribute("aria-busy", "true"));
    expect(submit.querySelector(".animate-spin")).not.toBeNull();

    act(() => release?.());
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  });
});

const SAFE_TARGET = "/webinars/cardio";
const HOSTILE_TARGET = "//evil.example/steal";

describe("005 EARS-2 / gate row 51: where an accepted registration goes next", () => {
  it("005 EARS-2: a host that serves a /verify route hands the address — and a safe arrival context — to it", async () => {
    await submitForm(ACADEMY_FIXTURE, { returnTo: SAFE_TARGET });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/verify?email=${encodeURIComponent(EMAIL)}&returnTo=${encodeURIComponent(SAFE_TARGET)}`,
      ),
    );
  });

  it("005 EARS-2: a cross-origin arrival context is dropped rather than propagated into the /verify hop", async () => {
    await submitForm(ACADEMY_FIXTURE, { returnTo: HOSTILE_TARGET });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/verify?email=${encodeURIComponent(EMAIL)}`,
      ),
    );
  });

  it("gate row 51: a host with NO /verify route never navigates — it confirms on the door itself", async () => {
    await submitForm(DOCTOR_FIXTURE, { returnTo: SAFE_TARGET });

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("021 EARS-10 (#2331): the already-registered visitor's way out", () => {
  /** The footer link each host words itself — read by ITS own sentence. */
  const signInHref = (config: AuthFlowHostConfig) =>
    screen
      .getByText(resolveAuthFlowCopy(config).register.haveAccount)
      .closest("a")
      ?.getAttribute("href");

  it.each(HOSTS)(
    "021 EARS-10: the sign-in link on the %s door carries a safe arrival context onward",
    async (_name, config) => {
      await renderDoor(config, { returnTo: SAFE_TARGET });

      expect(signInHref(config)).toBe(
        `${config.routes.login}?returnTo=${encodeURIComponent(SAFE_TARGET)}`,
      );
    },
  );

  it.each(HOSTS)(
    "021 EARS-10: with no arrival context the sign-in link on the %s door is that host's plain sign-in route",
    async (_name, config) => {
      await renderDoor(config);

      expect(signInHref(config)).toBe(config.routes.login);
    },
  );

  it.each(HOSTS)(
    "021 EARS-10: a cross-origin context never decorates the sign-in link on the %s door",
    async (_name, config) => {
      await renderDoor(config, { returnTo: HOSTILE_TARGET });

      expect(signInHref(config)).toBe(config.routes.login);
    },
  );
});

describe("021 EARS-15.4: what the door holds for the step after the submit", () => {
  it.each(HOSTS)(
    "021 EARS-15.4: an accepted registration on the %s door holds the typed credential for the confirmation replay",
    async (_name, config) => {
      await submitForm(config);

      await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
      // The hold is what lets the confirmation step sign the visitor in without
      // asking for the password they typed one screen ago.
      await waitFor(() =>
        expect(takePendingRegistration(EMAIL)).toEqual({
          identifier: EMAIL,
          password: PASSWORD,
        }),
      );
    },
  );

  it("021 EARS-15.4: a refused registration holds nothing — there is no step to replay into", async () => {
    register.mockReset().mockRejectedValue(authError(400));

    await submitForm(DOCTOR_FIXTURE);

    await waitFor(() =>
      expect(screen.getByTestId("register-command-error")).toHaveTextContent(
        resolveAuthFlowCopy(DOCTOR_FIXTURE).register.failed,
      ),
    );
    expect(takePendingRegistration(EMAIL)).toBeNull();
  });

  it("021 EARS-15.4.1: a hold left by an abandoned attempt is dropped as the submit starts, never carried past a refusal", async () => {
    setPendingRegistration({ identifier: EMAIL, password: "stale-password" });
    register.mockReset().mockRejectedValue(authError(400));

    await submitForm(DOCTOR_FIXTURE);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(takePendingRegistration(EMAIL)).toBeNull();
  });
});

describe("021 EARS-4/5/6/7/12/19: the consent rows a host states, and what is recorded", () => {
  it("021 EARS-4/5/6: the doctor door draws the declaration and both tiered statements as controls", async () => {
    await renderDoor(DOCTOR_FIXTURE);

    expect(screen.getByTestId("register-medworker")).toBeInTheDocument();
    expect(screen.getByTestId("register-partner-data")).toBeInTheDocument();
    expect(screen.getByTestId("register-marketing")).toBeInTheDocument();
  });

  it("021 EARS-4/19: an accepted doctor registration carries the declaration and every granted purpose, stamped with this host's wording version", async () => {
    await submitForm(DOCTOR_FIXTURE);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(lastBody()).toMatchObject({
      email: EMAIL,
      password: PASSWORD,
      medicalWorkerDeclaration: true,
    });
    // The version travels SYMBOLICALLY from the host: what is proven here is
    // that the door stamps the version of the wording it rendered, never a
    // literal that a re-wording would leave behind (021 EARS-7).
    expect(lastBody().consent).toEqual([
      {
        purpose: PARTNER_DATA_SHARING_PURPOSE,
        version: DOCTOR_FIXTURE.consents?.wordingVersion,
      },
      {
        purpose: MARKETING_COMMUNICATIONS_PURPOSE,
        version: DOCTOR_FIXTURE.consents?.wordingVersion,
      },
    ]);
  });

  it("021 EARS-6: the optional opt-in is recorded only where the visitor actually ticked it", async () => {
    const user = setupUser();
    await renderDoor(DOCTOR_FIXTURE);
    await fillForm(user);
    // `fillForm` leaves every box ticked; untick the one that is a choice.
    await user.click(screen.getByTestId("register-marketing"));
    await user.click(screen.getByTestId("register-submit"));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(lastBody().consent).toEqual([
      {
        purpose: PARTNER_DATA_SHARING_PURPOSE,
        version: DOCTOR_FIXTURE.consents?.wordingVersion,
      },
    ]);
  });

  it("003 EARS-20: the Academy asks for no control — it states one read-only sentence under the credentials", async () => {
    await renderDoor(ACADEMY_FIXTURE);

    expect(
      screen.getByText(resolveAuthFlowCopy(ACADEMY_FIXTURE).consents.statement),
    ).toBeInTheDocument();
    expect(
      screen
        .getByTestId("registration-form")
        .querySelectorAll('input[type="checkbox"]'),
    ).toHaveLength(0);
  });

  it("021 EARS-19: the Academy records the purpose behind that sentence, and declares nothing it never asked", async () => {
    await submitForm(ACADEMY_FIXTURE);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(lastBody().consent).toEqual([
      { purpose: "tos", version: "2026-01" },
    ]);
    expect(lastBody()).not.toHaveProperty("medicalWorkerDeclaration");
  });
});

describe("021 EARS-7/12: the blocked submit, and the statement that cannot be self-served", () => {
  it("021 EARS-12: a doctor host whose read model carries no partner statement says so and keeps the submit shut", async () => {
    const stripped: AuthFlowHostConfig = {
      ...DOCTOR_FIXTURE,
      consents: {
        ...DOCTOR_FIXTURE.consents!,
        tiers: DOCTOR_FIXTURE.consents!.tiers!.filter(
          (tier) => tier.tier !== "access-conditions",
        ),
      },
    };
    const user = setupUser();

    await renderDoor(stripped);
    await fillForm(user);

    // The condition the server still refuses without is stated even though no
    // rendered row covers it — a silently dead button exists in no state.
    expect(screen.getByTestId("register-submit-reason")).toHaveTextContent(
      resolveAuthFlowCopy(DOCTOR_FIXTURE).consents.partnerDataItem.unmet!,
    );
    expect(screen.getByTestId("register-submit")).toBeDisabled();
  });

  it("021 EARS-12: the Academy states no unmet condition — its submit is live from the first render", async () => {
    await renderDoor(ACADEMY_FIXTURE);

    expect(screen.queryByTestId("register-submit-reason")).toBeNull();
    expect(screen.getByTestId("register-submit")).toBeEnabled();
  });

  it("021 EARS-7: the withdrawal statement stands under the doctor's rows and nowhere on the Academy", async () => {
    await renderDoor(DOCTOR_FIXTURE);
    expect(
      screen.getByTestId("registration-consent-manager-note"),
    ).toHaveTextContent(resolveAuthFlowCopy(DOCTOR_FIXTURE).consents.managerNote);

    cleanup();
    await renderDoor(ACADEMY_FIXTURE);
    expect(
      screen.queryByTestId("registration-consent-manager-note"),
    ).toBeNull();
  });
});

describe("gate rows 9 and 61: the slots a host either words or does not have", () => {
  it("gate row 9: the promo box stands on the host that words one, and nowhere else", async () => {
    await renderDoor(DOCTOR_FIXTURE);
    expect(screen.getByTestId("register-promo")).toBeInTheDocument();

    cleanup();
    await renderDoor(ACADEMY_FIXTURE);
    expect(screen.queryByTestId("register-promo")).toBeNull();
  });

  it("gate row 61: the «кто платит» line and the points promise render exactly where the host states them", async () => {
    const sponsored: AuthFlowHostConfig = {
      ...DOCTOR_FIXTURE,
      register: {
        ...DOCTOR_FIXTURE.register,
        attribution: "Организатор — Doctor.School",
        pointsPromise: "3 балла НМО за эфир",
      },
    };

    await renderDoor(sponsored);
    expect(screen.getByTestId("registration-attribution")).toHaveTextContent(
      "Организатор — Doctor.School",
    );
    expect(screen.getByTestId("registration-points-promise")).toHaveTextContent(
      "3 балла НМО за эфир",
    );

    cleanup();
    await renderDoor(ACADEMY_FIXTURE);
    expect(screen.queryByTestId("registration-attribution")).toBeNull();
    expect(screen.queryByTestId("registration-points-promise")).toBeNull();
  });
});

describe("003 EARS-16: how a refused registration reads", () => {
  it.each(HOSTS)(
    "003 EARS-16: a refused command on the %s door reads that host's generic sentence, never an account-existence fact",
    async (_name, config) => {
      register.mockReset().mockRejectedValue(authError(400));

      await submitForm(config);

      await waitFor(() =>
        expect(screen.getByTestId("register-command-error")).toHaveTextContent(
          resolveAuthFlowCopy(config).register.failed,
        ),
      );
    },
  );

  it.each(HOSTS)(
    "003 EARS-16: a rate-limited command on the %s door reads as the wait it is, not as a refusal",
    async (_name, config) => {
      register.mockReset().mockRejectedValue(authError(429));

      await submitForm(config);

      await waitFor(() =>
        expect(screen.getByTestId("register-command-error")).toHaveTextContent(
          resolveAuthFlowCopy(config).errors.tooManyAttempts,
        ),
      );
    },
  );
});

describe("021 EARS-2: the gate context beside the form", () => {
  it("021 EARS-2: a supplied arrival plate is published in its own slot", async () => {
    await renderDoor(DOCTOR_FIXTURE, {
      returnContextPlate: <p>Вы вернётесь к этому эфиру</p>,
    });

    expect(screen.getByTestId("registration-return-context")).toHaveTextContent(
      "Вы вернётесь к этому эфиру",
    );
  });

  it("021 EARS-2 / EARS-3: with no arrival context the slot is absent rather than an empty frame", async () => {
    await renderDoor(DOCTOR_FIXTURE);

    expect(screen.queryByTestId("registration-return-context")).toBeNull();
  });
});

describe("rows 51 + 76: the confirmation step a host with no /verify route runs", () => {
  it("021 EARS-19: an accepted registration on the doctor door replaces the form with the code step for the address just registered", async () => {
    const confirmCopy = resolveAuthFlowCopy(DOCTOR_FIXTURE).register.confirm;
    if (!confirmCopy) throw new Error("fixture states no confirmation copy");
    await submitForm(DOCTOR_FIXTURE);

    // The host serves no `/verify` route, so the accepted command does not hop:
    // the panel opens in place, naming the address the visitor just gave.
    await screen.findByLabelText(confirmCopy.codeLabel);
    expect(screen.getByText(maskDestination(EMAIL))).toBeTruthy();
    expect(screen.queryByTestId("registration-form")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("021 EARS-19: the Academy door never reaches the inline step — its own /verify route owns it", async () => {
    // The words of the code step are the package's on every host; WHERE the
    // step runs is the host's, and this one states a `/verify` route of its own.
    expect(ACADEMY_FIXTURE.routes.verify).toBe("/verify");
    await submitForm(ACADEMY_FIXTURE);

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByLabelText(
        resolveAuthFlowCopy(DOCTOR_FIXTURE).register.confirm?.codeLabel ?? "",
      ),
    ).toBeNull();
  });
});
