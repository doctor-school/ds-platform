import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { LoginRoute } from "../login/login-route";
import { RegisterRoute } from "../register/register-route";
import {
  SignInSiteRefusal,
  type SignInSiteRefusalConfig,
} from "../refusal/entry-refusal-route";
import { ResetRoute } from "../reset/reset-route";
import { ENTRY_REFUSAL_HEADER, readEntryRefusal } from "../server/entry-refusal";
import {
  SIGN_IN_HOST_ENTRY_HEADER,
  readSignInHostHandOver,
  signInHostConfig,
  signInHostSearchParams,
  type SignInHostPageDoor,
  type SignInHostStorefronts,
} from "../server/sign-in-host";
import { VerifyRoute } from "../verify/verify-route";
import { SettleDoorPath } from "./settle-door-path";

export type { SignInSiteRefusalConfig };

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
 * alone (`signInHostSearchParams`, EARS-71). No hand-over ⇒ no form. Beside
 * the door, `SettleDoorPath` moves the address onto the door's own path, so a
 * reload / Back / Forward re-enters the same door after the intent is spent.
 *
 * An entry the proxy could not read (the API's 429, or no answer) arrives as
 * `ENTRY_REFUSAL_HEADER` instead (003 EARS-72): no storefront is known, so no
 * door and no brand — the sign-in site's refusal page, with the way out
 * naming both sites.
 *
 * `storefronts` and `refusalSites` are the host's own host-config values
 * (the two storefront configs; the refusal's site links and logo, read only
 * when a refusal renders); the package core never picks a storefront config
 * itself.
 */
export async function SignInHostRoute({
  storefronts,
  refusalSites,
  searchParams,
}: {
  storefronts: SignInHostStorefronts;
  refusalSites: () => SignInSiteRefusalConfig;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const request = await headers();
  const refusal = readEntryRefusal(request.get(ENTRY_REFUSAL_HEADER));
  if (refusal) {
    return <SignInSiteRefusal refusal={refusal} sites={refusalSites()} />;
  }
  const handOver = readSignInHostHandOver(
    request.get(SIGN_IN_HOST_ENTRY_HEADER),
  );
  if (!handOver) notFound();
  const storefront = storefronts[handOver.render.storefront];
  const Door = DOOR_ROUTES[handOver.door];
  return (
    <>
      <SettleDoorPath door={handOver.door} />
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
    </>
  );
}
