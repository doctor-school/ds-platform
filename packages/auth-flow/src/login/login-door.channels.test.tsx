// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Wave-1 gate row 21 — the sign-in-code step offers exactly the channels this
 * host SERVES. `channels` already gated the identifier VALIDATION rule; the
 * visible choice has to follow it, or the doctor storefront draws an SMS tab
 * whose code the BFF never sends. A single-channel host has nothing to choose
 * between, so the row is absent rather than a lone locked button.
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

describe("the sign-in-code step offers the channels this host serves", () => {
  it("a host serving e-mail only draws no channel row and asks for the address", async () => {
    expect(DOCTOR_FIXTURE.channels).toEqual(["email"]);
    await openCodeStep(DOCTOR_FIXTURE);

    expect(screen.queryByTestId("otp-channel-sms")).toBeNull();
    expect(screen.queryByTestId("otp-channel-email")).toBeNull();
    expect(screen.getByLabelText(COPY.otp.emailLabel)).toBeInTheDocument();
  });

  it("a host serving both channels lets the visitor pick between them", async () => {
    expect(ACADEMY_FIXTURE.channels).toEqual(["email", "sms"]);
    await openCodeStep(ACADEMY_FIXTURE);

    expect(screen.getByTestId("otp-channel-email")).toBeInTheDocument();
    expect(screen.getByTestId("otp-channel-sms")).toBeInTheDocument();
    // Canvas 106: the group names itself above the buttons, not only to a reader.
    expect(screen.getByText(COPY.otp.channelGroupLabel)).toBeInTheDocument();
  });
});
