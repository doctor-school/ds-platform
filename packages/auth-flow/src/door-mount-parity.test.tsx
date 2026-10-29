import { isValidElement, type ReactElement, type ReactNode } from "react";
import { withReturnTarget } from "@ds/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #3345 — door-input parity across the door's two mounts.
 *
 * Every door gets its props from the same `*-route.tsx` code on both mounts;
 * the only thing that differs is the `searchParams` the route is fed. The
 * STOREFRONT mount is the route fed the browser URL — the behaviour the
 * storefronts had before the doors moved; the SIGN-IN HOST mount is
 * `SignInHostRoute` with the entry hand-over's intent plus the browser params
 * the door's own hop link produces on the host. For each case the door must
 * receive equivalent props for every `both` / `host-intent` input of the
 * door-input contract (`door-inputs.ts`); a `storefront-only` input must be
 * absent on the host, i.e. the host renders what the storefront renders with
 * that input stripped.
 *
 * Mocked seams: the request headers, Next's `redirect`/`notFound` throws, the
 * session read (a guest), the эфир read (the page answers) and the specialty
 * read behind the real LD-4 landing rule (nothing remembered).
 */
const { requestHeaders, readReturnEvent, specialtyFetch } = vi.hoisted(() => ({
  requestHeaders: { value: new Headers() },
  readReturnEvent: vi.fn(),
  specialtyFetch: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => requestHeaders.value }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("./server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./server")>();
  return {
    ...actual,
    resolveServerAuth: async () => ({ status: "guest" }),
    resolveOwnHandoff: async () => false,
    readReturnEvent,
    resolveArrivalLanding: (
      host: Parameters<typeof actual.resolveArrivalLanding>[0],
      headers: Headers,
    ) => actual.resolveArrivalLanding(host, headers, specialtyFetch),
  };
});
vi.mock("./server/return-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./server/return-context")>()),
  readReturnEvent,
}));
vi.mock("./server/landing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./server/landing")>();
  return {
    ...actual,
    resolveArrivalLanding: (
      host: Parameters<typeof actual.resolveArrivalLanding>[0],
      headers: Headers,
    ) => actual.resolveArrivalLanding(host, headers, specialtyFetch),
  };
});

import {
  DOOR_INPUTS,
  type DoorInputDoor,
  type DoorInputSpec,
} from "./door-inputs";
import type { AuthFlowHostConfig } from "./host-config";
import { ACADEMY_AUTH_FLOW, DOCTOR_AUTH_FLOW } from "./hosts";
import { LoginDoor } from "./login/login-door";
import { LoginRoute } from "./login/login-route";
import { RegisterDoor } from "./register/register-door";
import { RegisterRoute } from "./register/register-route";
import { ResetDoor } from "./reset/reset-door";
import { ResetRoute } from "./reset/reset-route";
import {
  SIGN_IN_HOST_ENTRY_HEADER,
  signInHostConfig,
  writeSignInHostHandOver,
  type SignInHostRender,
} from "./server/sign-in-host";
import { AuthShell } from "./shell";
import { SettleDoorPath } from "./sign-in-host/settle-door-path";
import { SignInHostRoute } from "./sign-in-host/sign-in-host-route";
import { VerifyAddressGate, VerifyStep } from "./verify/verify-entry";
import { VerifyRoute } from "./verify/verify-route";

type Params = Record<string, string | string[] | undefined>;
type Intent = NonNullable<SignInHostRender["intent"]>;
type Storefront = "academy" | "doctor";
type AnyElement = ReactElement<Record<string, unknown>>;

const STOREFRONTS = { academy: ACADEMY_AUTH_FLOW, doctor: DOCTOR_AUTH_FLOW };
const ROUTES = {
  login: LoginRoute,
  register: RegisterRoute,
  reset: ResetRoute,
  verify: VerifyRoute,
} as const;

const SLUG = "cardio-2026";
const EMAIL = "doc@clinic.test";
const HANDOFF = "a".repeat(43);
const AUTH_REQUEST = "V2_1";

const EVENT = {
  startsAt: "2026-08-27T16:00:00.000Z",
  format: "online" as const,
  school: "Школа ортобиологии",
  title: "PRP при гонартрозе",
  specialties: ["Травматология"],
  speakers: [{ name: "Анна Соколова" }],
};

beforeEach(() => {
  requestHeaders.value = new Headers();
  readReturnEvent.mockReset();
  readReturnEvent.mockResolvedValue({ status: "found", event: EVENT });
  specialtyFetch.mockReset();
  specialtyFetch.mockResolvedValue({ ok: false, status: 404 } as Response);
});

/** The storefront's own event path for the slug. */
function eventPath(config: AuthFlowHostConfig): string {
  return config.routes.eventPathTemplate.replace(":slug", SLUG);
}

/** The query of an href as the params a page receives. */
function queryOf(href: string): Params {
  const params: Params = {};
  for (const [k, v] of new URL(href, "https://host.test").searchParams) {
    params[k] = v;
  }
  return params;
}

function findAll(node: ReactNode, out: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, out);
  } else if (isValidElement(node)) {
    out.push(node as AnyElement);
    findAll((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

function find(tree: ReactNode, type: unknown): AnyElement {
  const el = findAll(tree).find((e) => e.type === type);
  if (!el) throw new Error(`element not found: ${String(type)}`);
  return el;
}

/** The door's input-derived props — what parity compares. */
function project(door: DoorInputDoor, tree: ReactNode) {
  const shell = find(tree, AuthShell).props;
  if (door === "reset") {
    const p = find(tree, ResetDoor).props;
    return {
      landing: p.landing,
      returnTarget: p.returnTarget,
      loginReturnTo: queryOf(p.loginHref as string).returnTo ?? null,
    };
  }
  const p =
    door === "login"
      ? find(tree, LoginDoor).props
      : door === "register"
        ? find(tree, RegisterDoor).props
        : find(tree, VerifyStep).props;
  const common = {
    landing: p.landing,
    returnTarget: p.returnTarget,
    card: Boolean(p.returnContextPlate),
    panel: Boolean(shell.returnContext),
    completion: Boolean(p.resolveCompletionTarget),
  };
  if (door === "login") {
    return {
      ...common,
      returnTo: p.returnTo,
      returnTargetGone: p.returnTargetGone,
      defaultMethod: p.defaultMethod,
      handoffRef: p.handoffRef,
    };
  }
  if (door === "register") {
    return { ...common, returnTo: p.returnTo, carriedTarget: p.carriedTarget };
  }
  const gate = find(tree, VerifyAddressGate).props;
  return {
    ...common,
    carriedTarget: p.carriedTarget,
    email: gate.email,
    gateReturnTo: gate.returnTo,
  };
}

async function onStorefront(
  door: DoorInputDoor,
  config: AuthFlowHostConfig,
  params: Params,
) {
  requestHeaders.value = new Headers();
  const Route = ROUTES[door];
  return project(
    door,
    await Route({ config, searchParams: Promise.resolve(params) }),
  );
}

async function onHost(
  door: DoorInputDoor,
  storefront: Storefront,
  intent: Intent | undefined,
  browser: Params,
) {
  const render: SignInHostRender = {
    action: "render",
    storefront,
    door: door === "verify" ? "register" : door,
    authRequest: AUTH_REQUEST,
    csrf: "csrf-1",
    ...(intent ? { intent } : {}),
  };
  requestHeaders.value = new Headers({
    [SIGN_IN_HOST_ENTRY_HEADER]: writeSignInHostHandOver({ door, render }),
  });
  const page = (await SignInHostRoute({
    storefronts: STOREFRONTS,
    refusalSites: () => {
      throw new Error("no refusal on a rendered door");
    },
    searchParams: Promise.resolve(browser),
  })) as AnyElement;
  const mounted = findAll(
    (page.props as { children?: ReactNode }).children,
  ).find((e) => e.type !== SettleDoorPath && typeof e.type === "function") as
    | ReactElement<{ config: AuthFlowHostConfig; searchParams: Promise<Params> }>
    | undefined;
  if (!mounted) throw new Error("no door mounted");
  const Route = mounted.type as (props: unknown) => Promise<ReactNode>;
  return project(door, await Route(mounted.props));
}

/** The storefront params with this door's storefront-only inputs stripped. */
function hostFedOnly(door: DoorInputDoor, params: Params): Params {
  const contract: Record<string, DoorInputSpec> = DOOR_INPUTS[door];
  const dropped = new Set(
    Object.values(contract)
      .filter((spec) => spec.source === "storefront-only")
      .map((spec) => spec.param),
  );
  return Object.fromEntries(
    Object.entries(params).filter(([k]) => !dropped.has(k)),
  );
}

type Case = {
  name: string;
  door: DoorInputDoor;
  /** The params the storefront mount sees. */
  storefront: (config: AuthFlowHostConfig) => Params;
  /** The entry intent the host's hand-over carries. */
  intent?: Intent;
  /** The browser params on the host (built from the host-projected config). */
  browser?: (host: AuthFlowHostConfig) => Params;
};

const EVENT_INTENT: Intent = { eventTarget: SLUG, handoff: false };
const withEvent = (c: AuthFlowHostConfig): Params => ({
  returnTo: eventPath(c),
});

const DOORS = ["login", "register", "reset", "verify"] as const;

const CASES: Case[] = [
  ...DOORS.flatMap((door): Case[] => {
    const email = door === "verify" ? { email: EMAIL } : {};
    return [
      {
        name: `${door}: plain entry`,
        door,
        storefront: () => ({}),
      },
      {
        name: `${door}: entry with an event return`,
        door,
        storefront: (c) => ({ ...withEvent(c), ...email }),
        intent: EVENT_INTENT,
        browser: () => ({ ...email }),
      },
      {
        name: `${door}: reload of the event entry on the settled door path`,
        door,
        storefront: (c) => ({ ...withEvent(c), ...email }),
        intent: EVENT_INTENT,
        browser: (h) => queryOf(withEmail(h.routes[door], door)),
      },
    ];
  }),
  {
    name: "login: method=code",
    door: "login",
    storefront: () => ({ method: "code" }),
    intent: { method: "code", handoff: false },
  },
  {
    name: "login: Congress hand-off on the code entry",
    door: "login",
    storefront: () => ({ method: "code", handoff: HANDOFF }),
    intent: { method: "code", handoff: true },
  },
  {
    name: "verify: the address handed by the registration door",
    door: "verify",
    storefront: () => ({ email: EMAIL }),
    browser: () => ({ email: EMAIL }),
  },
  {
    // #3265 Stage-B: the return card was lost after register → «Уже есть
    // аккаунт? Войти» on the sign-in host.
    name: "hop register → login keeps the event return (#3265)",
    door: "login",
    storefront: (c) => withEvent(c),
    intent: EVENT_INTENT,
    browser: (h) => queryOf(h.routes.login),
  },
  {
    name: "hop login → register keeps the event return",
    door: "register",
    storefront: (c) => withEvent(c),
    intent: EVENT_INTENT,
    browser: (h) => queryOf(withReturnTarget(h.routes.register, null)),
  },
  {
    name: "hop login → reset",
    door: "reset",
    storefront: (c) => withEvent(c),
    intent: EVENT_INTENT,
    browser: (h) => queryOf(withReturnTarget(h.routes.reset, null)),
  },
  {
    name: "hop verify → register keeps the event return",
    door: "register",
    storefront: (c) => withEvent(c),
    intent: EVENT_INTENT,
    browser: (h) => queryOf(withReturnTarget(h.routes.register, null)),
  },
];

function withEmail(route: string, door: DoorInputDoor): string {
  if (door !== "verify") return route;
  return `${route}${route.includes("?") ? "&" : "?"}email=${encodeURIComponent(EMAIL)}`;
}

describe("3345: door inputs reach the door alike on the storefront and the sign-in host", () => {
  for (const storefront of ["academy", "doctor"] as const) {
    it.each(CASES)(
      `3345: ${storefront} — $name`,
      async ({ door, storefront: sfParams, intent, browser }) => {
        const config = STOREFRONTS[storefront];
        const params = sfParams(config);
        const hostConfig = signInHostConfig(config, {
          action: "render",
          storefront,
          door: "login",
          authRequest: AUTH_REQUEST,
          csrf: "csrf-1",
        });
        const expected = await onStorefront(
          door,
          config,
          hostFedOnly(door, params),
        );
        const actual = await onHost(
          door,
          storefront,
          intent,
          browser?.(hostConfig) ?? {},
        );
        expect(actual).toEqual(expected);
      },
    );
  }

  it("3345: a storefront-only input is absent on the host — the reset door's return and the login hand-off", async () => {
    const config = DOCTOR_AUTH_FLOW;
    const withReturn = await onStorefront("reset", config, withEvent(config));
    const hostReset = await onHost("reset", "doctor", EVENT_INTENT, {});
    expect(withReturn.returnTarget).not.toBeNull();
    expect(hostReset.returnTarget).toBeNull();
    expect(hostReset.loginReturnTo).toBeNull();

    const hostLogin = await onHost(
      "login",
      "doctor",
      { method: "code", handoff: true },
      { handoff: HANDOFF },
    );
    expect(hostLogin).toMatchObject({ handoffRef: null, defaultMethod: "otp" });
  });
});

describe("3345: the door-input contract is complete", () => {
  it.each(DOORS)(
    "3345: every search param the %s route reads is classified in the contract",
    async (door) => {
      const read = new Set<string>();
      const params = new Proxy({} as Params, {
        get(_target, key) {
          if (typeof key === "string" && key !== "then") read.add(key);
          return undefined;
        },
      });
      requestHeaders.value = new Headers();
      const Route = ROUTES[door];
      await Route({
        config: DOCTOR_AUTH_FLOW,
        searchParams: Promise.resolve(params),
      });
      const contract: Record<string, DoorInputSpec> = DOOR_INPUTS[door];
      const classified = new Set(
        Object.values(contract).map((spec) => spec.param),
      );
      const unclassified = [...read].filter((param) => !classified.has(param));
      expect(read.size).toBeGreaterThan(0);
      expect(unclassified).toEqual([]);
    },
  );
});
