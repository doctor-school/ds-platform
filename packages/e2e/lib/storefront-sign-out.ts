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
