import { describe, expect, expectTypeOf, it } from "vitest";
import { resolveAuthFlowCopy } from "./copy";

import type {
  AuthFlowApiConfig,
  AuthFlowHostConfig,
  AuthFlowLandingConfig,
  AuthFlowLoginCopy,
  AuthFlowRoutes,
} from "./host-config";
import {
  AUTH_FLOW_CHANNELS,
  AUTH_FLOW_PRODUCT_DIFFERENCE_FIELDS,
  RETURN_TARGET_PARKING,
  SIGN_OUT_DESTINATION,
  authenticatedAllowedRoutes,
} from "./host-config";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "./test-support/host-config-fixtures";

/**
 * #2027 PR 1.5 — the host config grows the DATA the sign-in door consumes.
 *
 * Every assertion here is about a value shape, never a callback: the wave-1
 * adapter list is closed and empty (gate §4.3), so a field that could only be
 * expressed as a function would be a STOP question, not a type.
 */
describe("#2027 PR 1.5 host config — the sign-in door data", () => {
  it("row 41: each host states its default landing as a path", () => {
    expectTypeOf<
      AuthFlowHostConfig["landing"]
    >().toEqualTypeOf<AuthFlowLandingConfig>();
    expect(ACADEMY_FIXTURE.landing).toEqual({
      afterLogin: "/webinars",
      specialtyAware: false,
    });
    expect(DOCTOR_FIXTURE.landing.afterLogin).toBe("/");
  });

  it("row 38: a specialty-aware host names the two remembered-specialty reads and the feed, as strings", () => {
    const landing = DOCTOR_FIXTURE.landing;
    expect(landing.specialtyAware).toBe(true);
    if (!landing.specialtyAware) throw new Error("unreachable");
    expect(landing.specialtyFeed).toBe("/events");
    expect(landing.specialtyEndpoints).toEqual({
      signedIn: "/v1/me/specialty",
      guest: "/v1/public/specialty-choice",
      consumptionDeferredHeader: "x-ds-specialty-consumption-deferred",
    });
  });

  it("rows 39, 42: the event page and the room are route TEMPLATES, not parsers", () => {
    expect(ACADEMY_FIXTURE.routes.eventPathTemplate).toBe("/webinars/:slug");
    expect(ACADEMY_FIXTURE.routes.room).toBe("/webinars/:slug/room");
    expect(DOCTOR_FIXTURE.routes.eventPathTemplate).toBe("/events/:slug");
    expect(DOCTOR_FIXTURE.routes.room).toBe("/events/:slug/room");
  });

  it("rows 29, 46 (#2443, #2455): return-target parking is ONE package mechanism — no host states it, and the return-context card is no host field", () => {
    expect(RETURN_TARGET_PARKING).toEqual({
      name: "ds_return_to",
      maxAgeSeconds: 900,
    });
    expectTypeOf<AuthFlowHostConfig>().not.toHaveProperty("returnTo");
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      expect(config).not.toHaveProperty("returnTo");
    }
  });

  it("row 33: login copy crosses the server→client boundary — templates are strings with placeholders", () => {
    expectTypeOf<AuthFlowLoginCopy["otp"]["sentTo"]>().toEqualTypeOf<string>();
    expectTypeOf<
      AuthFlowLoginCopy["otp"]["resendCountdown"]
    >().toEqualTypeOf<string>();
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      expect(resolveAuthFlowCopy(config).login.otp.sentTo).toContain(
        "{destination}",
      );
      expect(resolveAuthFlowCopy(config).login.otp.resendCountdown).toContain(
        "{seconds}",
      );
      expect(JSON.parse(JSON.stringify(config))).toEqual(config);
    }
  });

  it("row 44: the field copy carries the identifier and phone entries the door resolver reads", () => {
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      expect(resolveAuthFlowCopy(config).fields.identifier.invalid).toEqual(
        expect.any(String),
      );
      expect(resolveAuthFlowCopy(config).fields.phone.invalid).toEqual(
        expect.any(String),
      );
    }
  });
});

describe("#2027 PR 1.7 host config — the confirmation step", () => {
  it("003 EARS-24 (#2455): every host confirms on a /verify route of its own — the route is required and no mechanism switch exists", () => {
    expectTypeOf<AuthFlowRoutes["verify"]>().toEqualTypeOf<string>();
    expectTypeOf<AuthFlowHostConfig>().not.toHaveProperty("verify");
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      expect(config.routes.verify).toBe("/verify");
      expect(config).not.toHaveProperty("verify");
    }
  });

  it("003 EARS-3 (#2455): the confirm command is not host data — both hosts post the one 003 command", () => {
    expectTypeOf<AuthFlowApiConfig>().not.toHaveProperty("confirmPath");
    expectTypeOf<AuthFlowApiConfig>().not.toHaveProperty(
      "confirmCarriesReturnTarget",
    );
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      expect(config.api).not.toHaveProperty("confirmPath");
      expect(config.api).not.toHaveProperty("confirmCarriesReturnTarget");
    }
  });

  it("003 EARS-42: the confirmation words are the canvas «ШАГ КОДА» on every host", () => {
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      const copy = resolveAuthFlowCopy(config).verify;
      expect(copy.title).toBe("Проверьте почту");
      expect(copy.description).toBe("Мы отправили код на {destination}.");
      expect(copy.codeLabel).toBe("Код из письма");
      expect(copy.submit).toBe("Подтвердить и войти");
      expect(copy.back).toBe("← Изменить почту");
      expect(copy.codeAccepted).toBe("Код принят — входим…");
      expect(copy.failed).toBe("Код не подошёл. Попробуйте ещё раз.");
      expect(copy.resendAcknowledged).toBe(
        "Мы отправили новый код на {destination}.",
      );
      expect(copy).not.toHaveProperty("existingAccountHeading");
      expect(copy).not.toHaveProperty("goToSignIn");
    }
  });

  it("003 EARS-42: sign-in by code says the same step's words, per channel, on every host", () => {
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      const otp = resolveAuthFlowCopy(config).login.otp;
      expect(otp.verifyTitle).toEqual({
        email: "Проверьте почту",
        sms: "Проверьте телефон",
      });
      expect(otp.sentTo).toBe("Мы отправили код на {destination}.");
      expect(otp.codeLabel).toEqual({
        email: "Код из письма",
        sms: "Код из сообщения",
      });
      expect(otp.verifySubmit).toBe("Подтвердить и войти");
      expect(otp.changeMethod).toBe("← Изменить способ");
      expect(otp.resentTo).toBe("Мы отправили новый код на {destination}.");
    }
  });

  it("003 EARS-41: each host names its own code-step verify command", () => {
    expect(ACADEMY_FIXTURE.api.verifyPath).toBe("/v1/auth/verify");
    expect(DOCTOR_FIXTURE.api.verifyPath).toBe("/v1/storefront/doctor/verify");
  });
});

describe("#2443 auth-flow mechanics are package constants, product differences are declared", () => {
  it("the sign-in-code channels are one package constant — email and SMS — and no host states them", () => {
    expect(AUTH_FLOW_CHANNELS).toEqual(["email", "sms"]);
    expectTypeOf<AuthFlowHostConfig>().not.toHaveProperty("channels");
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      expect(config).not.toHaveProperty("channels");
    }
  });

  it("003 EARS-10: the post-sign-out destination is one package constant — the storefront home — and no host states it (#2488)", () => {
    expect(SIGN_OUT_DESTINATION).toBe("/");
    expectTypeOf<AuthFlowHostConfig>().not.toHaveProperty("signOut");
    expectTypeOf<AuthFlowRoutes>().not.toHaveProperty("signOut");
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      expect(config).not.toHaveProperty("signOut");
      expect(config.routes).not.toHaveProperty("signOut");
    }
  });

  it("003 EARS-28: the auth routes open to a signed-in visitor are derived from the reset route, never host data", () => {
    expectTypeOf<AuthFlowRoutes>().not.toHaveProperty("allowAuthenticated");
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      expect(config.routes).not.toHaveProperty("allowAuthenticated");
      expect(authenticatedAllowedRoutes(config.routes)).toEqual(["/reset"]);
    }
    expect(
      authenticatedAllowedRoutes({
        ...DOCTOR_FIXTURE.routes,
        reset: "/recover",
      }),
    ).toEqual(["/recover"]);
  });

  it("the product-difference manifest lists exactly the agreed storefront differences, each with its spec clause", () => {
    expect(
      AUTH_FLOW_PRODUCT_DIFFERENCE_FIELDS.map((entry) => entry.field),
    ).toEqual(["register.promoField", "landing.specialtyAware", "consents"]);
    for (const entry of AUTH_FLOW_PRODUCT_DIFFERENCE_FIELDS) {
      expect(entry.spec).toMatch(
        /^apps\/docs\/content\/specs\/features\/\d{3}-[a-z0-9-]+\/\d{3}-requirements-en\.md$/,
      );
      expect(entry.clauses.length).toBeGreaterThan(0);
      for (const clause of entry.clauses)
        expect(clause).toMatch(/^\d{3} (EARS|LD)-\d+$/);
    }
  });
});
