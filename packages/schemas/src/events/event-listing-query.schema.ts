import { z } from "zod";

/**
 * 019 EARS-8 (#1523) — the PORTABLE event-listing query codec.
 *
 * 019-design §1.1 (row «Facets») names this file as the extraction target for
 * «the shared query vocabulary», and §8 step 3 scopes #1523 to «extracts/proves
 * the portable query codec … with only thin host-default adapters». §2 states
 * why it has to be ONE unit rather than a parser here and a serialiser there:
 * the screen renders as `f(URL, session)`, so decode and encode are two halves
 * of a single round-trip. A host that decodes with the shared rules but
 * re-serialises with its own is a second listing engine (EARS-15) wearing a
 * shared parser as a hat — its links silently drop state, and the drop is
 * invisible until a shared link reproduces the wrong screen.
 *
 * What is portable here, and what deliberately is NOT:
 *
 * - **Portable:** the wire grammar. How a repeatable parameter is spelled
 *   (`?format=a&format=b` AND `?format=a,b` both decode; only the repeated form
 *   is ever written back), how a boolean is spelled (`true/1`, `false/0`), that
 *   an unknown parameter is DROPPED rather than forwarded, and that the encoded
 *   key order is fixed by the field declaration so the same state always yields
 *   the same URL — a link is comparable, cacheable and diffable only if the
 *   serialisation is deterministic.
 * - **Not portable:** the vocabulary and the defaults. Which keys exist, what
 *   values they take and what a missing key means are HOST decisions, supplied
 *   as a Zod schema plus an ordered field table. Doctor's
 *   `specialty=mine-and-adjacent` default has no business in Academy's listing,
 *   and this file never learns either of them.
 *
 * The codec therefore owns no field names at all. It is the grammar; the host
 * schema is the vocabulary.
 */

/** A raw querystring value as Fastify / Next.js hand it over. */
export type RawQueryValue = string | string[] | undefined;

/** The raw querystring bag both hosts receive before any decoding. */
export type RawQueryRecord = Record<string, RawQueryValue>;

/**
 * One declared query key and how its wire form maps to its parsed form.
 *
 * `mode-or-list` is the shape a facet takes when a small closed set of MODE
 * words shares the key with an open list of ids (`specialty=all` vs
 * `specialty=cardiology&specialty=neurology`): a single value that is one of
 * `modes` collapses to that scalar, anything else stays a list.
 */
export type EventListingQueryField =
  | { readonly key: string; readonly kind: "scalar" }
  | { readonly key: string; readonly kind: "boolean" }
  | { readonly key: string; readonly kind: "list" }
  | {
      readonly key: string;
      readonly kind: "mode-or-list";
      readonly modes: readonly string[];
    };

/** The first non-empty value of a key, or `undefined` — repeats are ignored. */
export function rawQueryScalar(value: RawQueryValue): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first.length === 0 ? undefined : first;
}

/**
 * The values of a repeatable key. Both spellings decode: repeated keys
 * (`?city=a&city=b`) and the comma form (`?city=a,b`), including a mix of the
 * two. An all-blank value decodes to `undefined` rather than `[]`, so the host
 * schema's own default (which may be «unset», not «empty») decides.
 */
export function rawQueryList(value: RawQueryValue): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.length > 0 ? parts : undefined;
}

/**
 * `true`/`1` and `false`/`0`. Anything else is `undefined` — an unreadable
 * boolean is an ABSENT facet, not a `false` one: a typo in a shared link must
 * not silently narrow the feed for the reader who opened it.
 */
export function rawQueryBoolean(value: RawQueryValue): boolean | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return undefined;
  if (first === "true" || first === "1") return true;
  if (first === "false" || first === "0") return false;
  return undefined;
}

/**
 * One `key=value` pair of the encoded wire form. A repeatable key appears once
 * per value, in the order it was written.
 *
 * The encoded form is an ORDERED ENTRY LIST rather than a `URLSearchParams`
 * because this package is framework- and platform-agnostic by contract (it
 * depends on `zod` and nothing else, ADR-0002 §3): `URLSearchParams` is a
 * host global, and the codec must be readable from a Node service, a Next
 * server component and a React Native client alike. Every host builds its own
 * `new URLSearchParams(entries)` in one line — that line IS the host adapter.
 */
export type EventListingQueryEntry = [key: string, value: string];

/**
 * Entries → the raw bag the codec decodes, keeping repeats as arrays. This is
 * the seam that closes the round-trip: `parse(rawQueryFromEntries(encode(q)))`
 * is the property every host link must satisfy. It accepts anything iterable
 * over pairs, so a host may hand it a `URLSearchParams` directly.
 */
export function rawQueryFromEntries(
  entries: Iterable<readonly [string, string]>,
): RawQueryRecord {
  const raw: RawQueryRecord = {};
  for (const [key, value] of entries) {
    const current = raw[key];
    if (current === undefined) {
      raw[key] = value;
    } else if (Array.isArray(current)) {
      current.push(value);
    } else {
      raw[key] = [current, value];
    }
  }
  return raw;
}

/** Entries → a `key=value&…` query string, percent-encoded, order preserved. */
export function encodeQueryString(
  entries: readonly EventListingQueryEntry[],
): string {
  return entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

/** The decode + encode pair a host mounts over its own query schema. */
export interface EventListingQueryCodec<T> {
  /** The declared keys, in the order `encode` writes them. */
  readonly keys: readonly string[];
  /** Raw bag → the pre-validation object, unknown keys dropped. */
  decode(raw: RawQueryRecord): Record<string, unknown>;
  /** Raw bag → the validated host query. */
  parse(raw: RawQueryRecord): z.ZodSafeParseResult<T>;
  /** Validated query → its canonical, deterministically ordered wire form. */
  encode(query: T): EventListingQueryEntry[];
  /**
   * Raw bag → the wire form of exactly what the host schema UNDERSTOOD. A bag
   * that does not validate encodes to nothing rather than being forwarded
   * blindly, so a hand-edited URL cannot smuggle a parameter downstream.
   */
  reencode(raw: RawQueryRecord): EventListingQueryEntry[];
}

/**
 * Build the codec for one host listing query.
 *
 * `fields` is an ORDERED table — its order is the encoded key order, and that
 * determinism is part of the contract rather than an implementation detail.
 */
export function createEventListingQueryCodec<S extends z.ZodType>(input: {
  readonly schema: S;
  readonly fields: readonly EventListingQueryField[];
}): EventListingQueryCodec<z.infer<S>> {
  const { schema, fields } = input;
  const keys = fields.map((field) => field.key);

  const decode = (raw: RawQueryRecord): Record<string, unknown> => {
    const decoded: Record<string, unknown> = {};
    for (const field of fields) {
      const value = raw[field.key];
      switch (field.kind) {
        case "scalar":
          decoded[field.key] = rawQueryScalar(value);
          break;
        case "boolean":
          decoded[field.key] = rawQueryBoolean(value);
          break;
        case "list":
          decoded[field.key] = rawQueryList(value);
          break;
        case "mode-or-list": {
          const list = rawQueryList(value);
          decoded[field.key] =
            list !== undefined &&
            list.length === 1 &&
            field.modes.includes(list[0]!)
              ? list[0]
              : list;
          break;
        }
      }
    }
    return decoded;
  };

  const encode = (query: z.infer<S>): EventListingQueryEntry[] => {
    const entries: EventListingQueryEntry[] = [];
    const source = query as Record<string, unknown>;
    for (const field of fields) {
      const value = source[field.key];
      if (value === undefined || value === null) continue;
      switch (field.kind) {
        case "scalar":
          if (typeof value === "string" && value.length > 0) {
            entries.push([field.key, value]);
          }
          break;
        case "boolean":
          if (typeof value === "boolean") {
            entries.push([field.key, String(value)]);
          }
          break;
        case "list":
          if (Array.isArray(value)) {
            for (const entry of value) {
              entries.push([field.key, String(entry)]);
            }
          }
          break;
        case "mode-or-list":
          if (typeof value === "string") {
            entries.push([field.key, value]);
          } else if (Array.isArray(value)) {
            for (const entry of value) {
              entries.push([field.key, String(entry)]);
            }
          }
          break;
      }
    }
    return entries;
  };

  const parse = (raw: RawQueryRecord) =>
    schema.safeParse(decode(raw)) as z.ZodSafeParseResult<z.infer<S>>;

  return {
    keys,
    decode,
    parse,
    encode,
    reencode: (raw: RawQueryRecord) => {
      const parsed = parse(raw);
      return parsed.success ? encode(parsed.data) : [];
    },
  };
}
