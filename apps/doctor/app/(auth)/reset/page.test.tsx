import type { ReactElement } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Rules S3 + S4 of the auth-flow standard (`packages/auth-flow/README.md`) —
 * `doctor.school/reset` carries the arrival target through recovery.
 *
 * Recovery is an INTERRUPTION of wherever the doctor was going: `/login` and the
 * `/account` «Сменить пароль» row both send visitors here. The route used to
 * read no search params at all, so both ends of the journey were bare literals
 * in the screen — «Вспомнили пароль» went to `/login` with nothing, and
 * completion always landed on `/account`. This tier pins WHAT the route decides;
 * `components/reset-screen.test.tsx` pins that the screen honours it.
 */
const { redirect, resolveServerAuth } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  resolveServerAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "__Host-ds_session=x" }),
}));
// The session read is doubled; the GUARD stays the real shared one, so this tier
// proves the route actually routes its decision through it.
vi.mock("@ds/auth-flow/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/auth-flow/server")>()),
  resolveServerAuth,
}));

import DoctorResetPage from "@/app/(auth)/reset/page";

/** The props the route hands `<ResetScreen />`. */
async function screenPropsOf(
  params: Record<string, string | string[] | undefined>,
): Promise<{ loginHref: string; landing: string }> {
  const shell = (await DoctorResetPage({
    searchParams: Promise.resolve(params),
  })) as ReactElement<{
    children: ReactElement<{ loginHref: string; landing: string }>;
  }>;
  return shell.props.children.props;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveServerAuth.mockResolvedValue({ status: "guest" });
});

describe("#2027 S3/S4: /reset carries the arrival target", () => {
  it("#2027 S3: an account arrival comes back out of recovery still carrying /account", async () => {
    expect((await screenPropsOf({ returnTo: "/account" })).loginHref).toBe(
      "/login?returnTo=%2Faccount",
    );
  });

  it("#2027 S4: an эфир arrival lands on the doctor-host projection after completing", async () => {
    expect(
      (await screenPropsOf({ returnTo: "/webinars/prp-pri-gonartroze" }))
        .landing,
    ).toBe("/events/prp-pri-gonartroze");
  });

  it("#2027 S4: an arrival carrying NOTHING still lands on the cabinet (#221 default)", async () => {
    const props = await screenPropsOf({});

    expect(props.landing).toBe("/account");
    expect(props.loginHref).toBe("/login");
  });

  it("#2027 S3: a hostile target is refused at both ends, never propagated", async () => {
    const props = await screenPropsOf({ returnTo: "https://evil.example/x" });

    expect(props.loginHref).toBe("/login");
    expect(props.landing).toBe("/account");
  });

  it("#2027 S3: a SIGNED-IN doctor's arrival is carried too — the «Сменить пароль» entry comes from /account", async () => {
    resolveServerAuth.mockResolvedValue({
      status: "doctor",
      claims: { sub: "doctor-1", roles: ["doctor"], mfa: false },
    });

    // The exemption itself (`routes.allowAuthenticated`) is pinned once, in
    // `app/(auth)/auth-route-guard.test.tsx`; what matters here is that the
    // doctor who came from the cabinet is sent back to it.
    expect((await screenPropsOf({ returnTo: "/account" })).landing).toBe(
      "/account",
    );
  });
});
