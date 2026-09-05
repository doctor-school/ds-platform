import { z } from "zod";
import {
  encodeDoctorEventsFeedQueryEntries,
  parseDoctorEventsFeedQuery,
} from "./doctor-events-feed.schema.js";
import {
  encodeQueryString,
  rawQueryFromEntries,
  type EventListingQueryEntry,
  type RawQueryRecord,
} from "./event-listing-query.schema.js";

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
// is, consumed by the portal on BOTH sides of the handoff: the server-resolved
// `ParticipationCta` emits the returnTo and the 003 auth pages validate it before
// they navigate back (an attacker-supplied `/login?returnTo=…` must never become
// an open redirect). The api unit `return-target.guard.spec.ts` pins the contract.

/**
 * The academy shape's prefix: the same-origin `/webinars/` public event page.
 *
 * A safe return target is never "a path that looks harmless" — it is a value of
 * one DECLARED shape, reconstructed from its validated parts (021 LD-3). This
 * prefix anchors the first such shape; the doctor feed's `/events?…&resume=…`
 * is the second, and the list of shapes is {@link RETURN_TARGET_SHAPES}. An
 * open redirect (`//evil`, `https://evil`, `/\evil`, `../account`) matches no
 * shape and is therefore rejected outright.
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
 * rejects any extra field. `returnTo` is always a CANONICAL same-origin path of
 * one declared shape — 005's `/webinars/<eventSlug>` or 019's
 * `/events?<feed query>&resume=<eventSlug>`.
 *
 * The interface stays exactly two fields on purpose: a consumer resumes by
 * registering `eventSlug` and navigating to `returnTo`, which is why
 * `completeReturnTarget` (005) and `resolveReturnContext` (021 EARS-2) needed
 * no change when the feed shape was added.
 */
export interface RegistrationIntent {
  /** The public slug of the event the guest chose to register for. */
  readonly eventSlug: string;
  /** The canonical same-origin return path of the shape that matched. */
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
    /**
     * A returnTo is valid exactly when it is one of the DECLARED shapes below
     * AND is already in its canonical, reconstructed form — the schema delegates
     * to the one guard rather than restating a prefix, so a shape added to
     * {@link RETURN_TARGET_SHAPES} is admitted here without a second edit and a
     * shape removed from it stops validating everywhere at once.
     */
    returnTo: z
      .string()
      .refine((value) => parseReturnTarget(value)?.returnTo === value, {
        message: "expected a canonical same-origin registration return target",
      }),
  })
  .strict();

/**
 * Parse a raw `returnTo` value (typically read off a `/login?returnTo=…` or
 * `/register?returnTo=…` query) into a SAFE {@link RegistrationIntent}, or `null`
 * when it is of no declared shape. This is the open-redirect guard (005 EARS-2
 * Constraints, widened by 021 LD-3 into an explicit WHITELIST): the value is
 * offered to each shape in {@link RETURN_TARGET_SHAPES} in turn and the first
 * match wins, and every accepted value is RECONSTRUCTED from its validated
 * parts — so the caller can navigate to `intent.returnTo` without ever emitting
 * a cross-origin, traversal, or smuggled-parameter target.
 *
 * Rejected (→ `null`): a non-string; a cross-origin or protocol-relative target
 * (`https://evil`, `//evil`); a backslash trick (`/\evil`, `/webinars/\..`); a
 * value matching no shape; an empty, multi-segment, or traversal slug
 * (`/webinars/`, `/webinars/a/b`, `/webinars/../account`, `/events?resume=a/b`),
 * including its percent-encoded forms (`%2f`, `%2e%2e`); and any slug outside
 * {@link SLUG_RE} (query/hash injection, whitespace, dots).
 */
export function parseReturnTarget(returnTo: unknown): RegistrationIntent | null {
  if (typeof returnTo !== "string") return null;
  // A backslash never belongs in a same-origin path and is a classic redirect
  // bypass (browsers may treat `/\evil` as `//evil`); reject the whole value
  // before any shape sees it.
  if (returnTo.includes("\\")) return null;

  for (const parseShape of RETURN_TARGET_SHAPES) {
    const intent = parseShape(returnTo);
    if (intent !== null) return intent;
  }
  return null;
}

/**
 * One declared return-target shape: a total function from a raw string to a
 * SAFE intent, or `null` when the value is not of that shape.
 */
type ReturnTargetShapeParser = (returnTo: string) => RegistrationIntent | null;

/** 1. `academy-event` — `/webinars/<slug>`, the 005 public event page. */
function parseAcademyEventTarget(returnTo: string): RegistrationIntent | null {
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

/** The doctor feed's own path — the ONLY path this second shape admits. */
const DOCTOR_EVENTS_FEED_PATH = "/events";

/**
 * The query key that carries the event a guest chose from the feed. It is NOT a
 * feed facet: the codec never declares it, so it can never reach the api read —
 * it exists purely so the round-trip knows which card to resume (019 LD-7).
 */
export const DOCTOR_EVENTS_FEED_RESUME_KEY = "resume";

/**
 * The longest return target any shape will admit. A bounded value is what keeps
 * a hand-built URL from turning the round-trip into a payload channel.
 */
const MAX_RETURN_TARGET_LENGTH = 512;

/** A scheme (`https:`, `javascript:`) at the head of the value — never same-origin. */
const SCHEME_PREFIX_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * `true` when the value carries a character no declared return target may hold:
 * any control character or space (code point ≤ 0x20), `#` (0x23 — a fragment is
 * never part of a return target and is the classic way to hide a payload from a
 * server-side check) or DEL (0x7f). Written as a code-point walk rather than a
 * regex so the forbidden set is stated in readable numbers instead of escapes.
 */
function hasForbiddenTargetChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x23 || code === 0x7f) return true;
  }
  return false;
}

/**
 * One `key=value` pair of a query string, decoded exactly once — or `null` when
 * either half carries a malformed percent-escape.
 */
function decodeQueryComponent(value: string): string | null {
  try {
    // `+` is a space in the query grammar, as every URL parser reads it.
    return decodeURIComponent(value.split("+").join(" "));
  } catch {
    return null;
  }
}

/**
 * `a=1&b=2` → the ordered `[key, value]` pairs, or `null` on a malformed escape.
 *
 * `@ds/schemas` depends on `zod` and nothing else (ADR-0002 §3) — it stays
 * platform-free, so `URLSearchParams` (a runtime global, absent from this
 * package's lib set) is deliberately NOT reached for and the grammar is spelled
 * out instead: `&` separates pairs, the FIRST `=` separates key from value, a
 * pair with no `=` has an empty value, and an empty pair is skipped rather than
 * becoming an empty key.
 */
function parseQueryStringEntries(
  query: string,
): EventListingQueryEntry[] | null {
  const entries: EventListingQueryEntry[] = [];
  for (const pair of query.split("&")) {
    if (pair.length === 0) continue;
    const equals = pair.indexOf("=");
    const key = decodeQueryComponent(
      equals === -1 ? pair : pair.slice(0, equals),
    );
    const value = decodeQueryComponent(
      equals === -1 ? "" : pair.slice(equals + 1),
    );
    if (key === null || value === null) return null;
    entries.push([key, value]);
  }
  return entries;
}

/**
 * 2. `doctor-feed` — `/events?<feed query>&resume=<slug>` (019 LD-7 / EARS-12,
 * the whitelist increment 021 LD-3 mandates).
 *
 * A guest who activates «Участвовать» on a feed card must come back to the
 * feed EXACTLY as they left it, on the chosen card — so the safe target has to
 * carry the current feed query as well as the resumed slug. Safety comes from
 * reconstruction, never from trusting the input: the path must be literally
 * `/events`, the query is re-parsed with the ONE feed codec, and the value that
 * is returned is rebuilt from what that codec understood. Anything the codec
 * does not declare is DROPPED, so `&returnTo=https://evil` cannot ride along.
 */
function parseDoctorFeedTarget(returnTo: string): RegistrationIntent | null {
  if (returnTo.length > MAX_RETURN_TARGET_LENGTH) return null;
  if (hasForbiddenTargetChar(returnTo)) return null;
  // Protocol-relative (`//evil/events?…`) and absolute (`https://evil/…`).
  if (returnTo.startsWith("//")) return null;
  if (SCHEME_PREFIX_RE.test(returnTo)) return null;

  const queryAt = returnTo.indexOf("?");
  if (queryAt === -1) return null;
  // Literal equality is the whole path guard: it rejects `/events/x`,
  // `/events%2f..`, `//evil/events` and every traversal in one comparison.
  if (returnTo.slice(0, queryAt) !== DOCTOR_EVENTS_FEED_PATH) return null;

  const entries = parseQueryStringEntries(returnTo.slice(queryAt + 1));
  // A malformed percent-escape is a reject, never a best-effort decode.
  if (entries === null) return null;

  const resumeValues = entries
    .filter(([key]) => key === DOCTOR_EVENTS_FEED_RESUME_KEY)
    .map(([, value]) => value);
  // Exactly once: a repeated `resume` is an ambiguous intent, not a valid one.
  if (resumeValues.length !== 1) return null;
  const eventSlug = resumeValues[0]!;
  if (!SLUG_RE.test(eventSlug)) return null;

  const feedQuery = rawQueryFromEntries(
    entries.filter(([key]) => key !== DOCTOR_EVENTS_FEED_RESUME_KEY),
  );
  // A malformed feed URL is not a declared shape — a `kind=garbage` that the
  // codec rejects must not be silently laundered into an empty query.
  if (!parseDoctorEventsFeedQuery(feedQuery).success) return null;

  return {
    eventSlug,
    returnTo: buildDoctorEventsFeedReturnTarget(feedQuery, eventSlug),
  };
}

/**
 * The canonical feed return target: the codec's own entries in the codec's own
 * order, with `resume` appended LAST. This one builder is used by BOTH the
 * parser (reconstruction) and {@link mintDoctorEventsFeedReturnTarget}
 * (minting), which is what makes the round-trip law hold by construction.
 */
function buildDoctorEventsFeedReturnTarget(
  feedQuery: RawQueryRecord,
  eventSlug: string,
): string {
  const entries: EventListingQueryEntry[] = [
    ...encodeDoctorEventsFeedQueryEntries(feedQuery),
    [DOCTOR_EVENTS_FEED_RESUME_KEY, eventSlug],
  ];
  return `${DOCTOR_EVENTS_FEED_PATH}?${encodeQueryString(entries)}`;
}

/**
 * The WHITELIST of return-target shapes, tried in order. A shape that is not on
 * this list is not a safe return target — which is why the list, not a regex,
 * is the guard (021 LD-3).
 *
 * Extending it is one entry: 020's doctor event page (`/events/<slug>?tab=…`)
 * is deliberately NOT here — it lands with #1768 (020 EARS-5) and adds a third
 * parser beside these two, nothing else.
 */
const RETURN_TARGET_SHAPES: readonly ReturnTargetShapeParser[] = [
  parseAcademyEventTarget,
  parseDoctorFeedTarget,
];

/**
 * Mint the feed-shaped return target for `eventSlug` against the feed query the
 * viewer is currently reading — the ONLY way a host builds this shape (019
 * EARS-12). A host never hand-assembles the string: it hands over its raw
 * query bag and gets back a value that is already canonical, or `null` when the
 * slug or the query would not round-trip (then there is simply no CTA).
 *
 * Law (pinned by the unit spec): for every accepted input,
 * `parseReturnTarget(mint(q, s))` is `{ eventSlug: s, returnTo: mint(q, s) }`.
 */
export function mintDoctorEventsFeedReturnTarget(
  rawFeedQuery: RawQueryRecord,
  eventSlug: string,
): string | null {
  if (typeof eventSlug !== "string" || !SLUG_RE.test(eventSlug)) return null;

  // `resume` is never a facet: a bag that already carries one (the viewer came
  // back to the feed on a resumed URL) must not nest a second one.
  const feedQuery: RawQueryRecord = { ...rawFeedQuery };
  delete feedQuery[DOCTOR_EVENTS_FEED_RESUME_KEY];
  if (!parseDoctorEventsFeedQuery(feedQuery).success) return null;

  const target = buildDoctorEventsFeedReturnTarget(feedQuery, eventSlug);
  // Mint only what the guard will accept back, verbatim — a value that fails
  // its own round-trip is a bug, and the caller gets `null` instead of a link.
  const parsed = parseReturnTarget(target);
  if (parsed === null) return null;
  return parsed.eventSlug === eventSlug && parsed.returnTo === target
    ? target
    : null;
}

/** `true` iff `returnTo` is a safe same-origin event return target (EARS-2). */
export function isSafeReturnTarget(returnTo: unknown): boolean {
  return parseReturnTarget(returnTo) !== null;
}
