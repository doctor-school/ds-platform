import { signInHostApiPath } from "@ds/e2e/sign-in-host-api";
import type { Route } from "@playwright/test";

/**
 * The sign-in host tier's handles on a door (#3172): a storefront's `/login`,
 * `/register`, `/reset` and `/verify` are 303 entries now, and the form they
 * hand over to renders here from the entry answer of
 * `support/sign-in-entry-api.mjs` (the tier's double of the API).
 *
 * An auth request id names the answer the double gives:
 * `<storefront>-<door>[-code][-handoff][-at-<event slug>]` — the storefront's
 * door, the EARS-71 intent the storefront entry would have recorded
 * (`?method=code`, a hand-off reference, an event target), and nothing else.
 */
export type Storefront = "doctor" | "academy";
export type Door = "login" | "register" | "reset";

export interface DoorIntent {
  /** `?method=code` on the storefront's login entry. */
  readonly code?: boolean;
  /** A hand-off reference the entry held server-side (EARS-44). */
  readonly handoff?: boolean;
  /** The эфир slug of the storefront entry's `?returnTo=` (EARS-71). */
  readonly eventTarget?: string;
}

export function authRequestId(
  storefront: Storefront,
  door: Door,
  intent: DoorIntent = {},
): string {
  return [
    `${storefront}-${door}`,
    intent.code ? "-code" : "",
    intent.handoff ? "-handoff" : "",
    intent.eventTarget ? `-at-${intent.eventTarget}` : "",
  ].join("");
}

/**
 * The host path a door renders on. `page` is the door page itself
 * (`/verify` is the code step's own address on the same auth request, 003 EARS-24).
 */
export function doorPath(
  storefront: Storefront,
  door: Door,
  intent: DoorIntent = {},
  page: Door | "verify" = door,
): string {
  return `/${page}?authRequest=${authRequestId(storefront, door, intent)}`;
}

/** The CSRF token the double hands every render (the form state's). */
export const DOUBLE_CSRF = "csrf-axe";

/** What every host form POST carries besides the storefront's own body. */
export function formPostFields(
  storefront: Storefront,
  door: Door,
  intent: DoorIntent = {},
): { authRequest: string; csrf: string } {
  return {
    authRequest: authRequestId(storefront, door, intent),
    csrf: DOUBLE_CSRF,
  };
}

/** A `page.route` glob for a storefront command as the host posts it. */
export function hostRoute(path: string): string {
  return `**${signInHostApiPath(path)}`;
}

const DOUBLE_PORT = Number(process.env.LOGIN_FAKE_API_PORT ?? 3216);

/**
 * Where the double's finished credential steps send the browser: the IdP's
 * callback in production (the API finalised the auth request), a page of the
 * double here. A spec asserts the host FOLLOWED the answer by landing on it;
 * where the storefront then lands is the storefront callback's, proven by the
 * stand journeys (`packages/e2e`).
 */
export const IDP_CALLBACK_URL = `http://127.0.0.1:${DOUBLE_PORT}/__idp/callback`;

/** A storefront page of the double, the page a sign-in starts from (#3172). */
export function storefrontPageUrl(name: string): string {
  return `http://127.0.0.1:${DOUBLE_PORT}/__storefront/${name}`;
}

/** The host's success answer (`SignInHostStepResponseSchema`). */
export function fulfillHostRedirect(route: Route): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: "redirect", url: IDP_CALLBACK_URL }),
  });
}

/** True for the URL the host's success answer named. */
export function isIdpCallback(url: URL): boolean {
  return url.href.startsWith(IDP_CALLBACK_URL);
}

/** The sign-in host's own origin on this tier (`playwright.ci.config.ts`). */
export const HOST_ORIGIN = `http://127.0.0.1:${Number(process.env.LOGIN_CI_PORT ?? 3215)}`;
