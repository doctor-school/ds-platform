import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { LoginRoute } from "../login/login-route";
import { RegisterRoute } from "../register/register-route";
import { ResetRoute } from "../reset/reset-route";
import {
  SIGN_IN_HOST_ENTRY_HEADER,
  readSignInHostHandOver,
  signInHostConfig,
  signInHostSearchParams,
  type SignInHostPageDoor,
  type SignInHostStorefronts,
} from "../server/sign-in-host";
import { VerifyRoute } from "../verify/verify-route";

/** The storefront route each door of the sign-in host mounts. */
const DOOR_ROUTES: Record<SignInHostPageDoor, typeof LoginRoute> = {
  login: LoginRoute,
  register: RegisterRoute,
  reset: ResetRoute,
  verify: VerifyRoute,
};

/**
 * 003 EARS-60 / 71, ADR-0015 §4 — the sign-in host's ONE page mount (#3170).
 *
 * Every door page of the host (`/login`, `/register`, `/reset`, `/verify`) is
 * this element and nothing else. The host's proxy has asked the API's entry
 * what the navigation is and handed a `render` answer over in
 * `SIGN_IN_HOST_ENTRY_HEADER`; this mount re-validates it and mounts the
 * ORIGINATING storefront's own door route — its config projected onto the
 * host transport (`signInHostConfig`), its params built from the entry intent
 * alone (`signInHostSearchParams`, EARS-71). No hand-over ⇒ no form.
 *
 * `storefronts` is the host's own host-config value (the two storefront
 * configs); the package core never picks a storefront config itself.
 */
export async function SignInHostRoute({
  storefronts,
  searchParams,
}: {
  storefronts: SignInHostStorefronts;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const handOver = readSignInHostHandOver(
    (await headers()).get(SIGN_IN_HOST_ENTRY_HEADER),
  );
  if (!handOver) notFound();
  const storefront = storefronts[handOver.render.storefront];
  const Door = DOOR_ROUTES[handOver.door];
  return (
    <Door
      config={signInHostConfig(storefront, handOver.render)}
      searchParams={Promise.resolve(
        signInHostSearchParams(
          storefront,
          handOver.render,
          await searchParams,
          handOver.door,
        ),
      )}
    />
  );
}
