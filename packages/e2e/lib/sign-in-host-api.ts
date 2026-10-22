/**
 * Where a sign-in form posts now that the forms live on the sign-in host
 * (ADR-0015 §4, 003 EARS-60/71, #3172).
 *
 * A storefront's `/login`, `/register`, `/reset` and `/verify` answer `303` to
 * the IdP, which sends the visitor to the sign-in host (`apps/login`). The form
 * there is the storefront's own form, byte for byte, but its transport is the
 * host API: `/v1/auth/x` and `/v1/storefront/…` keep their tail under
 * `/v1/sign-in-host` (`onHostApi` in `@ds/auth-flow/server` → `sign-in-host.ts`
 * is the product's one mapping; this is its mirror for the browser suite, which
 * cannot import the React package). A step that watched `/v1/auth/login` on the
 * storefront watches `signInHostApiPath("/v1/auth/login")` on the host — same
 * request, same guards, same refusals.
 */
export const SIGN_IN_HOST_API_ROOT = "/v1/sign-in-host";

export function signInHostApiPath(path: string): string {
  return `${SIGN_IN_HOST_API_ROOT}${path.replace(/^\/v1(?:\/auth(?=\/|$))?/, "")}`;
}

/** The query parameter Zitadel Login V2 names the auth request in. */
export const AUTH_REQUEST_PARAM = "authRequest";

/**
 * True when `url` is a sign-in host form: the host's own origin (when known)
 * and the auth request the IdP handed it. The storefront origin never carries
 * an `authRequest`, so the parameter alone tells the two apart on a stand
 * whose sign-in host origin the run was not given.
 */
export function isSignInHostForm(
  url: string | URL,
  signInHostOrigin?: string,
): boolean {
  const parsed = new URL(url);
  if (signInHostOrigin && parsed.origin !== new URL(signInHostOrigin).origin) {
    return false;
  }
  return parsed.searchParams.has(AUTH_REQUEST_PARAM);
}

/**
 * True for a browser POST that is an auth COMMAND on either side of the switch:
 * the storefront's own `/v1/auth/*` (logout, session refresh — what a signed-in
 * storefront page still sends) or the sign-in host's `/v1/sign-in-host/*`
 * (every form step). A step that records «which auth commands did the page
 * send» watches both, so a refusal that must send NOTHING is checked against
 * the host traffic too, never vacuously against a prefix nobody posts to.
 */
export function isAuthCommandPath(pathname: string): boolean {
  return (
    pathname.startsWith("/v1/auth/") ||
    pathname.startsWith(`${SIGN_IN_HOST_API_ROOT}/`)
  );
}

/**
 * The command a sign-in host form posted, without its form-post fields: every
 * host step carries the storefront command PLUS `authRequest` and `csrf` (the
 * form state it acts on, 003 EARS-69/70). A step that proved «exactly these
 * fields» proves them on what this returns. A body missing either form field
 * (or not an object) yields `{}`, so no field check can pass on it.
 */
export function hostCommand(request: unknown): Record<string, unknown> {
  if (request === null || typeof request !== "object" || Array.isArray(request))
    return {};
  const { authRequest, csrf, ...command } = request as Record<string, unknown>;
  if (
    typeof authRequest !== "string" ||
    authRequest.length === 0 ||
    typeof csrf !== "string" ||
    csrf.length === 0
  )
    return {};
  return command;
}

/**
 * 003 EARS-44 on the sign-in host: the hand-off redemption names NO reference —
 * its body is the form-post fields alone and the API reads the reference from
 * the form state (the storefront command was `{ ref }`). True when `body` is
 * exactly a host form post and the reference appears nowhere in it.
 */
export function handoffCommandWithoutReference(
  body: unknown,
  reference: string,
): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return false;
  const keys = Object.keys(body).sort().join(",");
  return (
    keys === "authRequest,csrf" &&
    Object.keys(hostCommand(body)).length === 0 &&
    !JSON.stringify(body).includes(reference)
  );
}
