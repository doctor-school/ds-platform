import { SESSION_COOKIE_NAME, forwardedSessionFrom } from "@ds/schemas";

import { internalApi, readCookie } from "./oidc-internal";
import { guestMarkerCookie } from "./silent-check";

/**
 * 003 EARS-10 (amended), ADR-0015 §4 «One sign-out on both storefronts» req.
 * 6, EARS-63 (a) — the storefront sign-out (`POST /auth/sign-out`), the ONE
 * core both storefronts mount (ADR-0013 A1).
 *
 * One server-side call to the API's `POST /v1/auth/logout`, which terminates
 * the shared Zitadel session through the Session API v2, deletes the
 * sign-in-host record and revokes every storefront session linked to it on
 * both storefronts. Its answer is relayed (the cleared `__Host-ds_session`
 * included) and, when it succeeded, the signed `__Host-ds_guest` marker is set
 * on THIS storefront, so its next navigation renders as a guest without a
 * silent check. No OIDC `end_session` redirect exists on this path, so no
 * Zitadel V1 page can appear.
 *
 * The API is reached over the internal network (`INTERNAL_API_URL`) with the
 * browser's session cookie and fingerprint surface, as the BFF rewrite
 * forwards them; the internal credential is the marker's HMAC key only and
 * never rides the call.
 */
export interface StorefrontSignOutDeps {
  readonly fetchImpl?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => number;
}

function unavailable(): Response {
  return Response.json(
    { message: "sign-out unavailable" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

/**
 * A browser marks every request with `Sec-Fetch-Site`; the storefront's own
 * sign-out button sends `same-origin`. A POST from any other page (a
 * cross-site form, the other storefront) is refused before anything runs, so
 * it can neither clear this storefront's cookie nor set its guest marker. A
 * client that sends no such header (not a browser) is not a forgery vector.
 */
function crossOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin";
}

export async function storefrontSignOut(
  request: Request,
  deps: StorefrontSignOutDeps = {},
): Promise<Response> {
  if (crossOrigin(request))
    return Response.json(
      { message: "cross-origin sign-out refused" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  const api = internalApi(deps.env ?? process.env);
  if (!api) return unavailable();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? Date.now)();

  const sid = readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  const s = forwardedSessionFrom(request.headers);
  let res: Response;
  try {
    res = await fetchImpl(`${api.base}/v1/auth/logout`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(sid ? { cookie: `${SESSION_COOKIE_NAME}=${sid}` } : {}),
        ...(s.userAgent ? { "user-agent": s.userAgent } : {}),
        ...(s.acceptLanguage ? { "accept-language": s.acceptLanguage } : {}),
        ...(s.forwardedFor ? { "x-forwarded-for": s.forwardedFor } : {}),
      },
      body: "{}",
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return unavailable();
  }

  const headers = new Headers({
    "content-type": res.headers.get("content-type") ?? "application/json",
    "cache-control": "no-store",
  });
  for (const cookie of res.headers.getSetCookie())
    headers.append("set-cookie", cookie);
  if (res.ok)
    headers.append("set-cookie", await guestMarkerCookie(api.token, now));
  return new Response(await res.text(), { status: res.status, headers });
}
