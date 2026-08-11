import { describe, expect, it } from "vitest";

import ru from "../messages/ru.json";
import {
  loginFailureFromMessage,
  loginFailureMessage,
  loginFailurePresentation,
} from "./login-failure";

/**
 * 011 EARS-3 + #1217 — what the LOGIN screen tells an operator when primary auth
 * is refused, decided in one place.
 *
 * The MFA screens already draw this distinction (`mfa-failure.ts`, #1213/#1215).
 * The login screen did not: a 503 from `POST /v1/admin/auth/login` — the IdP is
 * down, the password was never checked (#1212) — folded into «Проверьте данные»,
 * which is a verdict on credentials that are very probably correct. This mapping
 * is that product decision: an outage is a WARNING about the service, not a
 * DANGER verdict on what was typed.
 */
describe("loginFailurePresentation", () => {
  it("EARS-3: a plain refusal renders the uniform credentials message in danger", () => {
    expect(loginFailurePresentation({})).toEqual({
      messageKey: "errorGeneric",
      variant: "danger",
      testId: "login-error",
    });
  });

  it("EARS-3: a throttled refusal renders the wait message in danger", () => {
    expect(loginFailurePresentation({ throttled: true })).toEqual({
      messageKey: "errorThrottled",
      variant: "danger",
      testId: "login-error",
    });
  });

  it("EARS-3: an outage renders the service-unavailable message as a warning", () => {
    expect(loginFailurePresentation({ outage: true })).toEqual({
      messageKey: "errorOutage",
      variant: "warn",
      testId: "login-outage",
    });
  });

  it("EARS-3: an outage wins over throttling — the password was never checked", () => {
    expect(
      loginFailurePresentation({ outage: true, throttled: true }),
    ).toMatchObject({ messageKey: "errorOutage", variant: "warn" });
  });
});

/**
 * The provider cannot hand the screen an object: Refine's `login` result carries a
 * single `error.message` string. So the refusal crosses that boundary as its
 * catalog key and is re-read on the other side — this pins the round trip, which
 * is the only reason a 503 survives the provider at all.
 */
describe("loginFailureMessage ↔ loginFailureFromMessage", () => {
  for (const refusal of [
    {},
    { throttled: true },
    { outage: true },
  ] as const) {
    it(`EARS-3: ${JSON.stringify(refusal)} survives the Refine error-message boundary`, () => {
      expect(loginFailureFromMessage(loginFailureMessage(refusal))).toEqual(
        loginFailurePresentation(refusal),
      );
    });
  }

  it("EARS-3: the message is the catalog path the screen translates", () => {
    expect(loginFailureMessage({ outage: true })).toBe("login.errorOutage");
  });

  it("EARS-3: an unknown or absent message falls back to the uniform refusal", () => {
    expect(loginFailureFromMessage(undefined)).toEqual(
      loginFailurePresentation({}),
    );
    expect(loginFailureFromMessage("Failed to fetch")).toEqual(
      loginFailurePresentation({}),
    );
  });
});

/** EARS-12: RU copy comes from the typed catalog, never from the TSX. */
describe("RU catalog coverage", () => {
  it("EARS-12: the login block carries every failure message the screen can render", () => {
    expect(Object.keys(ru.login)).toEqual(
      expect.arrayContaining([
        loginFailurePresentation({}).messageKey,
        loginFailurePresentation({ throttled: true }).messageKey,
        loginFailurePresentation({ outage: true }).messageKey,
      ]),
    );
  });

  it("EARS-12: the outage copy names the service, not the operator's data", () => {
    expect(ru.login.errorOutage).toBe(
      "Сервис входа временно недоступен. Это не ошибка в данных — подождите минуту и попробуйте ещё раз.",
    );
  });
});
