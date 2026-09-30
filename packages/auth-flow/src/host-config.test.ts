import { describe, expect, expectTypeOf, it } from "vitest";
import { resolveAuthFlowCopy } from "./copy";

import type {
  AuthFlowApiConfig,
  AuthFlowHostConfig,
  AuthFlowLandingConfig,
  AuthFlowLoginCopy,
  AuthFlowReturnToConfig,
  AuthFlowRoutes,
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

  it("rows 29, 46 (#2455): parking is optional inside returnTo, and the return-context card is no host field — the canvas draws it on both hosts", () => {
    expectTypeOf<AuthFlowReturnToConfig["parkingCookie"]>().toMatchTypeOf<
      { name: string; maxAgeSeconds: number } | undefined
    >();
    expectTypeOf<
      keyof AuthFlowReturnToConfig
    >().toEqualTypeOf<"parkingCookie">();
    expect(DOCTOR_FIXTURE.returnTo).toBeUndefined();
    expect(ACADEMY_FIXTURE.returnTo?.parkingCookie?.name).toBe("ds_return_to");
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

  it("rows 65-77: the confirmation words are the canvas «Подтверждение» screen on every host", () => {
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      const copy = resolveAuthFlowCopy(config).verify;
      expect(copy.title).toBe("Проверьте почту");
      expect(copy.description).toBe(
        "Мы отправили код на {destination}. Введите его, чтобы завершить регистрацию.",
      );
      expect(copy.newAccountHeading).toBe("Новый аккаунт — введите код");
      expect(copy.codeAccepted).toBe("Код принят — входим…");
      expect(copy.failed).toBe("Код не подошёл. Попробуйте ещё раз.");
      expect(copy.resendAcknowledged).toContain("{destination}");
    }
  });
});
