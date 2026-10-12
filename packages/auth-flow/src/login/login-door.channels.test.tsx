// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Wave-1 gate row 21 — the sign-in-code step offers the channels the package
 * serves: e-mail and SMS on every storefront (#2443, `AUTH_FLOW_CHANNELS`). The
 * same constant gates the OTP request shape, so the visible choice and the
 * request that can be built never disagree.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({
    login: vi.fn(),
    requestOtp: vi.fn(),
    loginWithOtp: vi.fn(),
  }),
}));

vi.mock("@ds/events-storefront/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/client")>()),
  registerForEvent: vi.fn().mockResolvedValue({ registered: true }),
}));

import { resolveAuthFlowCopy } from "../copy";
import type { AuthFlowHostConfig } from "../host-config";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { LoginDoor } from "./login-door";

afterEach(cleanup);

const COPY = resolveAuthFlowCopy(DOCTOR_FIXTURE).login;

async function openCodeStep(config: AuthFlowHostConfig) {
  const user = userEvent.setup();
  render(<LoginDoor config={config} landing={config.landing.afterLogin} />);
  await user.click(screen.getByTestId("login-method-otp"));
}

describe("the sign-in-code step offers the package channels on every storefront (#2443)", () => {
  it.each([
    ["the Academy", ACADEMY_FIXTURE],
    ["the doctor storefront", DOCTOR_FIXTURE],
  ])(
    "%s lets the visitor pick between e-mail and SMS",
    async (_host, config) => {
      await openCodeStep(config);

      expect(screen.getByTestId("otp-channel-email")).toBeInTheDocument();
      expect(screen.getByTestId("otp-channel-sms")).toBeInTheDocument();
      // Canvas 106: the group names itself above the buttons, not only to a reader.
      expect(screen.getByText(COPY.otp.channelGroupLabel)).toBeInTheDocument();
    },
  );
});

/**
 * 003 EARS-55 (a) / EARS-59 — the static SMS hint under «Канал кода»: shown
 * only while «SMS» is selected, identical for every visitor (it reads nothing
 * but the visitor's own selection, EARS-16), and the same package sentence on
 * both storefronts — a host supplies no copy of its own.
 */
describe("003 EARS-55: the SMS hint under the code-channel switch", () => {
  it.each([
    ["the Academy", ACADEMY_FIXTURE],
    ["the doctor storefront", DOCTOR_FIXTURE],
  ])(
    "003 EARS-55: on %s the hint shows only while «SMS» is selected",
    async (_host, config) => {
      const hint = resolveAuthFlowCopy(config).login.otp.channelSmsHint;
      const user = userEvent.setup();
      render(<LoginDoor config={config} landing={config.landing.afterLogin} />);
      await user.click(screen.getByTestId("login-method-otp"));

      expect(screen.queryByText(hint)).toBeNull();
      await user.click(screen.getByTestId("otp-channel-sms"));
      expect(screen.getByText(hint)).toBeInTheDocument();
      // Identical whatever is typed: no lookup, no per-input variant.
      await user.type(screen.getByLabelText(COPY.otp.phoneLabel), "9991234567");
      expect(screen.getByText(hint)).toBeInTheDocument();
      await user.click(screen.getByTestId("otp-channel-email"));
      expect(screen.queryByText(hint)).toBeNull();
    },
  );

  it("003 EARS-59: both storefronts draw the one package sentence, verbatim from the canvas", () => {
    const academy = resolveAuthFlowCopy(ACADEMY_FIXTURE).login.otp;
    const doctor = resolveAuthFlowCopy(DOCTOR_FIXTURE).login.otp;
    expect(academy.channelSmsHint).toBe(doctor.channelSmsHint);
    expect(academy.channelSmsHint).toBe(
      "Код по SMS придёт, только если телефон подтверждён в профиле. Если нет — выберите «Эл. почта».",
    );
  });
});
