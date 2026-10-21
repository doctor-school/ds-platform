import { describe, expect, it } from "vitest";

import { ACADEMY_AUTH_FLOW, DOCTOR_AUTH_FLOW } from "../hosts";
import {
  signInHostConfig,
  signInHostSearchParams,
  type SignInHostRender,
} from "./sign-in-host";

const RENDER: SignInHostRender = {
  action: "render",
  storefront: "doctor",
  door: "login",
  authRequest: "V2_123",
  csrf: "csrf-token",
};

/**
 * 003 EARS-60 / 70 / 71 (#3170) — the sign-in host renders the storefront's
 * own config and varies only the transport; the door's params come from the
 * entry answer alone.
 */
describe("003 EARS-60: the sign-in host projects the storefront config onto its transport", () => {
  it("003 EARS-60: the doctor config keeps every field and posts to the host mirror of its commands", () => {
    const config = signInHostConfig(DOCTOR_AUTH_FLOW, RENDER);
    expect(config.api).toEqual({
      basePath: "/v1/sign-in-host",
      registerPath: "/v1/sign-in-host/storefront/doctor/register",
      verifyPath: "/v1/sign-in-host/storefront/doctor/verify",
      formPost: { authRequest: "V2_123", csrf: "csrf-token" },
    });
    expect(config.consents).toBe(DOCTOR_AUTH_FLOW.consents);
    expect(config.brand).toBe(DOCTOR_AUTH_FLOW.brand);
    expect(config.register).toBe(DOCTOR_AUTH_FLOW.register);
    expect(config.routes.register).toBe("/register?authRequest=V2_123");
    expect(config.routes.eventPathTemplate).toBe("/events/:slug");
  });

  it("003 EARS-60: the Academy config posts to the host mirror of the 003 commands", () => {
    const config = signInHostConfig(ACADEMY_AUTH_FLOW, {
      ...RENDER,
      storefront: "academy",
    });
    expect(config.api.registerPath).toBe("/v1/sign-in-host/register");
    expect(config.api.verifyPath).toBe("/v1/sign-in-host/verify");
    expect(config.copy).toBe(ACADEMY_AUTH_FLOW.copy);
  });

  it("003 EARS-71: a hand-off intent marks the reference as held server-side", () => {
    const config = signInHostConfig(DOCTOR_AUTH_FLOW, {
      ...RENDER,
      intent: { handoff: true, method: "code" },
    });
    expect(config.api.formPost?.handoff).toBe(true);
  });
});

describe("003 EARS-71: the door's params come only from the resolved intent", () => {
  it("003 EARS-71: an intent with an event target opens the card on this storefront's event path, with its method", () => {
    const params = signInHostSearchParams(
      DOCTOR_AUTH_FLOW,
      {
        ...RENDER,
        intent: {
          handoff: false,
          method: "code",
          eventTarget: "spring-congress",
        },
      },
      {},
      "login",
    );
    expect(params).toEqual({
      method: "code",
      returnTo: "/events/spring-congress",
    });
  });

  it("003 EARS-71: a missing (unknown, spent or foreign) intent is the plain form — browser params are dropped", () => {
    expect(
      signInHostSearchParams(
        ACADEMY_AUTH_FLOW,
        RENDER,
        { returnTo: "/webinars/x", method: "code", handoff: "a".repeat(43) },
        "login",
      ),
    ).toEqual({});
  });

  it("003 EARS-71: the registration door shows the card from the intent; the verify door keeps only the address", () => {
    const render = {
      ...RENDER,
      intent: { handoff: false, eventTarget: "e1" },
    };
    expect(
      signInHostSearchParams(ACADEMY_AUTH_FLOW, render, {}, "register"),
    ).toEqual({ returnTo: "/webinars/e1" });
    expect(
      signInHostSearchParams(
        ACADEMY_AUTH_FLOW,
        render,
        { email: "a@b.ru", returnTo: "/x" },
        "verify",
      ),
    ).toEqual({ email: "a@b.ru" });
  });
});
