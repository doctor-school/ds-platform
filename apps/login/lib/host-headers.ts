/**
 * 003 EARS-70, ADR-0015 §4 req. 2(a) / 4 — the response hardening every answer
 * of the sign-in host carries, and the navigate-only test of its page routes.
 *
 * The strict nonce CSP is net-new in this repository (no storefront ships one):
 * the proxy mints a fresh nonce per request, puts the policy on the RESPONSE
 * and on the forwarded REQUEST — Next reads the nonce out of the request's
 * `Content-Security-Policy` header and stamps it on every script it renders —
 * and `'strict-dynamic'` lets those scripts load their own chunks (and the
 * SmartCaptcha loader) without a host allow-list. See `apps/login/README.md`.
 */

/** 128 random bits, base64 — fresh per request. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** The SmartCaptcha origin the bot-protection widget frames and calls (EARS-17). */
const SMARTCAPTCHA_ORIGIN = "https://smartcaptcha.yandexcloud.net";

/**
 * The page policy. `'unsafe-eval'` only under `next dev` (React Refresh); the
 * production image never sends it. Styles stay `'unsafe-inline'`: React style
 * attributes and `next/font` inject inline styles, and a style cannot run code.
 */
export function contentSecurityPolicy(
  nonce: string,
  dev = process.env.NODE_ENV === "development",
): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${SMARTCAPTCHA_ORIGIN}`,
    `frame-src ${SMARTCAPTCHA_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Every response besides its CSP: no opener, no referrer, no sniffing. */
export const HARDENING_HEADERS: Readonly<Record<string, string>> = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

/**
 * ADR-0015 §4 req. 2(a) — a top-level navigation: `Sec-Fetch-Mode: navigate`
 * AND `Sec-Fetch-Dest: document`. A request without fetch metadata is not
 * one; a frame, a fetch or a prefetch is not one either (Next's client router
 * falls back to a full navigation when its fetch is refused).
 */
export function isTopLevelNavigation(headers: Headers): boolean {
  return (
    headers.get("sec-fetch-mode") === "navigate" &&
    headers.get("sec-fetch-dest") === "document"
  );
}
