import { timingSafeEqual } from "node:crypto";
import { SESSION_TTL_SECONDS } from "../auth/session/session.service.js";

/**
 * 003 EARS-64 / EARS-68 — the pure lifetime, idle and fresh-credential rules of
 * the sign-in-host record. Kept free of I/O so every boundary is unit-proven.
 */

/**
 * The explicit Zitadel session lifetime (ADR-0015 §4): the web-session ceiling
 * of ADR-0001 §6, the very value the storefront sessions carry.
 */
export const SIGN_IN_HOST_SESSION_LIFETIME_SECONDS = SESSION_TTL_SECONDS;

/** EARS-64 — a record that finalised no authorize for 7 days is expired. */
export const SIGN_IN_HOST_IDLE_SECONDS = 7 * 24 * 60 * 60;

export interface RecordTimes {
  readonly lastCredentialAt: Date;
  readonly lastFinalisedAt: Date;
  readonly expiresAt: Date;
  readonly fingerprint: string;
}

/** The absolute end of a record: its credential step + 30 days, never extended. */
export function recordExpiresAt(lastCredentialAt: Date): Date {
  return new Date(
    lastCredentialAt.getTime() + SIGN_IN_HOST_SESSION_LIFETIME_SECONDS * 1000,
  );
}

export type RecordVerdict = "usable" | "expired" | "foreign";

/**
 * EARS-64 — may this record answer the request it arrived with?
 * `foreign` (fingerprint mismatch) and `expired` (30-day absolute or 7-day
 * idle) both mean: delete it, terminate its Zitadel session, treat the browser
 * as signed out.
 */
export function recordVerdict(
  record: RecordTimes,
  now: Date,
  fingerprint: string,
): RecordVerdict {
  if (!sameFingerprint(record.fingerprint, fingerprint)) return "foreign";
  if (now.getTime() >= record.expiresAt.getTime()) return "expired";
  const idleMs = now.getTime() - record.lastFinalisedAt.getTime();
  if (idleMs >= SIGN_IN_HOST_IDLE_SECONDS * 1000) return "expired";
  return "usable";
}

function sameFingerprint(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * EARS-68 — does the auth request ask for a fresh credential step:
 * `prompt=login`, or a `max_age` shorter than the time since the record's
 * last credential check (ADR-0015 §4 req. 11).
 */
export function freshCredentialAsked(input: {
  prompt: readonly string[];
  maxAgeSeconds: number | undefined;
  lastCredentialAt: Date;
  now: Date;
}): boolean {
  if (input.prompt.includes("login")) return true;
  if (input.maxAgeSeconds === undefined) return false;
  const sinceMs = input.now.getTime() - input.lastCredentialAt.getTime();
  return sinceMs > input.maxAgeSeconds * 1000;
}

/** The `Max-Age` of `__Host-ds_login`: what is left of the record, never more. */
export function recordCookieMaxAgeSeconds(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}
