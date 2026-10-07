import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { authenticatedAllowedRoutes } from "@ds/auth-flow/host-config";

/**
 * `/reset` is a MOUNT (#2027 PR 1.8): the recovery flow's behaviour is pinned
 * once, in `packages/auth-flow/src/reset/reset-door.test.tsx` and
 * `reset-route.test.tsx`, on both host configs. This tier pins only that THIS
 * host's config and the request's params reach the package mount.
 */
const route = vi.hoisted(() => vi.fn(() => null));
vi.mock("@ds/auth-flow/reset/route", () => ({ ResetRoute: route }));

import { AUTH_FLOW_PAGE_TITLES } from "@ds/auth-flow/copy";

import { ACADEMY_AUTH_FLOW } from "@/lib/auth-flow.host-config";

import ResetPage, { metadata } from "./page";

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
    // 003 EARS-28 — the exemption the mount's guard reads is derived from this
    // host's reset route (#2443), not stated beside it.
    expect(ACADEMY_AUTH_FLOW.routes).not.toHaveProperty("allowAuthenticated");
    expect(authenticatedAllowedRoutes(ACADEMY_AUTH_FLOW.routes)).toEqual([
      "/reset",
    ]);
    expect(ACADEMY_AUTH_FLOW.routes.account).toBe("/account");
  });

  it("#2470: the tab names the screen with the title the doctor storefront uses", () => {
    expect(metadata.title).toBe(AUTH_FLOW_PAGE_TITLES.reset);
  });
});
