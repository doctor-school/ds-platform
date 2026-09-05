import { describe, expect, it } from "vitest";

import {
  DOCTOR_EVENTS_FEED_RESUME_KEY,
  mintDoctorEventsFeedReturnTarget,
  parseAcademyEventReturnTarget,
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
      expect(parseReturnTarget(smuggled), `must reject: ${smuggled}`).toBeNull();
      expect(parseDoctorEventsFeedReturnTarget(smuggled)).toBeNull();
      expect(parseAcademyEventReturnTarget(smuggled)).toBeNull();
    }
  });
});
