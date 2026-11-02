/**
 * 003 EARS-10 (amended) / EARS-63 (a), ADR-0015 §4 req. 6 — the storefront's
 * own sign-out route, the POST the account «Выйти» (`getByTestId("logout")`)
 * sends since #3534. The storefront server calls the API `POST
 * /v1/auth/logout` over the internal network and relays its answer (the cleared
 * `__Host-ds_session` included) plus the guest marker, so a step that clicks
 * «Выйти» observes THIS path; the browser never sends `/v1/auth/logout` (#3588).
 *
 * Mirrors `STOREFRONT_SIGN_OUT_PATH` of `@ds/auth-flow` (`src/sign-out-path.ts`)
 * — not imported, because that package's types reach `@ds/design-system` .tsx
 * sources this JSX-free package cannot type-check; `storefront-sign-out.test.ts`
 * pins the two equal.
 */
export const STOREFRONT_SIGN_OUT_PATH = "/auth/sign-out";

/**
 * True when the `Set-Cookie` values of a response carry the cookie `name`
 * expired (`Max-Age=0`). The storefront sign-out answers TWO cookies — the
 * relayed cleared `__Host-ds_session`, then the guest marker (003 EARS-10
 * amended) — and Playwright's `headerValue("set-cookie")` joins them with
 * "\n", so a check over the joined string cannot tell whose `Max-Age` it saw
 * (#3588). Each entry is judged on its own: the one whose name is exactly
 * `name` must carry `Max-Age=0`. Pass `headerValues("set-cookie")`; joined
 * values are split too.
 */
export function clearsCookie(
  setCookieValues: readonly string[],
  name: string,
): boolean {
  const entry = setCookieValues
    .flatMap((value) => value.split("\n"))
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  if (entry === undefined) return false;
  return entry
    .split(";")
    .slice(1)
    .some((attribute) => /^max-age=0$/i.test(attribute.trim()));
}
