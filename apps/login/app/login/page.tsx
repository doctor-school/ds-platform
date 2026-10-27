import {
  SignInHostRoute,
  signInHostMetadata,
} from "@ds/auth-flow/sign-in-host/route";

import { SIGN_IN_HOST_STOREFRONTS } from "../../lib/sign-in-host.host-config";

/** 003 EARS-71 — the title of the door rendered, which the entry may choose. */
export function generateMetadata() {
  return signInHostMetadata("login");
}

export default async function SignInHostLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <SignInHostRoute
      storefronts={SIGN_IN_HOST_STOREFRONTS}
      searchParams={searchParams}
    />
  );
}
