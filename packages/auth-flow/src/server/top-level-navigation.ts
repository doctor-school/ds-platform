/**
 * ADR-0015 §4 req. 2(a) — a top-level navigation: `Sec-Fetch-Mode: navigate`
 * AND `Sec-Fetch-Dest: document`. A request without fetch metadata is not
 * one; a frame, a fetch, an RSC / router prefetch (`Next-Router-Prefetch`,
 * `RSC: 1`, `Sec-Purpose: prefetch` — none of them navigates a document) is
 * not one either (Next's client router falls back to a full navigation when
 * its fetch is refused).
 *
 * The ONE predicate both halves of the sign-in read (ADR-0013 A1): the sign-in
 * host's page routes (`apps/login/proxy.ts`) and the storefront entries
 * (`storefrontEntry`, 003 EARS-61), which act only on such a navigation.
 */
export function isTopLevelNavigation(headers: Headers): boolean {
  return (
    headers.get("sec-fetch-mode") === "navigate" &&
    headers.get("sec-fetch-dest") === "document"
  );
}
