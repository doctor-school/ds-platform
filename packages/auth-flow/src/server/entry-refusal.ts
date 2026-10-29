import { NextResponse } from "next/server";

/**
 * 003 EARS-72 — an entry the API refused or could not answer, as the request
 * gate hands it to the refusal page (the storefront door gates and the
 * sign-in host's proxy alike).
 *
 * - `reason`: the API's 429 is `rate-limited`; any other refusal, a transport
 *   failure or an answer off its contract is `unavailable`.
 * - `retryAfterSeconds`: the API's `Retry-After` delta-seconds (≥ 1), or
 *   `null` when it sent none or one that does not parse — then the retry is
 *   open at once (no invented wait).
 * - `eventSlug`: the event page the person came from (the entry's own event
 *   return target), so the way out names it; absent ⇒ the home page.
 */
export type EntryRefusalReason = "rate-limited" | "unavailable";

export type EntryRefusal = {
  readonly reason: EntryRefusalReason;
  readonly retryAfterSeconds: number | null;
  readonly eventSlug?: string;
};

/**
 * The request header the gate hands the refusal to the page in. The gate
 * deletes a browser-sent value on every door navigation it forwards; the
 * page re-validates the value anyway.
 */
export const ENTRY_REFUSAL_HEADER = "x-ds-entry-refusal";

/** The truthful status of a refusal: the API's 429 stays 429, anything else is 503. */
export function entryRefusalStatus(reason: EntryRefusalReason): 429 | 503 {
  return reason === "rate-limited" ? 429 : 503;
}

/** `Retry-After` as delta-seconds ≥ 1; anything else (absent, a date, `0`, junk) is `null`. */
export function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/.test(value.trim())) return null;
  const seconds = Number(value.trim());
  return seconds >= 1 ? seconds : null;
}

/** The refusal as an ASCII header value (URL-encoded pairs). */
export function writeEntryRefusal(refusal: EntryRefusal): string {
  const params = new URLSearchParams({ reason: refusal.reason });
  if (refusal.retryAfterSeconds !== null) {
    params.set("retryAfter", String(refusal.retryAfterSeconds));
  }
  if (refusal.eventSlug) params.set("event", refusal.eventSlug);
  return params.toString();
}

/** The refusal a header carries, or `null` for an absent or malformed one. */
export function readEntryRefusal(value: string | null): EntryRefusal | null {
  if (!value) return null;
  const params = new URLSearchParams(value);
  const reason = params.get("reason");
  if (reason !== "rate-limited" && reason !== "unavailable") return null;
  const event = params.get("event");
  return {
    reason,
    retryAfterSeconds:
      reason === "rate-limited" ? parseRetryAfter(params.get("retryAfter")) : null,
    ...(event ? { eventSlug: event } : {}),
  };
}

/**
 * The gate's answer to a refused entry: a rewrite to the host's refusal page
 * (the address stays the door URL the person opened, so a retry is a
 * navigation to it) at the truthful status, `Retry-After` forwarded, the
 * refusal riding as a request header.
 */
export function entryRefusalRewrite(
  request: Request,
  page: string,
  refusal: EntryRefusal,
  forwarded: Headers = new Headers(request.headers),
): NextResponse {
  forwarded.set(ENTRY_REFUSAL_HEADER, writeEntryRefusal(refusal));
  const res = NextResponse.rewrite(new URL(page, request.url), {
    status: entryRefusalStatus(refusal.reason),
    request: { headers: forwarded },
  });
  if (refusal.retryAfterSeconds !== null) {
    res.headers.set("Retry-After", String(refusal.retryAfterSeconds));
  }
  res.headers.set("cache-control", "no-store");
  return res;
}
