import { describe, expect, it } from "vitest";

import { AuthError } from "../client/auth-client";
import { resolveAuthFlowCopy } from "../copy";
import { authErrorMessage } from "./auth-error-message";
import { DOCTOR_FIXTURE } from "../test-support/host-config-fixtures";

/**
 * #1933 — the EARS-16 branching rule, now owned once (#2027).
 *
 * The point of these cases is not the wording but the DIVIDE: a status that is
 * an account oracle must never produce a distinguishable message, and a status
 * that is not one must never be flattened into the generic. Both halves are
 * asserted, because a regression in either direction is invisible in the UI —
 * the oracle leak looks like helpfulness, and the flattening looks like caution.
 */
const COPY = resolveAuthFlowCopy(DOCTOR_FIXTURE).errors;

const GENERIC = {
  login: "Не удалось войти. Проверьте почту или телефон и пароль.",
  otpVerify: "Код не подошёл. Проверьте цифры или запросите новый.",
  confirm: "Код не подошёл. Проверьте цифры или запросите новый.",
} as const;

describe("017 #1933: the auth error mapper", () => {
  it("017 #1933.1: 401 and 400 stay the caller neutral generic (no existence oracle)", () => {
    for (const status of [400, 401, 403, 404]) {
      expect(
        authErrorMessage(new AuthError(status, "unauthorized"), COPY, GENERIC.login),
      ).toBe(GENERIC.login);
    }
  });

  it("017 #1933.2: the generic is the CALLER own — a verify failure never says «войти»", () => {
    expect(
      authErrorMessage(new AuthError(401, "bad code"), COPY, GENERIC.otpVerify),
    ).toBe(GENERIC.otpVerify);
  });

  it("017 #1933.3: 429 is a rate limit, not an oracle — it gets its own actionable RU copy", () => {
    const message = authErrorMessage(
      new AuthError(429, "too many"),
      COPY,
      GENERIC.login,
    );
    expect(message).not.toBe(GENERIC.login);
    expect(message).toBe(COPY.tooManyAttempts);
  });

  it("017 #1933.4: 5xx and a rejected fetch both read as availability, never as a wrong password", () => {
    const server = authErrorMessage(
      new AuthError(503, "down"),
      COPY,
      GENERIC.login,
    );
    const network = authErrorMessage(
      new TypeError("Failed to fetch"),
      COPY,
      GENERIC.login,
    );
    expect(server).toBe(COPY.unavailable);
    expect(network).toBe(server);
  });

  it("017 #1933.5: a bot-protection refusal names the real obstacle (#1558), not the credential", () => {
    expect(
      authErrorMessage(
        new AuthError(403, "captcha", "BOT_PROTECTION_REQUIRED"),
        COPY,
        GENERIC.login,
      ),
    ).toBe(COPY.botProtectionRequired);
    expect(
      authErrorMessage(
        new AuthError(403, "captcha", "BOT_PROTECTION_REJECTED"),
        COPY,
        GENERIC.login,
      ),
    ).toBe(COPY.botProtectionRejected);
  });

  it("017 #1933.10: a 429 on the confirmation step reads as a rate limit, never «Код не подошёл» (#2001)", () => {
    // The confirmation step used to swallow every failure into one generic, so
    // eleven wrong codes inside the 15-minute window told the doctor the CODE
    // was wrong while the api was actually refusing the attempt rate.
    expect(
      authErrorMessage(new AuthError(429, "too many"), COPY, GENERIC.confirm),
    ).toBe(COPY.tooManyAttempts);
    expect(
      authErrorMessage(new AuthError(400, "bad code"), COPY, GENERIC.confirm),
    ).toBe(GENERIC.confirm);
  });
});
