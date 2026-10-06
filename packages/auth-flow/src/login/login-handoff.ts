/**
 * 003 EARS-44 — the Congress sign-in hand-off as `/login` sees it: the search
 * param that carries the reference, the closed shape check the mount reads it
 * through, and the address-bar strip the door runs right after reading it.
 *
 * Plain helpers with no React and no Next import, so the server mount and the
 * client door share the one parameter name and the one rule.
 */

/** The search param the Congress «Войти в кабинет» button carries the reference in. */
export const LOGIN_HANDOFF_PARAM = "handoff";

/**
 * The reference is 32 random bytes, base64url without padding — exactly 43
 * characters of `A–Z a–z 0–9 - _` (044 EARS-39). Anything else is refused here
 * and never sent to the api: it would only get the fallback answer anyway.
 */
const HANDOFF_REF_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The reference the door may redeem, or `null`. A repeated param's FIRST value
 * wins, like `returnTo` and `method`; a malformed value is dropped, never echoed.
 */
export function resolveHandoffRef(
  raw: string | string[] | undefined,
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && HANDOFF_REF_SHAPE.test(value) ? value : null;
}

/**
 * Removes `handoff` from the address bar by history REPLACE, keeping every
 * other param (`method`, `returnTo`) and the router's own history state, so a
 * reload does not redeem the reference again and it never stays in history.
 * A no-op when the param is absent.
 */
export function stripHandoffFromAddressBar(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(LOGIN_HANDOFF_PARAM)) return;
  url.searchParams.delete(LOGIN_HANDOFF_PARAM);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}
