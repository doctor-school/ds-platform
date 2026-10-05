// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 014 EARS-6 (#2495) — a registration intent lives only inside the sign-in flow
 * that carried it.
 *
 * The journey is played end to end over the REAL halves of the mechanism: the
 * parking rule each host's middleware/proxy runs on its auth doors
 * (`parkReturnTarget`), the browser cookie jar between requests (jsdom's
 * `document.cookie`, fed the rule's `Set-Cookie` headers), and the client door
 * that completes the carried target after sign-in. Only the transport seams are
 * mocked: the BFF client, the router and the `RegisterForEvent` command.
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

import {
  completeResolvedReturnTarget,
  completeReturnTarget,
} from "../client/return-completion";
import {
  clearStoredReturnTarget,
  readStoredReturnTarget,
} from "../client/return-target-store";
import { resolveAuthFlowCopy } from "../copy";
import type { AuthFlowHostConfig } from "../host-config";
import { parkReturnTarget } from "../server/return-target-parking";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { LoginDoor } from "./login-door";

beforeEach(() => {
  registerForEvent.mockReset().mockResolvedValue({ registered: true });
  push.mockReset();
  refresh.mockReset();
  login.mockReset().mockResolvedValue(undefined);
  requestOtp.mockReset().mockResolvedValue(undefined);
  loginWithOtp.mockReset().mockResolvedValue(undefined);
  clearStoredReturnTarget();
});

afterEach(cleanup);

/**
 * The browser opening one auth door: the host middleware runs the shared
 * parking rule over the request (with the browser's cookies), and whatever it
 * sets lands back in the browser's jar.
 */
function openDoor(pathAndQuery: string) {
  const request = new NextRequest(`http://localhost:3000${pathAndQuery}`, {
    headers: { cookie: document.cookie },
  });
  const response = parkReturnTarget(request);
  for (const header of response?.headers.getSetCookie() ?? []) {
    document.cookie = header;
  }
}

const HOSTS: ReadonlyArray<{
  name: string;
  config: AuthFlowHostConfig;
  eventPath: string;
  landing: string;
}> = [
  {
    name: "doctor",
    config: DOCTOR_FIXTURE,
    eventPath: "/events/cardio-live",
    landing: "/events",
  },
  {
    name: "academy",
    config: ACADEMY_FIXTURE,
    eventPath: "/webinars/cardio-live",
    landing: "/webinars",
  },
];

function signUpEntry(eventPath: string, door = "/login") {
  return `${door}?returnTo=${encodeURIComponent(eventPath)}`;
}

async function signInWithPassword(config: AuthFlowHostConfig, props: {
  landing: string;
  returnTarget: string | null;
}) {
  const user = userEvent.setup();
  render(<LoginDoor config={config} {...props} />);
  const copy = resolveAuthFlowCopy(config).login;
  await user.type(screen.getByLabelText(copy.password.identifierLabel), "doc@clinic.ru");
  await user.type(
    screen.getByLabelText(copy.password.passwordLabel, { selector: "input" }),
    "correct-horse-battery",
  );
  await user.click(screen.getByRole("button", { name: copy.password.submit }));
  await waitFor(() => expect(login).toHaveBeenCalled());
}

describe.each(HOSTS)(
  "014 EARS-6 (#2495) on the $name storefront: the intent is bound to the flow that carried it",
  ({ config, eventPath, landing }) => {
    it("014 EARS-6.10: «Записаться» → login page → Back → a plain sign-in does NOT register the visitor", async () => {
      openDoor(signUpEntry(eventPath));
      expect(readStoredReturnTarget()).toBe(eventPath);

      // Back, then the header «Войти»: a door with no carried target.
      openDoor(config.routes.login);
      expect(readStoredReturnTarget()).toBeNull();

      await signInWithPassword(config, { landing, returnTarget: null });

      await waitFor(() => expect(push).toHaveBeenCalledWith(landing));
      expect(registerForEvent).not.toHaveBeenCalled();
    });

    it("014 EARS-6.10: «Записаться» → sign in completes the registration as before", async () => {
      openDoor(signUpEntry(eventPath));

      await signInWithPassword(config, { landing, returnTarget: eventPath });

      await waitFor(() => expect(push).toHaveBeenCalledWith(eventPath));
      expect(registerForEvent).toHaveBeenCalledWith("cardio-live");
      expect(readStoredReturnTarget()).toBeNull();
    });

    it("014 EARS-6.10: the OTP step is part of the same flow - the registration still completes", async () => {
      openDoor(signUpEntry(eventPath));
      const copy = resolveAuthFlowCopy(config).login;
      const user = userEvent.setup();
      render(
        <LoginDoor config={config} landing={landing} returnTarget={eventPath} />,
      );
      await user.click(screen.getByTestId("login-method-otp"));
      await user.type(screen.getByLabelText(copy.otp.emailLabel), "doc@clinic.ru");
      await user.click(screen.getByTestId("otp-send"));
      await screen.findByTestId("otp-verify");
      await user.click(screen.getByRole("textbox"));
      await user.keyboard("PVDC3R");

      await waitFor(() => expect(push).toHaveBeenCalledWith(eventPath));
      expect(loginWithOtp).toHaveBeenCalledTimes(1);
      expect(registerForEvent).toHaveBeenCalledWith("cardio-live");
    });

    it("014 EARS-6.10: a password reset started from the «Записаться» flow keeps the intent and completes it", async () => {
      openDoor(signUpEntry(eventPath));
      // «Забыли пароль?» carries the target onward (login door footer link).
      openDoor(signUpEntry(eventPath, config.routes.reset));
      expect(readStoredReturnTarget()).toBe(eventPath);

      // The reset door completes the target its route resolved from the URL.
      await expect(
        completeReturnTarget(config, eventPath, config.routes.account),
      ).resolves.toBe(eventPath);
      expect(registerForEvent).toHaveBeenCalledWith("cardio-live");
      expect(readStoredReturnTarget()).toBeNull();
    });

    it("014 EARS-6.10: a bare password-reset door is a new flow - the parked intent is dropped", () => {
      openDoor(signUpEntry(eventPath));
      openDoor(config.routes.reset);
      expect(readStoredReturnTarget()).toBeNull();
    });

    it("014 EARS-6.10: /register → /verify is unchanged - the confirmation completes the carried registration", async () => {
      openDoor(signUpEntry(eventPath, config.routes.register));
      openDoor(
        `${config.routes.verify}?email=doc%40clinic.ru&returnTo=${encodeURIComponent(eventPath)}`,
      );
      expect(readStoredReturnTarget()).toBe(eventPath);

      await expect(
        completeResolvedReturnTarget(config, eventPath, landing),
      ).resolves.toBe(eventPath);
      expect(registerForEvent).toHaveBeenCalledWith("cardio-live");
      expect(readStoredReturnTarget()).toBeNull();
    });
  },
);
