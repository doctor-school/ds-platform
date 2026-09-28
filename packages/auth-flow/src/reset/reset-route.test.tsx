// @vitest-environment jsdom
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SERVER MOUNT of password recovery (#2027 PR 1.8, rows 78 and 83) — the
 * sibling of `VerifyRoute`, read as an ELEMENT: this tier owns the decisions
 * handed across the boundary (the guard with its `allowAuthenticated`
 * exemption, the carried exit, the post-reset landing), and the body's own
 * behaviour is pinned by `reset-door.test.tsx`.
 *
 * The ids arrive from the retired `apps/doctor/app/(auth)/reset/page.test.tsx`
 * and the Academy's S3/S4 cases; both hosts now resolve the return target the
 * same way, server-side, so every case runs on both host fixtures.
 *
 * Mocked seams: Next's `redirect` throw and the session read. The guard and the
 * return-target codec stay the real shared ones.
 */
const { redirect, resolveServerAuth } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  resolveServerAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "__Host-ds_session=x" }),
}));
vi.mock("../server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server")>()),
  resolveServerAuth,
}));

import type { AuthFlowHostConfig } from "../host-config";
import { AuthShell } from "../shell";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { ResetDoor, type ResetDoorProps } from "./reset-door";
import { ResetRoute } from "./reset-route";

const DOCTOR = {
  status: "doctor",
  claims: { sub: "doctor-1", roles: ["doctor"], mfa: false },
} as const;

type Params = Record<string, string | string[] | undefined>;

async function mountOf(config: AuthFlowHostConfig, params: Params) {
  const shell = (await ResetRoute({
    config,
    searchParams: Promise.resolve(params),
  })) as ReactElement<{
    config: unknown;
    children: ReactElement<ResetDoorProps>;
  }>;
  return shell;
}

async function doorPropsOf(
  config: AuthFlowHostConfig,
  params: Params,
): Promise<ResetDoorProps> {
  return (await mountOf(config, params)).props.children.props;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveServerAuth.mockResolvedValue({ status: "guest" });
});

const HOSTS: ReadonlyArray<[string, AuthFlowHostConfig]> = [
  ["Academy", ACADEMY_FIXTURE],
  ["doctor storefront", DOCTOR_FIXTURE],
];

describe.each(HOSTS)("ResetRoute on the %s host", (_, config) => {
  it("003 EARS-11: the route frames the ONE door in this host's shell, back to THIS host sign-in", async () => {
    const shell = await mountOf(config, {});

    expect(shell.type).toBe(AuthShell);
    expect(shell.props.config).toBe(config);
    expect(shell.props.children.type).toBe(ResetDoor);
    expect(shell.props.children.props.config).toBe(config);
    expect(shell.props.children.props.loginHref).toBe(config.routes.login);
  });

  it("003 EARS-28: a SIGNED-IN doctor is let through — /reset is this host's `allowAuthenticated` exemption", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    const props = await doorPropsOf(config, { returnTo: "/account" });

    expect(redirect).not.toHaveBeenCalled();
    // The doctor who came from the cabinet «Сменить пароль» is sent back to it.
    expect(props.landing).toBe("/account");
  });

  it("#2027 S4: an arrival carrying NOTHING still lands on the cabinet (#221 default)", async () => {
    const props = await doorPropsOf(config, {});

    expect(props.landing).toBe(config.routes.account);
    expect(props.returnTarget).toBeNull();
    expect(props.loginHref).toBe(config.routes.login);
  });

  it("#2027 S3: the «Вернуться ко входу» link carries the arrival target onward into /login", async () => {
    expect(
      (await doorPropsOf(config, { returnTo: "/account/events" })).loginHref,
    ).toBe("/login?returnTo=%2Faccount%2Fevents");
  });

  it("#2027 S4: an account arrival lands on the carried page, not the fixed cabinet", async () => {
    const props = await doorPropsOf(config, { returnTo: "/account/events" });

    expect(props.landing).toBe("/account/events");
    expect(props.returnTarget).toBe("/account/events");
  });

  it("#2027 S4: an эфир arrival lands on THIS host's projection of the event", async () => {
    const props = await doorPropsOf(config, {
      returnTo: "/webinars/prp-pri-gonartroze",
    });
    const projected = config.routes.eventPathTemplate.replace(
      ":slug",
      "prp-pri-gonartroze",
    );

    expect(props.landing).toBe(projected);
    expect(props.returnTarget).toBe(projected);
  });

  it("#2027 S3/S4: a hostile target is refused at BOTH ends — the exit stays bare and the landing is the #221 cabinet default", async () => {
    for (const hostile of ["//evil.example", "https://evil.example/x"]) {
      const props = await doorPropsOf(config, { returnTo: hostile });

      expect(props.loginHref).toBe(config.routes.login);
      expect(props.landing).toBe(config.routes.account);
      expect(props.returnTarget).toBeNull();
    }
  });

  it("#2027 S3: a repeated param degrades to its FIRST value, never a rejected request", async () => {
    const props = await doorPropsOf(config, {
      returnTo: ["/account/events", "/account"],
    });

    expect(props.landing).toBe("/account/events");
  });
});
