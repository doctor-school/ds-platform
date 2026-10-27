import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { AUTH_FLOW_PAGE_TITLES } from "@ds/auth-flow/copy";
import { SignInHostRoute } from "@ds/auth-flow/sign-in-host/route";

import { SIGN_IN_HOST_STOREFRONTS } from "../lib/sign-in-host.host-config";
import LoginPage, { metadata as loginMeta } from "./login/page";
import RegisterPage, { metadata as registerMeta } from "./register/page";
import ResetPage, { metadata as resetMeta } from "./reset/page";
import VerifyPage, { metadata as verifyMeta } from "./verify/page";

/**
 * 003 EARS-60 (#3170) — every door page of the sign-in host is the ONE
 * package mount over the host's storefront table: the storefront, the door
 * and the params are the entry hand-over's (`@ds/auth-flow`'s
 * `sign-in-host-route.test.tsx`), never the page's.
 */
const PAGES = [
  ["login", LoginPage, loginMeta],
  ["register", RegisterPage, registerMeta],
  ["reset", ResetPage, resetMeta],
  ["verify", VerifyPage, verifyMeta],
] as const;

describe("003 EARS-60: the host's door pages mount the shared sign-in host route", () => {
  for (const [door, Page, meta] of PAGES) {
    it(`003 EARS-60: /${door} mounts SignInHostRoute with both storefront configs`, async () => {
      const searchParams = Promise.resolve({ authRequest: "V2_1" });
      const el = (await Page({ searchParams })) as ReactElement<{
        storefronts: unknown;
        searchParams: unknown;
      }>;
      expect(el.type).toBe(SignInHostRoute);
      expect(el.props.storefronts).toBe(SIGN_IN_HOST_STOREFRONTS);
      expect(el.props.searchParams).toBe(searchParams);
      expect(meta.title).toBe(AUTH_FLOW_PAGE_TITLES[door]);
    });
  }

  it("003 EARS-60: the host table holds exactly the two storefronts' own configs", async () => {
    const { ACADEMY_AUTH_FLOW, DOCTOR_AUTH_FLOW } =
      await import("@ds/auth-flow/hosts");
    expect(SIGN_IN_HOST_STOREFRONTS).toEqual({
      academy: ACADEMY_AUTH_FLOW,
      doctor: DOCTOR_AUTH_FLOW,
    });
    expect(SIGN_IN_HOST_STOREFRONTS.doctor).toBe(DOCTOR_AUTH_FLOW);
  });
});
