import {
  Children,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 003 EARS-60 / 71 (#3170) — the sign-in host's ONE page mount, read as an
 * element: which storefront's door it mounts, with which config and params,
 * is decided only by the proxy's hand-over of the API entry answer. The door
 * bodies are the storefronts' own routes, pinned by their own tests.
 *
 * Mocked seams: the request headers and Next's `notFound` throw.
 */
const { requestHeaders, notFound } = vi.hoisted(() => ({
  requestHeaders: { value: new Headers() },
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/headers", () => ({ headers: async () => requestHeaders.value }));
vi.mock("next/navigation", () => ({
  notFound,
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { DEFAULT_AUTH_FLOW_COPY } from "../copy";
import type { AuthFlowHostConfig } from "../host-config";
import { ACADEMY_AUTH_FLOW, DOCTOR_AUTH_FLOW } from "../hosts";
import { LoginRoute } from "../login/login-route";
import { RegisterRoute } from "../register/register-route";
import { ResetRoute } from "../reset/reset-route";
import {
  SIGN_IN_HOST_ENTRY_HEADER,
  SIGN_IN_HOST_UNAVAILABLE_HEADER,
  signInHostConfig,
  writeSignInHostHandOver,
  type SignInHostHandOver,
  type SignInHostRender,
} from "../server/sign-in-host";
import { VerifyRoute } from "../verify/verify-route";
import { SettleDoorPath } from "./settle-door-path";
import { AUTH_FLOW_PAGE_TITLES } from "../copy";
import { SignInHostRoute, signInHostMetadata } from "./sign-in-host-route";

const STOREFRONTS = { academy: ACADEMY_AUTH_FLOW, doctor: DOCTOR_AUTH_FLOW };

const RENDER: SignInHostRender = {
  action: "render",
  storefront: "doctor",
  door: "login",
  authRequest: "V2_1",
  csrf: "csrf-1",
};

type Params = Record<string, string | string[] | undefined>;
type DoorElement = ReactElement<{
  config: unknown;
  searchParams: Promise<Params>;
}>;

function handOver(value: SignInHostHandOver | string | null) {
  const headers = new Headers();
  if (value !== null) {
    headers.set(
      SIGN_IN_HOST_ENTRY_HEADER,
      typeof value === "string" ? value : writeSignInHostHandOver(value),
    );
  }
  requestHeaders.value = headers;
}

async function mountPage(browser: Params = {}) {
  return (await SignInHostRoute({
    storefronts: STOREFRONTS,
    searchParams: Promise.resolve(browser),
  })) as ReactElement<{ children?: ReactNode }>;
}

/** The mounted storefront door (beside it the mount settles the address). */
async function mount(browser: Params = {}) {
  const page = await mountPage(browser);
  if (page.type !== Fragment) return page as DoorElement;
  return Children.toArray(page.props.children).find(
    (child) => isValidElement(child) && child.type !== SettleDoorPath,
  ) as DoorElement;
}

beforeEach(() => {
  notFound.mockClear();
});

describe("003 EARS-60: the mounted storefront comes only from the entry hand-over", () => {
  it("003 EARS-60: a doctor render mounts the doctor storefront's login door on the host transport", async () => {
    handOver({ door: "login", render: RENDER });
    const el = await mount();
    expect(el.type).toBe(LoginRoute);
    expect(el.props.config).toEqual(signInHostConfig(DOCTOR_AUTH_FLOW, RENDER));
  });

  it("003 EARS-60: an Academy render mounts the Academy's config", async () => {
    const render = { ...RENDER, storefront: "academy" } as const;
    handOver({ door: "login", render });
    const el = await mount();
    expect(el.props.config).toEqual(
      signInHostConfig(ACADEMY_AUTH_FLOW, render),
    );
  });

  it.each(["academy", "doctor"] as const)(
    "003 EARS-60: S156 %s registration ignores a forged storefront, fields, consents, brand and transport in URL/cookies",
    async (storefront) => {
      const foreign = storefront === "academy" ? "doctor" : "academy";
      const render = { ...RENDER, storefront, door: "register" } as const;
      handOver({ door: "register", render });
      requestHeaders.value.set(
        "cookie",
        `storefront=${foreign}; client_id=${foreign}; wordingVersion=evil; registerPath=/evil`,
      );
      requestHeaders.value.set("x-storefront", foreign);
      const el = await mount({
        storefront: foreign,
        client_id: foreign,
        promoField: "true",
        medicalWorkerDeclaration: "false",
        wordingVersion: "evil",
        brand: "attacker",
        registerPath: "/evil",
        authRequest: "foreign-request",
        csrf: "foreign-csrf",
      });
      const config = el.props.config as AuthFlowHostConfig;
      const original = STOREFRONTS[storefront];
      expect(el.type).toBe(RegisterRoute);
      expect(config.register).toEqual(original.register);
      expect(config.consents).toEqual(original.consents);
      expect(config.brand).toEqual(original.brand);
      expect(config.copy).toEqual(original.copy);
      expect(config.consents?.wordingVersion).toBe(
        storefront === "academy" ? "2026-01" : "2026-09-22",
      );
      expect(config.api).toEqual({
        basePath: "/v1/sign-in-host",
        registerPath:
          storefront === "academy"
            ? "/v1/sign-in-host/register"
            : "/v1/sign-in-host/storefront/doctor/register",
        verifyPath:
          storefront === "academy"
            ? "/v1/sign-in-host/verify"
            : "/v1/sign-in-host/storefront/doctor/verify",
        formPost: { authRequest: RENDER.authRequest, csrf: RENDER.csrf },
      });
      expect(await el.props.searchParams).toEqual({});
      for (const door of ["login", "register", "verify", "reset"] as const) {
        expect(config.routes[door]).toBe(`/${door}?authRequest=V2_1`);
      }
    },
  );

  it("003 EARS-60: the hand-over's door picks the route — register, reset, verify", async () => {
    for (const [door, route] of [
      ["register", RegisterRoute],
      ["reset", ResetRoute],
      ["verify", VerifyRoute],
    ] as const) {
      handOver({ door, render: RENDER });
      expect((await mount()).type).toBe(route);
    }
  });

  it("003 EARS-71: the mount settles the address on the hand-over's door, beside the door", async () => {
    for (const door of ["login", "register", "reset", "verify"] as const) {
      handOver({ door, render: RENDER });
      const page = await mountPage();
      const settle = Children.toArray(page.props.children).find(
        (child) => isValidElement(child) && child.type === SettleDoorPath,
      ) as ReactElement<{ door: string }> | undefined;
      expect(settle?.props.door).toBe(door);
    }
  });

  it("003 EARS-60: no hand-over, a forged one or a non-render answer ⇒ no form (not found)", async () => {
    const forged = Buffer.from(
      JSON.stringify({
        door: "login",
        render: { action: "redirect", url: "https://x.test" },
      }),
    ).toString("base64url");
    for (const value of [null, "not-base64-json", forged]) {
      handOver(value);
      await expect(mount()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(notFound).toHaveBeenCalledTimes(3);
  });
});

describe("003 EARS-71: the door's params come from the entry intent, never the browser URL", () => {
  it("003 EARS-71: an intent with an event target hands the door the event as return context", async () => {
    handOver({
      door: "login",
      render: {
        ...RENDER,
        intent: { method: "code", eventTarget: "cardio-2026", handoff: false },
      },
    });
    const el = await mount({ returnTo: "/evil", method: "password" });
    expect(await el.props.searchParams).toEqual({
      method: "code",
      returnTo: "/events/cardio-2026",
    });
  });

  it("003 EARS-71: no intent ⇒ the plain form, whatever the browser URL carried", async () => {
    handOver({ door: "login", render: RENDER });
    const el = await mount({ returnTo: "/events/x", handoff: "abc" });
    expect(await el.props.searchParams).toEqual({});
  });
});

describe("the entry could not be read: the host says so in the forms' own words", () => {
  function unavailable(value: string) {
    requestHeaders.value = new Headers({
      [SIGN_IN_HOST_UNAVAILABLE_HEADER]: value,
    });
  }

  it("the API's rate limit renders the forms' too-many-attempts banner, no form", async () => {
    unavailable("rate-limited");
    const html = renderToStaticMarkup(await mount());
    expect(html).toContain(DEFAULT_AUTH_FLOW_COPY.errors.tooManyAttempts);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("<form");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("any other failure renders the forms' temporarily-unavailable banner", async () => {
    unavailable("unavailable");
    const html = renderToStaticMarkup(await mount());
    expect(html).toContain(DEFAULT_AUTH_FLOW_COPY.errors.unavailable);
    expect(html).not.toContain(DEFAULT_AUTH_FLOW_COPY.errors.tooManyAttempts);
  });

  it("an unknown value is no state at all (not found)", async () => {
    unavailable("bogus");
    await expect(mount()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("003 EARS-71: the host page's tab title is the rendered door's", () => {
  it("003 EARS-71: the title follows the door the hand-over renders, not the address it arrived on", async () => {
    for (const door of ["login", "register", "reset", "verify"] as const) {
      handOver({ door, render: RENDER });
      expect(await signInHostMetadata("login")).toEqual({
        title: AUTH_FLOW_PAGE_TITLES[door],
      });
    }
  });

  it("003 EARS-71: with no hand-over the page keeps its own door's title", async () => {
    handOver(null);
    expect(await signInHostMetadata("reset")).toEqual({
      title: AUTH_FLOW_PAGE_TITLES.reset,
    });
  });
});
