import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  AuthFlowHostConfig,
  AuthFlowLandingConfig,
  AuthFlowLoginCopy,
  AuthFlowReturnToConfig,
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
    expect(DOCTOR_FIXTURE.routes.room).toBeUndefined();
  });

  it("rows 29, 46: parking is optional inside returnTo, and the card is a flag", () => {
    expectTypeOf<AuthFlowReturnToConfig["parkingCookie"]>().toMatchTypeOf<
      { name: string; maxAgeSeconds: number } | undefined
    >();
    expect(DOCTOR_FIXTURE.returnTo).toEqual({ card: true });
    expect(ACADEMY_FIXTURE.returnTo?.card).toBeUndefined();
    expect(ACADEMY_FIXTURE.returnTo?.parkingCookie?.name).toBe("ds_return_to");
  });

  it("row 33: login copy crosses the server→client boundary — templates are strings with placeholders", () => {
    expectTypeOf<AuthFlowLoginCopy["otp"]["sentTo"]>().toEqualTypeOf<string>();
    expectTypeOf<
      AuthFlowLoginCopy["otp"]["resendCountdown"]
    >().toEqualTypeOf<string>();
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      expect(config.copy.login.otp.sentTo).toContain("{destination}");
      expect(config.copy.login.otp.resendCountdown).toContain("{seconds}");
      expect(JSON.parse(JSON.stringify(config))).toEqual(config);
    }
  });

  it("row 44: the field copy carries the identifier and phone entries the door resolver reads", () => {
    for (const config of [ACADEMY_FIXTURE, DOCTOR_FIXTURE]) {
      expect(config.copy.fields.identifier.invalid).toEqual(expect.any(String));
      expect(config.copy.fields.phone.invalid).toEqual(expect.any(String));
    }
  });
});
