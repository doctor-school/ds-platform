import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * `/reset` is a MOUNT (#2027 PR 1.8): the recovery flow's behaviour is pinned
 * once, in `packages/auth-flow/src/reset/reset-door.test.tsx` and
 * `reset-route.test.tsx`, on both host configs. This tier pins only that THIS
 * host's config and the request's params reach the package mount.
 */
const route = vi.hoisted(() => vi.fn(() => null));
vi.mock("@ds/auth-flow/reset/route", () => ({ ResetRoute: route }));

import { ACADEMY_AUTH_FLOW } from "@/lib/auth-flow.host-config";

import ResetPage from "./page";

describe("/reset mounts the shared recovery flow", () => {
  it("003 EARS-11: the Academy config and the request's params reach the package mount", async () => {
    const searchParams = Promise.resolve({ returnTo: "/account/events" });

    const element = (await ResetPage({ searchParams })) as ReactElement<{
      config: unknown;
      searchParams: unknown;
    }>;

    expect(element.type).toBe(route);
    expect(element.props.config).toBe(ACADEMY_AUTH_FLOW);
    expect(element.props.searchParams).toBe(searchParams);
    // 003 EARS-28 — the exemption the mount's guard reads is this host's data.
    expect(ACADEMY_AUTH_FLOW.routes.allowAuthenticated).toContain("/reset");
    expect(ACADEMY_AUTH_FLOW.routes.account).toBe("/account");
  });
});
