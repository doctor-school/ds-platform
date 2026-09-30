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
