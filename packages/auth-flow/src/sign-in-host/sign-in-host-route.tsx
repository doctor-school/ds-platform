import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { FormError } from "@ds/design-system/form";

import { AUTH_FLOW_PAGE_TITLES, DEFAULT_AUTH_FLOW_COPY } from "../copy";
import { LoginRoute } from "../login/login-route";
import { RegisterRoute } from "../register/register-route";
import { ResetRoute } from "../reset/reset-route";
import {
  SIGN_IN_HOST_ENTRY_HEADER,
  SIGN_IN_HOST_UNAVAILABLE_HEADER,
  readSignInHostHandOver,
  readSignInHostUnavailable,
  signInHostConfig,
  signInHostSearchParams,
  type SignInHostPageDoor,
  type SignInHostStorefronts,
} from "../server/sign-in-host";
import { VerifyRoute } from "../verify/verify-route";
import { SettleDoorPath } from "./settle-door-path";

/** The storefront route each door of the sign-in host mounts. */
const DOOR_ROUTES: Record<SignInHostPageDoor, typeof LoginRoute> = {
  login: LoginRoute,
  register: RegisterRoute,
  reset: ResetRoute,
  verify: VerifyRoute,
};

/**
 * 003 EARS-71 — the tab title of a host door page: the storefront's own title
 * for the door the hand-over RENDERS (`AUTH_FLOW_PAGE_TITLES`, the titles the
 * storefront door pages carried), so the IdP's `/login` arrival on the
 * registration or reset door is titled as that door, before and after the
 * address settles on the door's path. With no hand-over (an unread entry, a
 * not-found) the page keeps its own path door's title.
 */
export async function signInHostMetadata(
  pathDoor: SignInHostPageDoor,
): Promise<Metadata> {
  const handOver = readSignInHostHandOver(
    (await headers()).get(SIGN_IN_HOST_ENTRY_HEADER),
  );
  return { title: AUTH_FLOW_PAGE_TITLES[handOver?.door ?? pathDoor] };
}

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
 * `SIGN_IN_HOST_UNAVAILABLE_HEADER` instead: no storefront is known, so no
 * door and no brand — only the forms' own operation-level banner with the
 * forms' own words (`errors.tooManyAttempts` / `errors.unavailable`).
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
  const request = await headers();
  const unavailable = readSignInHostUnavailable(
    request.get(SIGN_IN_HOST_UNAVAILABLE_HEADER),
  );
  if (unavailable) {
    const { errors } = DEFAULT_AUTH_FLOW_COPY;
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <FormError variant="banner">
          {unavailable === "rate-limited"
            ? errors.tooManyAttempts
            : errors.unavailable}
        </FormError>
      </div>
    );
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
