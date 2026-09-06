import { describe, expect, it } from "vitest";

import { AuthError } from "./auth-client";
import {
  AUTH_GENERIC_MESSAGES,
  authErrorMessage,
} from "./auth-error-message";

/**
 * #1933 — the EARS-16 branching rule on the doctor host.
 *
 * The point of these cases is not the wording but the DIVIDE: a status that is
 * an account oracle must never produce a distinguishable message, and a status
 * that is not one must never be flattened into the generic. Both halves are
 * asserted, because a regression in either direction is invisible in the UI —
 * the oracle leak looks like helpfulness, and the flattening looks like caution.
 */
describe("017 #1933: the doctor auth error mapper", () => {
  it("017 #1933.1: 401 and 400 stay the caller neutral generic (no existence oracle)", () => {
    for (const status of [400, 401, 403, 404]) {
      expect(
        authErrorMessage(
          new AuthError(status, "unauthorized"),
          AUTH_GENERIC_MESSAGES.login,
        ),
      ).toBe(AUTH_GENERIC_MESSAGES.login);
    }
  });

  it("017 #1933.2: the generic is the CALLER own — a verify failure never says «войти»", () => {
    expect(
      authErrorMessage(
        new AuthError(401, "bad code"),
        AUTH_GENERIC_MESSAGES.otpVerify,
      ),
    ).toBe(AUTH_GENERIC_MESSAGES.otpVerify);
  });

  it("017 #1933.3: 429 is a rate limit, not an oracle — it gets its own actionable RU copy", () => {
    const message = authErrorMessage(
      new AuthError(429, "too many"),
      AUTH_GENERIC_MESSAGES.login,
    );
    expect(message).not.toBe(AUTH_GENERIC_MESSAGES.login);
    expect(message).toContain("Слишком много попыток");
  });

  it("017 #1933.4: 5xx and a rejected fetch both read as availability, never as a wrong password", () => {
    const server = authErrorMessage(
      new AuthError(503, "down"),
      AUTH_GENERIC_MESSAGES.login,
    );
    const network = authErrorMessage(
      new TypeError("Failed to fetch"),
      AUTH_GENERIC_MESSAGES.login,
    );
    expect(server).toContain("временно недоступен");
    expect(network).toBe(server);
  });

  it("017 #1933.5: a bot-protection refusal names the real obstacle (#1558), not the credential", () => {
    for (const code of ["BOT_PROTECTION_REQUIRED", "BOT_PROTECTION_REJECTED"]) {
      const message = authErrorMessage(
        new AuthError(403, "captcha", code),
        AUTH_GENERIC_MESSAGES.login,
      );
      expect(message).toContain("дополнительная проверка");
      expect(message).not.toBe(AUTH_GENERIC_MESSAGES.login);
    }
  });
});
