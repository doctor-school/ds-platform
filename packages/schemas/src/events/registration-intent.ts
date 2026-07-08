import { z } from "zod";

// 005 EARS-2 — the safe, same-origin registration-intent carried through the 003
// login/signup round-trip (design §3.2). A guest who activates «Участвовать» is
// taken through the shipped auth flow; the ONLY thing 005 carries across that
// round-trip is a safe event context — the event slug plus a same-origin
// `returnTo` path — so the doctor returns to the originally chosen event and the
// same `RegisterForEvent` (EARS-1) fires once the session exists. There is NO
// server-side "postponed registration" record (the retired legacy mechanism); the
// intent lives only in the round-trip.
//
// This module is the framework-agnostic SSOT (ADR-0002 §3) for what a SAFE intent
// is, consumed by the portal on BOTH sides of the handoff: the 004 CTA builds the
// returnTo (`buildRegistrationHref`) and the 003 auth pages validate it before
// they navigate back (an attacker-supplied `/login?returnTo=…` must never become
// an open redirect). The api unit `return-target.guard.spec.ts` pins the contract.

/**
 * A registration intent is only ever a return target under the same-origin
 * `/webinars/` path — the public event page. Anchoring every safe returnTo under
 * this single prefix is what makes an open-redirect (`//evil`, `https://evil`,
 * `/\evil`, `../account`) structurally impossible: a value that does not resolve
 * to exactly `/webinars/<slug>` is rejected outright.
 */
export const RETURN_TARGET_PREFIX = "/webinars/";

/**
 * The event-slug shape a safe return target may carry: lowercase/uppercase
 * alphanumerics in hyphen/underscore-separated groups (matching the seeded +
 * real webinar slugs, e.g. `ahilles-042`). Deliberately narrow — it admits no
 * `.`, `/`, `\`, whitespace, or percent-escape, so `.`/`..` traversal and encoded
 * separators can never survive as a "slug". A separator never leads, trails, or
 * repeats.
 */
const SLUG_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i;

/**
 * The safe registration-intent that rides the 003 round-trip (EARS-2). It carries
 * ONLY the event context — never PII, never a credential; the strict schema below
 * rejects any extra field. `returnTo` is always the canonical same-origin
 * `/webinars/<eventSlug>` path.
 */
export interface RegistrationIntent {
  /** The public slug of the event the guest chose to register for. */
  readonly eventSlug: string;
  /** The canonical same-origin return path: `/webinars/<eventSlug>`. */
  readonly returnTo: string;
}

/**
 * The strict DTO for a registration-intent. `.strict()` is load-bearing: it is
 * what rejects a PII/credential-laden payload (an intent that also carries
 * `email`, `password`, a token, …) — the intent may hold the event context and
 * nothing else (EARS-2 Constraints). Used to validate a structured intent; the
 * string→intent parse below is `parseReturnTarget`.
 */
export const RegistrationIntentSchema = z
  .object({
    eventSlug: z.string().regex(SLUG_RE),
    returnTo: z.string().startsWith(RETURN_TARGET_PREFIX),
  })
  .strict();

/**
 * Parse a raw `returnTo` value (typically read off a `/login?returnTo=…` or
 * `/register?returnTo=…` query) into a SAFE {@link RegistrationIntent}, or `null`
 * when it is not a same-origin event return target. This is the open-redirect
 * guard (EARS-2 Constraints): it accepts a value ONLY when it resolves to exactly
 * `/webinars/<slug>` — a single same-origin path segment — and rejects everything
 * else, so the caller can navigate to `intent.returnTo` without ever emitting a
 * cross-origin or traversal target.
 *
 * Rejected (→ `null`): a non-string; a cross-origin or protocol-relative target
 * (`https://evil`, `//evil`); a backslash trick (`/\evil`, `/webinars/\..`); a
 * value not anchored under `/webinars/`; an empty, multi-segment, or traversal
 * slug (`/webinars/`, `/webinars/a/b`, `/webinars/../account`), including its
 * percent-encoded forms (`%2f`, `%2e%2e`); and any slug outside {@link SLUG_RE}
 * (query/hash injection, whitespace, dots).
 */
export function parseReturnTarget(returnTo: unknown): RegistrationIntent | null {
  if (typeof returnTo !== "string") return null;
  // A backslash never belongs in a same-origin path and is a classic redirect
  // bypass (browsers may treat `/\evil` as `//evil`); reject the whole value.
  if (returnTo.includes("\\")) return null;
  if (!returnTo.startsWith(RETURN_TARGET_PREFIX)) return null;

  const rest = returnTo.slice(RETURN_TARGET_PREFIX.length);
  // Exactly one path segment: no further slash (`/webinars/a/b`, `/webinars//x`).
  if (rest.length === 0 || rest.includes("/")) return null;

  // Decode once to unmask an encoded separator/traversal (`%2f`, `%2e%2e`); a
  // malformed escape is itself a reject.
  let slug: string;
  try {
    slug = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (!SLUG_RE.test(slug)) return null;

  // Reconstruct the canonical return path from the validated slug rather than
  // trusting the raw input verbatim — the slug is `SLUG_RE`-safe, so this is a
  // stable, injection-free same-origin path.
  return { eventSlug: slug, returnTo: `${RETURN_TARGET_PREFIX}${slug}` };
}

/** `true` iff `returnTo` is a safe same-origin event return target (EARS-2). */
export function isSafeReturnTarget(returnTo: unknown): boolean {
  return parseReturnTarget(returnTo) !== null;
}
