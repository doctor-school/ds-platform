import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * The Academy `/verify` route is a MOUNT (#2027 PR 1.7): its behaviour — the
 * code step, the resend, the replay exits, the #904 fragment seed and the #675
 * guard — is pinned once in `packages/auth-flow/src/verify/verify-door.test.tsx`
 * and `verify-route.test.tsx`. What only this tier can prove is the WIRING: this
 * route hands the package THIS host's config and the request's own params.
 */
const route = vi.hoisted(() => vi.fn(() => null));
vi.mock("@ds/auth-flow/verify/route", () => ({ VerifyRoute: route }));

import { ACADEMY_AUTH_FLOW } from "@/lib/auth-flow.host-config";

import VerifyPage from "./page";

describe("/verify mounts the shared confirmation step", () => {
  it("003 EARS-24: the Academy config and the request's params reach the package mount", async () => {
    const searchParams = Promise.resolve({ email: "doc@example.com" });

    const element = (await VerifyPage({ searchParams })) as ReactElement<{
      config: unknown;
      searchParams: unknown;
    }>;

    expect(element.type).toBe(route);
    expect(element.props.config).toBe(ACADEMY_AUTH_FLOW);
    expect(element.props.searchParams).toBe(searchParams);
    expect(ACADEMY_AUTH_FLOW.routes.verify).toBe("/verify");
    expect(ACADEMY_AUTH_FLOW.verify.deepLinkEntry).toBe(true);
  });
});
