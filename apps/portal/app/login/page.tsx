import type { Metadata } from "next";

import { AUTH_FLOW_PAGE_TITLES } from "@ds/auth-flow/copy";
import { LoginRoute } from "@ds/auth-flow/login/route";

import { ACADEMY_AUTH_FLOW } from "../../lib/auth-flow.host-config";

export const metadata: Metadata = {
  title: AUTH_FLOW_PAGE_TITLES.login,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <LoginRoute config={ACADEMY_AUTH_FLOW} searchParams={searchParams} />;
}
