import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { AUTH_FLOW_PAGE_TITLES } from "@ds/auth-flow/copy";

/**
 * `/login` is a MOUNT (#2027 PR 1.5): the sign-in door's behaviour is pinned
 * once, in `packages/auth-flow/src/login/`. This tier pins only what THIS host
 * states: its config, the request's params and the tab title.
 */
const route = vi.hoisted(() => vi.fn(() => null));
vi.mock("@ds/auth-flow/login/route", () => ({ LoginRoute: route }));

import { ACADEMY_AUTH_FLOW } from "@/lib/auth-flow.host-config";

import LoginPage, { metadata } from "./page";

describe("/login mounts the shared sign-in door", () => {
  it("the Academy config and the request's params reach the package mount", async () => {
    const searchParams = Promise.resolve({ returnTo: "/account" });

    const element = (await LoginPage({ searchParams })) as ReactElement<{
      config: unknown;
      searchParams: unknown;
    }>;

    expect(element.type).toBe(route);
    expect(element.props.config).toBe(ACADEMY_AUTH_FLOW);
    expect(element.props.searchParams).toBe(searchParams);
  });

  it("#2470: the tab names the screen with the title the doctor storefront uses", () => {
    expect(metadata.title).toBe(AUTH_FLOW_PAGE_TITLES.login);
  });
});
