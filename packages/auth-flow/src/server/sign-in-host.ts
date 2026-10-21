import {
  SignInHostEntryResponseSchema,
  type SignInHostDoor,
  type SignInHostEntryResponse,
  type SignInHostStorefront,
} from "@ds/schemas";

import type {
  AuthFlowApiConfig,
  AuthFlowHostConfig,
  AuthFlowRoutes,
} from "../host-config";

/**
 * 003 EARS-60 / 70 / 71, ADR-0015 §4 — the sign-in host's projection of a
 * storefront's host config (#3170).
 *
 * The sign-in host renders the ORIGINATING storefront's own config — the one
 * the API's entry answer chose by `client_id` — and varies only its transport:
 *
 * - `api`: every storefront path mirrored under `/v1/sign-in-host` (the host
 *   API answers each storefront command under the same tail, bound to the
 *   form state), plus the `formPost` binding of this one auth request;
 * - the four door `routes` carry `?authRequest=<id>`, so a hop between doors
 *   stays on the same auth request.
 *
 * Fields, copy, consents, brand and landing stay the storefront's, byte for
 * byte («a field is one thing; the host varies only the set»).
 */

/** The render answer of `GET /v1/sign-in-host/entry`. */
export type SignInHostRender = Extract<
  SignInHostEntryResponse,
  { action: "render" }
>;

/** The search param Zitadel Login V2 names the auth request in. */
export const SIGN_IN_HOST_AUTH_REQUEST_PARAM = "authRequest";

const SIGN_IN_HOST_API_ROOT = "/v1/sign-in-host";

/** `/v1/auth/x` and `/v1/storefront/…` → the same tail under the host API root. */
function onHostApi(path: string): string {
  return `${SIGN_IN_HOST_API_ROOT}${path.replace(/^\/v1(?:\/auth(?=\/|$))?/, "")}`;
}

function withAuthRequest(route: string, authRequest: string): string {
  const sep = route.includes("?") ? "&" : "?";
  return `${route}${sep}${SIGN_IN_HOST_AUTH_REQUEST_PARAM}=${encodeURIComponent(authRequest)}`;
}

/** The storefront config with the sign-in host's transport for this auth request. */
export function signInHostConfig(
  storefront: AuthFlowHostConfig,
  render: SignInHostRender,
): AuthFlowHostConfig {
  const api: AuthFlowApiConfig = {
    basePath: onHostApi(storefront.api.basePath),
    registerPath: onHostApi(storefront.api.registerPath),
    verifyPath: onHostApi(storefront.api.verifyPath),
    formPost: {
      authRequest: render.authRequest,
      csrf: render.csrf,
      ...(render.intent?.handoff ? { handoff: true } : {}),
    },
  };
  const routes: AuthFlowRoutes = {
    ...storefront.routes,
    login: withAuthRequest(storefront.routes.login, render.authRequest),
    register: withAuthRequest(storefront.routes.register, render.authRequest),
    verify: withAuthRequest(storefront.routes.verify, render.authRequest),
    reset: withAuthRequest(storefront.routes.reset, render.authRequest),
  };
  return { ...storefront, api, routes };
}

/**
 * EARS-71 — the search params the mounted door reads, built ONLY from the
 * entry answer: the resolved intent's method (`method=code`) and its event
 * reference as THIS storefront's event path (`returnTo`, which the shared
 * return-context read turns into the card). Every param of the browser's URL
 * is dropped: an unknown, spent or foreign intent arrives as no intent and
 * renders the plain form, with no card. The verify door keeps the address it
 * was hopped to with (`email`), the one value a door hands the next.
 */
export function signInHostSearchParams(
  storefront: AuthFlowHostConfig,
  render: SignInHostRender,
  browser: Record<string, string | string[] | undefined>,
  door: SignInHostDoor | "verify",
): Record<string, string> {
  const params: Record<string, string> = {};
  const intent = render.intent;
  if (door === "login" && intent?.method === "code") params.method = "code";
  if (intent?.eventTarget && (door === "login" || door === "register")) {
    params.returnTo = storefront.routes.eventPathTemplate.replace(
      ":slug",
      encodeURIComponent(intent.eventTarget),
    );
  }
  if (door === "verify") {
    const email = Array.isArray(browser.email)
      ? browser.email[0]
      : browser.email;
    if (email) params.email = email;
  }
  return params;
}

/** A door page of the sign-in host: the entry's three doors plus the code step. */
export type SignInHostPageDoor = SignInHostDoor | "verify";

const PAGE_DOORS: readonly SignInHostPageDoor[] = [
  "login",
  "register",
  "reset",
  "verify",
];

/** Each storefront's own host config, as the sign-in host mounts them. */
export type SignInHostStorefronts = Readonly<
  Record<SignInHostStorefront, AuthFlowHostConfig>
>;

/**
 * The request header the sign-in host's proxy hands the entry answer to the
 * page in (#3170). The proxy overwrites it on every door navigation, so a
 * browser-sent value never reaches a page; the page re-validates it anyway.
 */
export const SIGN_IN_HOST_ENTRY_HEADER = "x-ds-sign-in-entry";

/**
 * The request header the proxy names an unread entry in (#3170): the API
 * refused the entry read (`rate-limited`, its 429) or could not answer
 * (`unavailable`). The page then renders the forms' own banner for that case
 * instead of a form — the response status stays the proxy's truthful one.
 * The proxy deletes a browser-sent value on every other answer.
 */
export const SIGN_IN_HOST_UNAVAILABLE_HEADER = "x-ds-sign-in-unavailable";

export type SignInHostUnavailable = "rate-limited" | "unavailable";

/** The proxy's unread-entry reason; `null` if absent or unknown. */
export function readSignInHostUnavailable(
  value: string | null | undefined,
): SignInHostUnavailable | null {
  return value === "rate-limited" || value === "unavailable" ? value : null;
}

/** What the page renders: the door and the entry's render answer. */
export type SignInHostHandOver = {
  door: SignInHostPageDoor;
  render: SignInHostRender;
};

export function writeSignInHostHandOver(handOver: SignInHostHandOver): string {
  return Buffer.from(JSON.stringify(handOver), "utf8").toString("base64url");
}

/** The proxy's hand-over, re-validated against the contract; `null` if absent or malformed. */
export function readSignInHostHandOver(
  value: string | null | undefined,
): SignInHostHandOver | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { door?: unknown; render?: unknown };
    const render = SignInHostEntryResponseSchema.parse(raw.render);
    if (render.action !== "render") return null;
    const door = PAGE_DOORS.find((d) => d === raw.door);
    return door ? { door, render } : null;
  } catch {
    return null;
  }
}
