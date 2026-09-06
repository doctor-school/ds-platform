import { describe, expect, it } from "vitest";

import {
  DOCTOR_EVENTS_FEED_RESUME_KEY,
  mintDoctorEventsFeedReturnTarget,
  parseAcademyEventReturnTarget,
  parseDoctorEventReturnTarget,
  parseDoctorEventsFeedReturnTarget,
  parseReturnTarget,
  RegistrationIntentSchema,
} from "./registration-intent.js";
import type { RawQueryRecord } from "./event-listing-query.schema.js";

/**
 * 019 EARS-12 — the feed-shaped half of the return-target whitelist (021 LD-3).
 *
 * The open-redirect rejection table lives with the api guard spec
 * (`apps/api/src/registration/return-target.guard.spec.ts`, where 005 pinned
 * it). What this file pins is the package-level LAW the host relies on: a
 * minted target always parses back to itself, and the strict intent DTO accepts
 * both declared shapes and nothing else.
 */

const FEED_QUERY: RawQueryRecord = {
  tense: "upcoming",
  day: "2026-09-10",
  format: ["webinar", "podcast"],
};

describe("019 EARS-12 — the doctor-feed registration return target", () => {
  it("019 EARS-12.1: minting a feed return target round-trips through the guard", () => {
    const target = mintDoctorEventsFeedReturnTarget(FEED_QUERY, "kardio-forum");
    expect(target).not.toBeNull();
    expect(parseReturnTarget(target)).toEqual({
      eventSlug: "kardio-forum",
      returnTo: target,
    });
  });

  it("019 EARS-12.2: the minted target is the codec's own key order with resume LAST", () => {
    expect(mintDoctorEventsFeedReturnTarget(FEED_QUERY, "kardio-forum")).toBe(
      "/events?day=2026-09-10&tense=upcoming&format=webinar&format=podcast" +
        "&specialty=mine-and-adjacent&resume=kardio-forum",
    );
  });

  it("019 EARS-12.3: an empty feed query mints the codec's defaults, not an empty query", () => {
    expect(mintDoctorEventsFeedReturnTarget({}, "kardio-forum")).toBe(
      "/events?tense=upcoming&specialty=mine-and-adjacent&resume=kardio-forum",
    );
  });

  it("019 EARS-12.4: minting refuses a slug the guard would not accept", () => {
    for (const slug of ["", "../account", "a/b", "a b", "a.b", "%2e%2e"]) {
      expect(mintDoctorEventsFeedReturnTarget(FEED_QUERY, slug)).toBeNull();
    }
  });

  it("019 EARS-12.5: minting refuses a feed query the ONE codec rejects", () => {
    expect(
      mintDoctorEventsFeedReturnTarget({ kind: "not-a-uuid" }, "kardio-forum"),
    ).toBeNull();
  });

  it("019 EARS-12.6: a resume already in the bag is never nested a second time", () => {
    const target = mintDoctorEventsFeedReturnTarget(
      { ...FEED_QUERY, [DOCTOR_EVENTS_FEED_RESUME_KEY]: "older-event" },
      "kardio-forum",
    );
    expect(target).toBe(
      mintDoctorEventsFeedReturnTarget(FEED_QUERY, "kardio-forum"),
    );
    expect(target?.match(/resume=/g)).toHaveLength(1);
  });

  it("019 EARS-12.7: the strict intent DTO accepts a feed-shaped intent and still refuses extras", () => {
    const returnTo = mintDoctorEventsFeedReturnTarget(
      FEED_QUERY,
      "kardio-forum",
    )!;
    expect(
      RegistrationIntentSchema.parse({ eventSlug: "kardio-forum", returnTo }),
    ).toEqual({ eventSlug: "kardio-forum", returnTo });
    expect(
      RegistrationIntentSchema.safeParse({
        eventSlug: "kardio-forum",
        returnTo,
        email: "doctor@example.test",
      }).success,
    ).toBe(false);
  });

  it("019 EARS-12.8: the DTO refuses a non-canonical returnTo of a declared shape", () => {
    expect(
      RegistrationIntentSchema.safeParse({
        eventSlug: "kardio-forum",
        // Same shape, but NOT the reconstruction: `resume` is not last and the
        // codec defaults are missing, so it is not what the guard emits.
        returnTo: "/events?resume=kardio-forum&tense=upcoming",
      }).success,
    ).toBe(false);
  });

  it("019 EARS-12.9: the 005 academy shape is unchanged by the whitelist", () => {
    expect(parseReturnTarget("/webinars/ahilles-042")).toEqual({
      eventSlug: "ahilles-042",
      returnTo: "/webinars/ahilles-042",
    });
    expect(
      RegistrationIntentSchema.parse({
        eventSlug: "ahilles-042",
        returnTo: "/webinars/ahilles-042",
      }).returnTo,
    ).toBe("/webinars/ahilles-042");
    for (const hostile of [
      "https://evil/webinars/x",
      "//evil",
      "/webinars/a/b",
      "/webinars/../account",
      "/account",
    ]) {
      expect(parseReturnTarget(hostile)).toBeNull();
    }
  });
  it("019 EARS-12.10: each host-scoped parser admits ONLY its own shape, while the union admits both", () => {
    // A host completes only the intents its own surfaces can serve: the academy
    // portal parses `/webinars/<slug>`, the doctor host parses the feed shape, and
    // the UNION is what the api guard and the strict DTO use. Without the split, a
    // feed-shaped target reaching the academy host would fire a registration and
    // navigate to a path that does not exist there.
    const academy = "/webinars/ahilles-042";
    const feed = mintDoctorEventsFeedReturnTarget(FEED_QUERY, "kardio-forum")!;

    expect(parseAcademyEventReturnTarget(academy)?.returnTo).toBe(academy);
    expect(parseAcademyEventReturnTarget(feed)).toBeNull();

    expect(parseDoctorEventsFeedReturnTarget(feed)?.returnTo).toBe(feed);
    expect(parseDoctorEventsFeedReturnTarget(academy)).toBeNull();

    expect(parseReturnTarget(academy)?.returnTo).toBe(academy);
    expect(parseReturnTarget(feed)?.returnTo).toBe(feed);

    // The per-shape parsers keep the union's value-level rejections — they narrow
    // WHICH shapes are admitted, never how hard the value is validated.
    for (const hostile of [
      null,
      undefined,
      42,
      "/webinars/\\evil",
      "/events?tense=upcoming&resume=abc\\evil",
    ]) {
      expect(parseAcademyEventReturnTarget(hostile)).toBeNull();
      expect(parseDoctorEventsFeedReturnTarget(hostile)).toBeNull();
    }
  });

  it("019 EARS-12.11: a `resume` slug carrying a path separator is rejected by every parser — a slug is validated BEFORE any reconstruction", () => {
    // The room guard strips a trailing `/room` before validating, so a
    // `resume=<slug>/room` value must never survive as a feed target: `SLUG_RE`
    // admits no `/`, and the value is rejected rather than reconstructed.
    for (const smuggled of [
      "/events?tense=upcoming&resume=abc/room",
      "/events?resume=a/b",
      "/events?resume=abc%2Froom",
    ]) {
      expect(
        parseReturnTarget(smuggled),
        `must reject: ${smuggled}`,
      ).toBeNull();
      expect(parseDoctorEventsFeedReturnTarget(smuggled)).toBeNull();
      expect(parseAcademyEventReturnTarget(smuggled)).toBeNull();
    }
  });
});

/**
 * 021 EARS-10 / LD-3 (#1546) — the third declared shape: the doctor
 * storefront's own event page, `/events/<slug>`.
 *
 * The whitelist is the guard, so a NEW shape earns its own rejection table
 * rather than inheriting the confidence of the two already on the list. Every
 * case below is stated against the union `parseReturnTarget` (what the 021
 * confirmation handler actually calls) AND the host-scoped
 * `parseDoctorEventReturnTarget`, because a per-shape parser that is laxer than
 * the union would be an open redirect with a narrower blast radius, not a
 * safer one.
 */
describe("021 EARS-10 — the doctor-storefront event-page return target", () => {
  // A literal backslash, spelled by code point: the guard rejects the character
  // before any shape sees it, and writing it as an escape in a source literal is
  // exactly where a hostile-input table quietly stops testing what it names.
  const BACKSLASH = String.fromCharCode(0x5c);

  it("021 EARS-10.1: a `/events/<slug>` target parses to the event slug and the guard's own reconstruction", () => {
    for (const slug of ["ahilles-042", "kardio_2026", "abc"]) {
      const target = `/events/${slug}`;
      expect(parseReturnTarget(target)).toEqual({
        eventSlug: slug,
        returnTo: target,
      });
      expect(parseDoctorEventReturnTarget(target)).toEqual({
        eventSlug: slug,
        returnTo: target,
      });
    }
  });

  it("021 EARS-10.2: the accepted value is the RECONSTRUCTION, never the raw input", () => {
    // A percent-encoded but slug-safe input is admitted on its decoded slug and
    // handed back in canonical form — the caller navigates to a value the guard
    // built, so a client can never smuggle its own encoding past the parse.
    const parsed = parseReturnTarget("/events/ahilles%2D042");
    expect(parsed).toEqual({
      eventSlug: "ahilles-042",
      returnTo: "/events/ahilles-042",
    });
    expect(parsed?.returnTo).not.toBe("/events/ahilles%2D042");
  });

  it("021 EARS-10.3: cross-origin, protocol-relative and backslash forms are rejected", () => {
    for (const hostile of [
      "https://evil/events/abc",
      "http://evil/events/abc",
      "//evil/events/abc",
      "//evil",
      "javascript:/events/abc",
      `/${BACKSLASH}evil/events/abc`,
      `/events/${BACKSLASH}evil`,
      `/events/abc${BACKSLASH}`,
    ]) {
      expect(parseReturnTarget(hostile), `must reject: ${hostile}`).toBeNull();
      expect(parseDoctorEventReturnTarget(hostile)).toBeNull();
    }
  });

  it("021 EARS-10.4: traversal, encoded separators and multi-segment paths are rejected", () => {
    for (const hostile of [
      "/events/../account",
      "/events/..",
      "/events/.",
      "/events/a/b",
      "/events//abc",
      "/events/a%2Fb",
      "/events/a%2fb",
      "/events/%2e%2e",
      "/events/%2e%2e%2faccount",
      "/events/%zz",
    ]) {
      expect(parseReturnTarget(hostile), `must reject: ${hostile}`).toBeNull();
      expect(parseDoctorEventReturnTarget(hostile)).toBeNull();
    }
  });

  it("021 EARS-10.5: an empty slug is not a target — `/events/` is the feed's prefix, not an event", () => {
    for (const empty of ["/events/", "/events", "/events/ "]) {
      expect(parseReturnTarget(empty), `must reject: ${empty}`).toBeNull();
      expect(parseDoctorEventReturnTarget(empty)).toBeNull();
    }
  });

  it("021 EARS-10.6: the event shape carries NO query and NO hash — a tab or a smuggled parameter is not of this shape", () => {
    for (const decorated of [
      "/events/abc?tab=program",
      "/events/abc#speakers",
      "/events/abc?returnTo=https://evil",
      "/events/abc%3Ftab=program",
      "/events/abc%23speakers",
    ]) {
      expect(
        parseReturnTarget(decorated),
        `must reject: ${decorated}`,
      ).toBeNull();
      expect(parseDoctorEventReturnTarget(decorated)).toBeNull();
    }
  });

  it("021 EARS-10.7: the three shapes stay mutually exclusive — each host-scoped parser admits only its own", () => {
    const academy = "/webinars/abc";
    const doctorEvent = "/events/abc";
    const doctorFeed = "/events?tense=upcoming&resume=abc";

    expect(parseDoctorEventReturnTarget(academy)).toBeNull();
    expect(parseDoctorEventReturnTarget(doctorFeed)).toBeNull();
    expect(parseAcademyEventReturnTarget(doctorEvent)).toBeNull();
    expect(parseDoctorEventsFeedReturnTarget(doctorEvent)).toBeNull();

    // The union admits all three. The two slug shapes reconstruct to exactly
    // what was offered; the feed shape reconstructs through the feed codec, so
    // its canonical form carries the codec's defaults — which is the point of
    // reconstruction, not a deviation from it.
    expect(parseReturnTarget(academy)?.returnTo).toBe(academy);
    expect(parseReturnTarget(doctorEvent)?.returnTo).toBe(doctorEvent);
    expect(parseReturnTarget(doctorFeed)?.eventSlug).toBe("abc");
    expect(parseReturnTarget(doctorFeed)?.returnTo).toMatch(
      /^\/events\?[^/]*&resume=abc$/,
    );
  });

  it("021 EARS-10.8: the strict intent DTO accepts the new shape in canonical form and nothing else", () => {
    expect(
      RegistrationIntentSchema.safeParse({
        eventSlug: "abc",
        returnTo: "/events/abc",
      }).success,
    ).toBe(true);
    // A non-canonical (but individually acceptable) value is refused by the DTO
    // — it validates the CANONICAL form, so a caller cannot store a value the
    // guard would have rewritten.
    expect(
      RegistrationIntentSchema.safeParse({
        eventSlug: "abc",
        returnTo: "/events/abc?tab=program",
      }).success,
    ).toBe(false);
  });

  it("021 EARS-10.9: an over-long value is rejected by every entry point, so no unbounded string is ever parsed or echoed back", () => {
    const longSlug = "a".repeat(600);

    expect(parseReturnTarget(`/events/${longSlug}`)).toBeNull();
    expect(parseDoctorEventReturnTarget(`/events/${longSlug}`)).toBeNull();
    expect(parseAcademyEventReturnTarget(`/webinars/${longSlug}`)).toBeNull();
  });
});
