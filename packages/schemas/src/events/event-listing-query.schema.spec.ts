import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createEventListingQueryCodec,
  encodeQueryString,
  rawQueryBoolean,
  rawQueryFromEntries,
  rawQueryList,
  rawQueryScalar,
} from "./event-listing-query.schema.js";
import {
  DOCTOR_EVENTS_FEED_QUERY_CODEC,
  type DoctorEventsFeedQuery,
  encodeDoctorEventsFeedQueryEntries,
  parseDoctorEventsFeedQuery,
} from "./doctor-events-feed.schema.js";

/**
 * 019 EARS-8 (#1523) — the URL is the whole state of the screen.
 *
 * EARS-8 says the screen «shall render as a pure function of that URL plus the
 * viewer's session … no feed state shall live only in client memory». The
 * unit-level half of that promise is the codec's ROUND-TRIP: if `encode` can
 * lose a facet that `parse` accepted, then a shared link does not reproduce the
 * screen and the missing state has, in effect, moved into whatever memory the
 * host kept it in. So the properties below are the load-bearing ones —
 * `parse(encode(q)) === q` for every field kind, and `encode` being idempotent
 * so the URL a link writes is stable rather than drifting per navigation.
 */

const KIND_A = "6f0f6a1c-0e5a-4d6a-9f2b-6a1c0e5a4d6a";
const KIND_B = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

/** Round-trip through the wire form the way a browser would: encode → URL → raw bag → parse. */
const roundTrip = (query: DoctorEventsFeedQuery) =>
  parseDoctorEventsFeedQuery(
    rawQueryFromEntries(DOCTOR_EVENTS_FEED_QUERY_CODEC.encode(query)),
  );

describe("019 EARS-8 event listing query codec", () => {
  describe("raw value grammar", () => {
    it("019 EARS-8.1: a repeatable key decodes from both the repeated and the comma spelling", () => {
      expect(rawQueryList(["a", "b"])).toEqual(["a", "b"]);
      expect(rawQueryList("a,b")).toEqual(["a", "b"]);
      expect(rawQueryList(["a, b", "c"])).toEqual(["a", "b", "c"]);
      // All-blank is ABSENT, not empty — the host schema's default decides.
      expect(rawQueryList(" , ")).toBeUndefined();
      expect(rawQueryList(undefined)).toBeUndefined();
    });

    it("019 EARS-8.2: an unreadable boolean is an absent facet, never a false one", () => {
      expect(rawQueryBoolean("true")).toBe(true);
      expect(rawQueryBoolean("1")).toBe(true);
      expect(rawQueryBoolean("false")).toBe(false);
      expect(rawQueryBoolean("0")).toBe(false);
      // A typo in a shared link must not silently narrow the feed.
      expect(rawQueryBoolean("yes")).toBeUndefined();
      expect(rawQueryBoolean(undefined)).toBeUndefined();
    });

    it("019 EARS-8.3: a scalar takes the first value and treats empty as absent", () => {
      expect(rawQueryScalar(["one", "two"])).toBe("one");
      expect(rawQueryScalar("")).toBeUndefined();
      expect(rawQueryScalar(undefined)).toBeUndefined();
    });

    it("019 EARS-8.4: wire entries round-trip into the raw bag, repeats preserved", () => {
      expect(
        rawQueryFromEntries([
          ["format", "webinar"],
          ["format", "podcast"],
          ["tense", "past"],
        ]),
      ).toEqual({ format: ["webinar", "podcast"], tense: "past" });
      expect(
        encodeQueryString([
          ["q", "сердце"],
          ["nmo", "true"],
        ]),
      ).toBe("q=%D1%81%D0%B5%D1%80%D0%B4%D1%86%D0%B5&nmo=true");
    });
  });

  describe("the doctor host mount", () => {
    it("019 EARS-8.5: every field kind survives the encode → URL → parse round-trip", () => {
      const query: DoctorEventsFeedQuery = {
        day: "2026-09-12",
        tense: "past",
        from: "2026-09-01",
        to: "2026-09-29",
        format: ["webinar", "offline-meetup"],
        kind: [KIND_A, KIND_B],
        specialty: ["cardiology", "neurology"],
        city: ["msk", "spb"],
        nmo: true,
        free: false,
        q: "сердце",
      };

      const parsed = roundTrip(query);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual(query);
    });

    it("019 EARS-8.6: a defaults-only state round-trips to the same state", () => {
      const defaults = parseDoctorEventsFeedQuery({});
      expect(defaults.success).toBe(true);
      // The defaults are the host's, not the codec's: `tense` and `specialty`
      // are materialised by the schema, the rest stay absent.
      expect(defaults.data).toEqual({
        tense: "upcoming",
        specialty: "mine-and-adjacent",
        format: [],
        kind: [],
        city: [],
      });

      const again = roundTrip(defaults.data!);
      expect(again.success).toBe(true);
      expect(again.data).toEqual(defaults.data);
    });

    it("019 EARS-8.7: the specialty key collapses to a mode word and expands back to a list", () => {
      const mode = parseDoctorEventsFeedQuery({ specialty: "all" });
      expect(mode.data?.specialty).toBe("all");
      expect(roundTrip(mode.data!).data?.specialty).toBe("all");

      // A single non-mode value stays a LIST rather than being read as a mode.
      const one = parseDoctorEventsFeedQuery({ specialty: "cardiology" });
      expect(one.data?.specialty).toEqual(["cardiology"]);
      expect(roundTrip(one.data!).data?.specialty).toEqual(["cardiology"]);
    });

    it("019 EARS-8.8: re-encoding is idempotent and deterministically ordered", () => {
      const raw = {
        q: "сердце",
        nmo: "1",
        format: ["webinar", "podcast"],
        tense: "past",
        day: "2026-09-12",
      };
      const once = encodeDoctorEventsFeedQueryEntries(raw);
      const twice = encodeDoctorEventsFeedQueryEntries(
        rawQueryFromEntries(once),
      );
      expect(twice).toEqual(once);
      // The key order is the field-table order, not the order the caller typed
      // them in — the same state always yields the same, comparable URL. The
      // host defaults (`tense`, `specialty`) are materialised into the link, so
      // the URL states the applied targeting rather than implying it.
      expect(once.map(([key]) => key)).toEqual([
        "day",
        "tense",
        "format",
        "format",
        "specialty",
        "nmo",
        "q",
      ]);
    });

    it("019 EARS-8.9: an unknown parameter is dropped rather than forwarded", () => {
      const encoded = encodeDoctorEventsFeedQueryEntries({
        tense: "upcoming",
        sort: "relevance",
        page: "3",
        utm_source: "mail",
      });
      const keys = encoded.map(([key]) => key);
      // Notably `sort`/`page`: a ranking or a paging parameter must not reach
      // the api read just because someone typed it into the address bar.
      expect(keys).not.toContain("sort");
      expect(keys).not.toContain("page");
      expect(keys).not.toContain("utm_source");
      expect(encoded).toContainEqual(["tense", "upcoming"]);
    });

    it("019 EARS-8.10: an invalid value fails the parse and encodes to nothing", () => {
      const parsed = parseDoctorEventsFeedQuery({ from: "12.09.2026" });
      expect(parsed.success).toBe(false);
      // A bag that does not validate is never re-encoded half-way: the caller
      // gets an empty query rather than a partially forwarded one.
      expect(
        encodeDoctorEventsFeedQueryEntries({
          from: "12.09.2026",
          tense: "past",
        }),
      ).toEqual([]);
      // `kind` is a uuid column downstream — a malformed value is a 400 here,
      // never a Postgres `22P02` on a public URL.
      expect(parseDoctorEventsFeedQuery({ kind: "not-a-uuid" }).success).toBe(
        false,
      );
    });

    it("019 EARS-8.11: the declared keys are exactly the 019 §7 read contract", () => {
      expect(DOCTOR_EVENTS_FEED_QUERY_CODEC.keys).toEqual([
        "day",
        "tense",
        "from",
        "to",
        "format",
        "kind",
        "specialty",
        "city",
        "nmo",
        "free",
        "q",
      ]);
      // There is no `view` parameter under F-019-2 Б, and no ranking input.
      expect(DOCTOR_EVENTS_FEED_QUERY_CODEC.keys).not.toContain("view");
      expect(DOCTOR_EVENTS_FEED_QUERY_CODEC.keys).not.toContain("sort");
    });
  });

  describe("portability", () => {
    it("019 EARS-8.12: a second host mounts the same grammar over its own vocabulary", () => {
      // The point of the extraction: another listing (Academy's, a later one)
      // reuses the wire grammar without inheriting Doctor's keys or defaults.
      const codec = createEventListingQueryCodec({
        schema: z
          .object({
            tag: z.array(z.string().min(1)).default([]),
            archived: z.boolean().optional(),
            sort: z.enum(["date", "title"]).default("date"),
          })
          .strict(),
        fields: [
          { key: "sort", kind: "scalar" },
          { key: "tag", kind: "list" },
          { key: "archived", kind: "boolean" },
        ],
      });

      const parsed = codec.parse({ tag: "a,b", archived: "0", sort: "title" });
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({
        tag: ["a", "b"],
        archived: false,
        sort: "title",
      });
      expect(encodeQueryString(codec.encode(parsed.data!))).toBe(
        "sort=title&tag=a&tag=b&archived=false",
      );
      // Doctor's vocabulary is not smuggled in with the grammar.
      expect(
        codec.reencode({ specialty: "all", tag: "a" }).map(([key]) => key),
      ).not.toContain("specialty");
    });
  });
});
