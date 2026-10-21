/**
 * ADR-0015 §4 req. 4 — the sign-in host's two cookies. Both are host-only
 * (`__Host-`, no `Domain`), `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`; they
 * land on the sign-in host because it reaches the API through its own
 * same-origin `/v1` rewrite.
 *
 * - `__Host-ds_login` — the shared browser session record (EARS-64), rotated on
 *   every credential step (req. 5), `Max-Age` = what is left of the record.
 * - `__Host-ds_login_form` — keys the server-side form state (req. 3 CSRF,
 *   EARS-66 recorded storefront).
 */
export const RECORD_COOKIE_NAME = "__Host-ds_login";
export const FORM_COOKIE_NAME = "__Host-ds_login_form";

/** Form state (and its cookie) outlive the auth request so a stale tab still finds its storefront. */
export const FORM_STATE_TTL_SECONDS = 24 * 60 * 60;

function serialize(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export const recordCookie = (cookieId: string, maxAgeSeconds: number): string =>
  serialize(RECORD_COOKIE_NAME, cookieId, maxAgeSeconds);

export const clearRecordCookie = (): string =>
  serialize(RECORD_COOKIE_NAME, "", 0);

export const formCookie = (cookieId: string): string =>
  serialize(FORM_COOKIE_NAME, cookieId, FORM_STATE_TTL_SECONDS);
