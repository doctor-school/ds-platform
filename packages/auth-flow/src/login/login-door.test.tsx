// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The CLIENT SIGN-IN DOOR of the shared auth flow (#2027 PR 1.5, gate rows
 * 21/39/46): one composition of the design-system `<LoginCard>`, hosted by both
 * storefronts through host CONFIG alone.
 *
 * These ids arrive from `apps/doctor/components/login-screen.*`: the behaviour
 * they describe is no longer a doctor-host projection but the package door, so
 * the assertions follow the code rather than being duplicated next to a host
 * file that now mounts nothing of its own. Each runs over the fixture whose
 * branch it is about, and over BOTH fixtures where the rule is host-neutral —
 * which is the point of the lift: the same door, two configurations.
 *
 * Mocked seams, and why each is the honest one:
 *   • `@ds/events-storefront/client` — `completeReturnTarget` imports
 *     `registerForEvent` from that ENTRY, so mocking the barrel would leave the
 *     intra-package import untouched and the command unobserved. The RULE under
 *     the mock is the real shared one, with the fixture's configuration.
 *   • `../client/auth-client` — the door builds its client from `config.api`
 *     (`createAuthClient`), so the BFF seam is that factory, not a prop.
 *   • `next/navigation` — the router is the effect under test on success.
 */
const registerForEvent = vi.fn();
vi.mock("@ds/events-storefront/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/client")>()),
  registerForEvent: (slug: string) => registerForEvent(slug),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const login = vi.fn();
const requestOtp = vi.fn();
const loginWithOtp = vi.fn();
vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({ login, requestOtp, loginWithOtp }),
}));

import type { AuthFlowHostConfig } from "../host-config";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { LoginDoor } from "./login-door";

beforeEach(() => {
  registerForEvent.mockReset().mockResolvedValue(undefined);
  push.mockReset();
  refresh.mockReset();
  login.mockReset().mockResolvedValue(undefined);
  requestOtp.mockReset().mockResolvedValue(undefined);
  loginWithOtp.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

/** The door's markup for one host, the structural assertions' subject. */
function markup(
  config: AuthFlowHostConfig,
  props?: { landing?: string; returnTo?: string | null },
) {
  const { container } = render(
    <LoginDoor config={config} landing="/" {...props} />,
  );
  return container.innerHTML;
}

describe("017 #1933: what reaches the HTML of the sign-in door", () => {
  it("017 #1933.10: the screen is the SHARED LoginCard, with the doctor RU copy on it", () => {
    const html = markup(DOCTOR_FIXTURE);

    // The block's own test ids — proof the card is projected, not re-built here.
    expect(html).toContain('data-testid="password-login-form"');
    expect(html).toContain('data-testid="login-method-otp"');
    // …and the sentences are the HOST's, read out of its config, never a
    // package default: these three are the doctor fixture's own.
    expect(html).toContain("Вход");
    expect(html).toContain("Почта или телефон");
    expect(html).toContain("Создать аккаунт");
    // The same door on the Academy speaks the Academy's identifier sentence.
    expect(markup(ACADEMY_FIXTURE)).toContain(
      "Электронная почта или телефон",
    );
  });

  it("017 #1933.13: with no return context NOTHING stands in for it (honest-empty)", () => {
    // Arrived at the door with nothing resolved: the slot is not merely empty,
    // its wrapper does not exist — no reserved band, no placeholder card.
    expect(markup(DOCTOR_FIXTURE)).not.toContain("login-return-context");

    cleanup();
    // The SAME door, given a plate, renders exactly one slot around it.
    const { container } = render(
      <LoginDoor
        config={DOCTOR_FIXTURE}
        landing="/"
        returnContextPlate={<p>эфир</p>}
      />,
    );
    expect(container.innerHTML).toContain("login-return-context");
  });

  it("017 #1989.14: password recovery stays on THIS host — «Забыли пароль» links to the storefront /reset", () => {
    const html = markup(DOCTOR_FIXTURE);

    expect(html).toContain('href="/reset"');
    // The #1933 interim crossing is gone with the route that made it necessary.
    expect(html).not.toContain("academy.doctor.school");
  });

  it("017 #1933.11: the create-account link carries the validated arrival context onward", () => {
    // Host-neutral (rule S3): the carry is the same guard and the same param on
    // both storefronts; only the route it decorates is configuration.
    expect(markup(DOCTOR_FIXTURE, { returnTo: "/webinars/abc" })).toContain(
      'href="/register?returnTo=%2Fwebinars%2Fabc"',
    );
    expect(markup(ACADEMY_FIXTURE, { returnTo: "/webinars/abc" })).toContain(
      'href="/register?returnTo=%2Fwebinars%2Fabc"',
    );
    // A hostile target is dropped, never propagated onto either link.
    const hostile = markup(DOCTOR_FIXTURE, {
      returnTo: "https://evil.example/webinars/abc",
    });
    expect(hostile).not.toContain("evil.example");
    expect(hostile).toContain('href="/register"');
  });

  it("017 #1933.12: the server landing decision is published on the screen, not recomputed", () => {
    // Host-neutral: whichever host resolved it, the door publishes the value it
    // was handed on the element the command belongs to.
    expect(markup(DOCTOR_FIXTURE, { landing: "/events" })).toContain(
      'data-login-landing="/events"',
    );
    expect(markup(ACADEMY_FIXTURE, { landing: "/webinars" })).toContain(
      'data-login-landing="/webinars"',
    );
  });
});

/**
 * Sign in through the door the way a doctor does: type the identifier and the
 * password into the block's own fields and submit.
 */
async function signIn(props?: {
  returnTarget?: string | null;
  landing?: string;
}) {
  const user = userEvent.setup();
  render(
    <LoginDoor config={DOCTOR_FIXTURE} landing="/events" {...props} />,
  );
  await user.type(screen.getByLabelText("Почта или телефон"), "doc@clinic.ru");
  await user.type(screen.getByLabelText("Пароль"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Войти" }));
  await waitFor(() => expect(login).toHaveBeenCalled());
}

describe("005 EARS-2: the doctor sign-in completes the carried эфир intent", () => {
  it("005 EARS-2: an эфир intent fires RegisterForEvent for its slug and lands on this host's event page", async () => {
    await signIn({ returnTarget: "/events/cardio-live" });

    await waitFor(() =>
      expect(registerForEvent).toHaveBeenCalledWith("cardio-live"),
    );
    expect(push).toHaveBeenCalledWith("/events/cardio-live");
    expect(refresh).toHaveBeenCalled();
  });

  it("005 EARS-2: a direct arrival carries no intent — the server landing stands and NO registration fires", async () => {
    await signIn();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events"));
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("005 EARS-2: an unsafe target is honoured by nothing — the landing stands and NO registration fires", async () => {
    // Defence in depth. The mount hands over a value its own guard already
    // reconstructed, so a cross-origin string cannot reach here through the
    // shipped path; the shared rule still refuses it, so the one branch that
    // returns a carried value verbatim can never become an open redirect if a
    // future mount wires the door without resolving first.
    await signIn({ returnTarget: "https://evil.example/events/cardio-live" });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events"));
    expect(registerForEvent).not.toHaveBeenCalled();
  });
});
