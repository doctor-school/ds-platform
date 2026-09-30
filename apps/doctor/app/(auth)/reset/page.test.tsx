import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { authenticatedAllowedRoutes } from "@ds/auth-flow/host-config";

/**
 * `doctor.school/reset` is a MOUNT (#2027 PR 1.8): the recovery flow's
 * behaviour — both stages, the carried return target, the guard exemption — is
 * pinned once, in `packages/auth-flow/src/reset/`, on both host configs. This
 * tier pins only that THIS host's config and the request's params reach it.
 */
const route = vi.hoisted(() => vi.fn(() => null));
vi.mock("@ds/auth-flow/reset/route", () => ({ ResetRoute: route }));

import { DOCTOR_AUTH_FLOW } from "@/lib/auth-flow.host-config";

import DoctorResetPage from "@/app/(auth)/reset/page";

describe("/reset mounts the shared recovery flow", () => {
  it("003 EARS-11: the doctor storefront config and the request's params reach the package mount", async () => {
    const searchParams = Promise.resolve({ returnTo: "/account" });

    const element = (await DoctorResetPage({ searchParams })) as ReactElement<{
      config: unknown;
      searchParams: unknown;
    }>;

    expect(element.type).toBe(route);
    expect(element.props.config).toBe(DOCTOR_AUTH_FLOW);
    expect(element.props.searchParams).toBe(searchParams);
    // 003 EARS-28 — the exemption the mount's guard reads is derived from this
    // host's reset route (#2443), not stated beside it.
    expect(DOCTOR_AUTH_FLOW.routes).not.toHaveProperty("allowAuthenticated");
    expect(authenticatedAllowedRoutes(DOCTOR_AUTH_FLOW.routes)).toEqual([
      "/reset",
    ]);
    expect(DOCTOR_AUTH_FLOW.routes.account).toBe("/account");
  });
});
