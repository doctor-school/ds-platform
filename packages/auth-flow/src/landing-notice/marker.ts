/**
 * 021 EARS-10 (amendment 2026-11-11, #2272) — the ONE marker the storefront
 * callback (and the signed-in entry redirect) adds to the default landing when
 * the carried эфир no longer exists (the public event read answered 404).
 *
 * A fixed parameter with a single whitelisted value: no slug, no free text and
 * no reason string ever travels in the URL, and any other value means nothing.
 * A failed or unasked event read is not «gone» and never carries it.
 */
export const LANDING_NOTICE_PARAM = "notice";
export const EVENT_GONE_NOTICE_VALUE = "event-gone";

/** The landing path with the event-gone marker appended (as a string, never re-parsed). */
export function withEventGoneNotice(path: string): string {
  const [beforeHash = path] = path.split("#", 1);
  const separator = beforeHash.includes("?") ? "&" : "?";
  return `${beforeHash}${separator}${LANDING_NOTICE_PARAM}=${EVENT_GONE_NOTICE_VALUE}`;
}

/**
 * Whether a route's `searchParams` carry the event-gone marker — exactly the
 * whitelisted value, once; a repeated or any other value is not the marker.
 */
export function hasEventGoneNotice(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): boolean {
  return searchParams[LANDING_NOTICE_PARAM] === EVENT_GONE_NOTICE_VALUE;
}
