import type { Metadata } from "next";

import { AUTH_FLOW_PAGE_TITLES } from "@ds/auth-flow/copy";
import { SignInHostRoute } from "@ds/auth-flow/sign-in-host/route";

import {
  SIGN_IN_HOST_STOREFRONTS,
  signInHostRefusalSites,
} from "../../lib/sign-in-host.host-config";

export const metadata: Metadata = {
  title: AUTH_FLOW_PAGE_TITLES.login,
};

export default async function SignInHostLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <SignInHostRoute
      storefronts={SIGN_IN_HOST_STOREFRONTS}
      refusalSites={signInHostRefusalSites}
      searchParams={searchParams}
    />
  );
}
