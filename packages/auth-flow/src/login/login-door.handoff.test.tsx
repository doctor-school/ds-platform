// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 003 EARS-44 — the door redeems a Congress hand-off reference ONCE per page
 * load. A live reference sent the code and names the address, so the card opens
 * straight on the EARS-42 code step; a refused one (unknown, expired, exhausted —
 * one body for all) falls back silently to the EARS-43 state, and an EARS-13
 * refusal shows the generic throttled sentence every code request shows. In
 * every case `handoff` leaves the address bar by history replace, keeping
 * `method` and `returnTo`. Run over BOTH hosts: package behaviour, never a branch.
 *
 * Mocked seams: the BFF factory (`createAuthClient`) and the router.
 */
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const requestOtp = vi.fn();
const loginWithOtp = vi.fn();
const redeemLoginHandoff = vi.fn();
vi.mock("../client/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/auth-client")>()),
  createAuthClient: () => ({
    login: vi.fn(),
    requestOtp,
    loginWithOtp,
    redeemLoginHandoff,
  }),
}));

vi.mock("@ds/events-storefront/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/client")>()),
  registerForEvent: vi.fn().mockResolvedValue(undefined),
}));

import { AuthError } from "../client/auth-client";
import { resolveAuthFlowCopy } from "../copy";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { LoginDoor } from "./login-door";

const HOSTS = [
  ["the Academy", ACADEMY_FIXTURE],
  ["the doctor storefront", DOCTOR_FIXTURE],
] as const;

const COPY = resolveAuthFlowCopy(DOCTOR_FIXTURE).login;
const ERRORS = resolveAuthFlowCopy(DOCTOR_FIXTURE).errors;
const EMAIL = "doc@clinic.ru";
const REF = "Ab-_0123456789abcdefghijklmnopqrstuvwxyzABC";

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  requestOtp.mockReset().mockResolvedValue(undefined);
  loginWithOtp.mockReset().mockResolvedValue(undefined);
  redeemLoginHandoff.mockReset();
  document.elementFromPoint = () => document.body;
  window.history.replaceState(
    null,
    "",
    `/login?method=code&handoff=${REF}&returnTo=%2Faccount`,
  );
});

afterEach(cleanup);

function renderDoor(
  config: typeof DOCTOR_FIXTURE | typeof ACADEMY_FIXTURE,
  handoffRef: string | null = REF,
) {
  return render(
    <StrictMode>
      <LoginDoor
        config={config}
        landing="/account"
        returnTo="/account"
        defaultMethod="otp"
        handoffRef={handoffRef}
      />
    </StrictMode>,
  );
}

/** The address bar as the visitor sees it now. */
function addressBar(): string {
  return `${window.location.pathname}${window.location.search}`;
}

describe("003 EARS-44: /login redeems the Congress hand-off into the code step", () => {
  it.each(HOSTS)(
    "003 EARS-44: on %s a live reference opens the code step with the returned address, redeemed once",
    async (_host, config) => {
      redeemLoginHandoff.mockResolvedValue({
        status: "otp_sent",
        identifier: EMAIL,
      });

      renderDoor(config);

      await screen.findByTestId("otp-verify");
      expect(screen.getByText(COPY.otp.verifyTitle.email)).toBeInTheDocument();
      expect(screen.getByText(EMAIL).parentElement).toHaveTextContent(
        `Мы отправили код на ${EMAIL}.`,
      );
      // Once per page load — even under StrictMode's double effect.
      expect(redeemLoginHandoff).toHaveBeenCalledTimes(1);
      expect(redeemLoginHandoff).toHaveBeenCalledWith({ ref: REF });
      // The hand-off sent the code itself: no second, captcha-gated request.
      expect(requestOtp).not.toHaveBeenCalled();
      expect(addressBar()).toBe("/login?method=code&returnTo=%2Faccount");
    },
  );

  it("003 EARS-44: the typed code signs in for the returned address on the email channel", async () => {
    redeemLoginHandoff.mockResolvedValue({
      status: "otp_sent",
      identifier: EMAIL,
    });
    const user = userEvent.setup();
    renderDoor(DOCTOR_FIXTURE);
    await screen.findByTestId("otp-verify");

    await user.click(screen.getByRole("textbox"));
    await user.keyboard("PVDC3R");

    await waitFor(() =>
      expect(loginWithOtp).toHaveBeenCalledWith({
        identifier: EMAIL,
        code: "PVDC3R",
        channel: "email",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/account"));
  });

  it.each(HOSTS)(
    "003 EARS-44: on %s a refused reference falls back silently to «По коду» with an empty field",
    async (_host, config) => {
      redeemLoginHandoff.mockResolvedValue({ status: "handoff_refused" });

      renderDoor(config);

      await waitFor(() => expect(redeemLoginHandoff).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByTestId("otp-send")).not.toBeDisabled(),
      );
      expect(screen.queryByTestId("otp-verify")).toBeNull();
      expect(
        screen.getByTestId("login-method-otp").getAttribute("aria-selected"),
      ).toBe("true");
      expect(screen.getByTestId("otp-identifier")).toHaveValue("");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(addressBar()).toBe("/login?method=code&returnTo=%2Faccount");
    },
  );

  it("003 EARS-44: an EARS-13 refusal shows the generic throttled sentence on the EARS-43 state", async () => {
    redeemLoginHandoff.mockRejectedValue(
      new AuthError(429, "Too Many Requests"),
    );

    renderDoor(DOCTOR_FIXTURE);

    expect(await screen.findByText(ERRORS.tooManyAttempts)).toBeInTheDocument();
    expect(screen.queryByTestId("otp-verify")).toBeNull();
    expect(screen.getByTestId("otp-identifier")).toHaveValue("");
    expect(addressBar()).toBe("/login?method=code&returnTo=%2Faccount");
  });

  it("003 EARS-44: a malformed reference (not handed over by the mount) sends nothing, and is still stripped", async () => {
    window.history.replaceState(
      null,
      "",
      "/login?method=code&handoff=garbage&returnTo=%2Faccount",
    );

    renderDoor(DOCTOR_FIXTURE, null);

    await waitFor(() =>
      expect(addressBar()).toBe("/login?method=code&returnTo=%2Faccount"),
    );
    expect(redeemLoginHandoff).not.toHaveBeenCalled();
    expect(screen.queryByTestId("otp-verify")).toBeNull();
  });

  it("003 EARS-44: resend after a hand-off re-requests the same address through the normal code request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      redeemLoginHandoff.mockResolvedValue({
        status: "otp_sent",
        identifier: EMAIL,
      });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderDoor(DOCTOR_FIXTURE);
      await screen.findByTestId("otp-verify");

      act(() => vi.advanceTimersByTime(60_000));
      await user.click(screen.getByTestId("otp-resend"));

      await waitFor(() =>
        expect(requestOtp).toHaveBeenCalledWith(
          { identifier: EMAIL, channel: "email" },
          undefined,
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
