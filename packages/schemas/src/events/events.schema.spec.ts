import { describe, expect, it } from "vitest";
import {
  canTransition,
  ConfigureStreamRequestSchema,
  CreateEventRequestSchema,
  EVENT_LIFECYCLE_STATES,
  isPubliclyReachable,
  LIFECYCLE_TRANSITIONS,
  MONTH_BROADCAST_STATES,
  MONTH_PARAM,
  MonthBroadcastEntrySchema,
  MonthlyEventCountsSchema,
  mskLocalToInstant,
  mskMonthRange,
  mskYearRange,
  PUBLIC_EVENT_STATES,
  STREAM_PROVIDERS,
  TransitionEventRequestSchema,
  UpdateEventRequestSchema,
  validTransitions,
  YEAR_PARAM,
} from "./events.schema.js";

// 007 EARS-1 pure contract logic — the МСК→instant fold, the closed transition
// map, and the create-request validation. Framework-free unit coverage that
// runs in the shared CI unit job (no infra), complementing the API e2e.

/**
 * Realistic provider-scoped embed refs (EARS-3, #665, #1134): YouTube = the
 * 11-char video id (`youtu.be/<id>`); Rutube = the 32-char lowercase-hex video id
 * (`rutube.ru/video/<id>/`); VK = the `oid_id_hash` triple (oid may be negative
 * for a community, hash = mandatory non-derivable access hash, from VK's export
 * dialog); CDNVideo = the FULL provisioned Aloha-player URL (host-allowlisted to
 * `playercdn.cdnvideo.ru/aloha/players/`, no bare stream id exists — §1134).
 */
const VALID_EMBED_REFS: Record<(typeof STREAM_PROVIDERS)[number], string> = {
  rutube: "caafe83ff1c6ed38d394635b83ece578",
  youtube: "dQw4w9WgXcQ",
  vk: "-9944999_456239622_5ee41bc00ebc765a",
  cdnvideo:
    "https://playercdn.cdnvideo.ru/aloha/players/auto_player1.html?clid=kcta544ubo&plid=c263cdf6-253e-400b-a008-d1775d3ee190",
};
describe("007 events schema", () => {
  describe("mskLocalToInstant (EARS-1/EARS-10 — one canonical instant)", () => {
    it("folds a МСК wall-clock into the UTC instant (UTC+3, no DST)", () => {
      expect(mskLocalToInstant("2026-07-17T19:00").toISOString()).toBe(
        "2026-07-17T16:00:00.000Z",
      );
    });

    it("folds a midnight-crossing МСК time back a day in UTC", () => {
      expect(mskLocalToInstant("2026-01-01T01:30").toISOString()).toBe(
        "2025-12-31T22:30:00.000Z",
      );
    });

    it("rejects a non-МСК-wall-clock string", () => {
      expect(() => mskLocalToInstant("17.07.2026 19:00")).toThrow();
    });
  });

  describe("lifecycle transitions (EARS-7 — the closed forward set)", () => {
    it("offers only the single forward move from each state", () => {
      expect(validTransitions("draft")).toEqual(["published"]);
      expect(validTransitions("published")).toEqual(["live"]);
      expect(validTransitions("live")).toEqual(["ended"]);
      expect(validTransitions("ended")).toEqual(["archived"]);
      expect(validTransitions("archived")).toEqual([]);
    });

    it("never offers a backward move or an unpublish", () => {
      const all = Object.values(LIFECYCLE_TRANSITIONS).flat();
      expect(all).not.toContain("draft"); // nothing transitions back to draft
    });
  });

  describe("canTransition (EARS-7 — the closed-set guard predicate)", () => {
    it("EARS-7.1: permits exactly the four legal forward moves", () => {
      expect(canTransition("draft", "published")).toBe(true);
      expect(canTransition("published", "live")).toBe(true);
      expect(canTransition("live", "ended")).toBe(true);
      expect(canTransition("ended", "archived")).toBe(true);
    });

    it("EARS-7.2: refuses every skip-forward move", () => {
      expect(canTransition("draft", "live")).toBe(false);
      expect(canTransition("draft", "ended")).toBe(false);
      expect(canTransition("draft", "archived")).toBe(false);
      expect(canTransition("published", "ended")).toBe(false);
      expect(canTransition("published", "archived")).toBe(false);
      expect(canTransition("live", "archived")).toBe(false);
    });

    it("EARS-7.3: refuses every backward move (no unpublish, no reopen)", () => {
      expect(canTransition("published", "draft")).toBe(false); // no unpublish
      expect(canTransition("live", "published")).toBe(false);
      expect(canTransition("ended", "live")).toBe(false);
      expect(canTransition("archived", "ended")).toBe(false);
      expect(canTransition("archived", "published")).toBe(false); // no reopen
      expect(canTransition("archived", "draft")).toBe(false);
    });

    it("EARS-7.4: refuses a self-transition from every state", () => {
      for (const s of EVENT_LIFECYCLE_STATES) {
        expect(canTransition(s, s)).toBe(false);
      }
    });

    it("EARS-7.5: agrees with validTransitions across the whole matrix", () => {
      for (const from of EVENT_LIFECYCLE_STATES) {
        for (const to of EVENT_LIFECYCLE_STATES) {
          expect(canTransition(from, to)).toBe(
            validTransitions(from).includes(to),
          );
        }
      }
    });
  });

  describe("isPubliclyReachable (004 EARS-6 — the non-public visibility policy)", () => {
    it("EARS-6: a draft is the sole non-publicly-reachable state (page → not-found)", () => {
      expect(isPubliclyReachable("draft")).toBe(false);
    });

    it("EARS-6: published / live / ended / archived are all publicly reachable", () => {
      expect(isPubliclyReachable("published")).toBe(true);
      expect(isPubliclyReachable("live")).toBe(true);
      expect(isPubliclyReachable("ended")).toBe(true);
      // An archived direct link resolves to the EARS-5 notice body, never a 404 —
      // so it is reachable (the render differs, the reachability does not).
      expect(isPubliclyReachable("archived")).toBe(true);
    });

    it("EARS-6: the predicate is derived from the PUBLIC_EVENT_STATES allow-list (not a draft denylist)", () => {
      // Any state added to the machine is not-found BY DEFAULT until it is added
      // to the public allow-list — the structural guard the denylist form lacked.
      for (const s of EVENT_LIFECYCLE_STATES) {
        expect(isPubliclyReachable(s)).toBe(
          (PUBLIC_EVENT_STATES as readonly string[]).includes(s),
        );
      }
    });
  });

  describe("TransitionEventRequestSchema (EARS-7 — the transition command body)", () => {
    it("accepts a target from the closed state enum", () => {
      expect(TransitionEventRequestSchema.parse({ to: "published" }).to).toBe(
        "published",
      );
    });

    it("rejects a target outside the closed enum", () => {
      expect(
        TransitionEventRequestSchema.safeParse({ to: "cancelled" }).success,
      ).toBe(false);
      expect(TransitionEventRequestSchema.safeParse({}).success).toBe(false);
    });
  });

  describe("CreateEventRequestSchema (EARS-1 — full field set + LD-1 speakers)", () => {
    const base = {
      title: "Актуальная терапия",
      school: "Кардиология",
      startsAtMsk: "2026-07-17T19:00",
      durationMin: 90,
      speakers: [{ name: "Иванов И.И.", regalia: "д.м.н." }],
      specialties: ["cardiology"],
    };

    it("accepts a valid full-field payload and defaults optionals", () => {
      const parsed = CreateEventRequestSchema.parse(base);
      expect(parsed.description).toBe("");
      expect(parsed.speakers[0]?.name).toBe("Иванов И.И.");
    });

    it("rejects a malformed МСК datetime", () => {
      expect(
        CreateEventRequestSchema.safeParse({
          ...base,
          startsAtMsk: "2026-07-17 19:00",
        }).success,
      ).toBe(false);
    });

    it("rejects a non-positive duration", () => {
      expect(
        CreateEventRequestSchema.safeParse({ ...base, durationMin: 0 }).success,
      ).toBe(false);
    });

    it("rejects a speaker with an empty name (text-only, LD-1)", () => {
      expect(
        CreateEventRequestSchema.safeParse({
          ...base,
          speakers: [{ name: "", regalia: "x" }],
        }).success,
      ).toBe(false);
    });
  });

  describe("ConfigureStreamRequestSchema (EARS-3 — explicit closed provider enum)", () => {
    it("EARS-3: the closed provider set is exactly rutube | youtube | vk | cdnvideo (no additive drift)", () => {
      // Locks the enum — extending it is a deliberate additive migration
      // (rutube/youtube wave 1, owner decision 2026-07-06; vk/cdnvideo #1134),
      // never a silent widening. The DB `stream_provider` enum + the admin
      // `providers.*` catalog mirror this exact set.
      expect([...STREAM_PROVIDERS]).toEqual([
        "rutube",
        "youtube",
        "vk",
        "cdnvideo",
      ]);
    });

    it("EARS-3: accepts each provider from the closed enum + a realistic provider-scoped id", () => {
      for (const provider of STREAM_PROVIDERS) {
        const embedRef = VALID_EMBED_REFS[provider];
        const parsed = ConfigureStreamRequestSchema.parse({
          provider,
          embedRef,
        });
        expect(parsed.provider).toBe(provider);
        expect(parsed.embedRef).toBe(embedRef);
      }
    });

    it("EARS-3: rejects a provider outside the closed enum (unknown provider)", () => {
      expect(
        ConfigureStreamRequestSchema.safeParse({
          provider: "vimeo",
          embedRef: "abc123",
        }).success,
      ).toBe(false);
      // The provider is explicit — a missing provider is never inferred.
      expect(
        ConfigureStreamRequestSchema.safeParse({ embedRef: "abc123" }).success,
      ).toBe(false);
    });

    it("EARS-3: rejects an empty embed reference and trims surrounding space", () => {
      expect(
        ConfigureStreamRequestSchema.safeParse({
          provider: "rutube",
          embedRef: "   ",
        }).success,
      ).toBe(false);
      expect(
        ConfigureStreamRequestSchema.parse({
          provider: "youtube",
          embedRef: "  dQw4w9WgXcQ  ",
        }).embedRef,
      ).toBe("dQw4w9WgXcQ");
    });

    it("EARS-3: rejects a garbage embed reference matching no provider id shape (Stage-B «ччсапп», #665)", () => {
      // The owner's Stage-B repro: a keyboard-mash Cyrillic token sailed through
      // the loose bounded-string rule and was persisted with a success banner.
      // The per-provider shape refuses it with a structured `custom` issue on the
      // `embedRef` path carrying `params.shape = <provider>`, which the admin
      // resolver renders as the provider-specific RU message.
      for (const provider of STREAM_PROVIDERS) {
        const result = ConfigureStreamRequestSchema.safeParse({
          provider,
          embedRef: "ччсапп",
        });
        expect(
          result.success,
          `garbage id must be refused for ${provider}`,
        ).toBe(false);
        const issue = result.success ? undefined : result.error.issues[0];
        expect(issue?.code).toBe("custom");
        expect(issue?.path).toEqual(["embedRef"]);
        expect((issue as { params?: { shape?: string } })?.params).toEqual({
          shape: provider,
        });
      }
    });

    it("EARS-3: rejects a cross-provider id (a YouTube id is not a Rutube id and vice versa)", () => {
      expect(
        ConfigureStreamRequestSchema.safeParse({
          provider: "rutube",
          embedRef: VALID_EMBED_REFS.youtube,
        }).success,
      ).toBe(false);
      expect(
        ConfigureStreamRequestSchema.safeParse({
          provider: "youtube",
          embedRef: VALID_EMBED_REFS.rutube,
        }).success,
      ).toBe(false);
    });

    it("EARS-3: the shape check reports ONE issue per problem — a base violation (empty/URL) is not doubled", () => {
      // An empty or URL-shaped value already fails the base EmbedRefSchema; the
      // per-provider shape refinement stays silent then, so each problem renders
      // exactly one message on the form.
      for (const embedRef of ["   ", "https://rutube.ru/video/abc123/"]) {
        const result = ConfigureStreamRequestSchema.safeParse({
          provider: "rutube",
          embedRef,
        });
        expect(result.success).toBe(false);
        const issues = result.success ? [] : result.error.issues;
        expect(issues).toHaveLength(1);
      }
    });

    it("EARS-3: rejects a URL-shaped embed reference (a provider-scoped id is never a URL)", () => {
      // The embed reference is a provider-scoped stream id — pasting the whole
      // share link is the legacy mistake (recon §5), refused at the boundary.
      for (const url of [
        "https://rutube.ru/video/abc123/",
        "http://youtu.be/dQw4w9WgXcQ",
        "www.youtube.com/watch?v=abc",
        "rutube://embed/xyz",
      ]) {
        expect(
          ConfigureStreamRequestSchema.safeParse({
            provider: "rutube",
            embedRef: url,
          }).success,
          `URL-shaped embedRef must be rejected: ${url}`,
        ).toBe(false);
      }
      // A bare provider-scoped id is still accepted.
      expect(
        ConfigureStreamRequestSchema.safeParse({
          provider: "youtube",
          embedRef: "dQw4w9WgXcQ",
        }).success,
      ).toBe(true);
    });

    it("EARS-3: vk accepts the oid_id_hash triple (community oid negative), rejects a missing/short hash", () => {
      // VK's embed identity is the irreducible `(oid, id, hash)` triple — the hash
      // is a mandatory, server-minted, non-derivable access token (#1134). A bare
      // oid_id without a hash cannot embed, so it is refused at the SSOT boundary.
      for (const ref of [
        "-9944999_456239622_5ee41bc00ebc765a", // community (negative oid)
        "550870741_456239017_94c2c100ea1976f9", // user profile (positive oid)
      ]) {
        expect(
          ConfigureStreamRequestSchema.safeParse({ provider: "vk", embedRef: ref })
            .success,
          `valid vk triple must be accepted: ${ref}`,
        ).toBe(true);
      }
      for (const ref of [
        "-9944999_456239622", // no hash
        "-9944999_456239622_deadbeef", // hash too short (< 16 hex)
        "abc_def_5ee41bc00ebc765a", // non-numeric oid/id
      ]) {
        expect(
          ConfigureStreamRequestSchema.safeParse({ provider: "vk", embedRef: ref })
            .success,
          `malformed vk triple must be rejected: ${ref}`,
        ).toBe(false);
      }
    });

    it("EARS-3: cdnvideo accepts the allowlisted Aloha-player URL verbatim (both provisioned forms)", () => {
      // CDNVideo hands the customer a whole provisioned player URL — there is no
      // bare stream id (#1134). embedRef IS that URL, host-pinned to
      // `playercdn.cdnvideo.ru/aloha/players/`; the base URL-guard is waived for
      // this one provider (the recorded stored-URL exception, 006-design §3).
      for (const url of [
        "https://playercdn.cdnvideo.ru/aloha/players/iframe_moygorod_potok2_player.html",
        "https://playercdn.cdnvideo.ru/aloha/players/auto_player1.html?clid=kcta544ubo&plid=c263cdf6-253e-400b-a008-d1775d3ee190",
      ]) {
        expect(
          ConfigureStreamRequestSchema.safeParse({
            provider: "cdnvideo",
            embedRef: url,
          }).success,
          `allowlisted cdnvideo URL must be accepted: ${url}`,
        ).toBe(true);
      }
    });

    it("EARS-3: cdnvideo rejects a non-allowlisted host / http / off-path URL (SSRF-safety) with the shape issue", () => {
      // The allowlist is the SSRF guard: a mis-authored config can never point the
      // 006 room's iframe at an arbitrary origin. Each rejection carries the
      // structured `custom` + `params.shape = cdnvideo` the admin resolver renders.
      for (const url of [
        "https://evil.example.com/aloha/players/auto_player1.html", // wrong host
        "http://playercdn.cdnvideo.ru/aloha/players/auto_player1.html", // not https
        "https://playercdn.cdnvideo.ru/other/path.html", // off the /aloha/players/ prefix
        "https://player.cdnvideo.ru.evil.com/aloha/players/x.html", // host-suffix spoof
      ]) {
        const result = ConfigureStreamRequestSchema.safeParse({
          provider: "cdnvideo",
          embedRef: url,
        });
        expect(result.success, `non-allowlisted URL must be rejected: ${url}`).toBe(
          false,
        );
        const issue = result.success ? undefined : result.error.issues[0];
        expect(issue?.code).toBe("custom");
        expect(issue?.path).toEqual(["embedRef"]);
        expect((issue as { params?: { shape?: string } })?.params).toEqual({
          shape: "cdnvideo",
        });
      }
    });
  });

  describe("UpdateEventRequestSchema (EARS-2 — partial edit, no defaults)", () => {
    it("EARS-2: an omitted field stays undefined (leaves the stored value) — no create defaults are applied", () => {
      const parsed = UpdateEventRequestSchema.parse({
        title: "Новое название",
      });
      expect(parsed.title).toBe("Новое название");
      // Unlike the create schema, omitted fields do NOT acquire ""/[] defaults —
      // an omitted key must leave the stored field untouched, not blank it.
      expect(parsed.description).toBeUndefined();
      expect(parsed.speakers).toBeUndefined();
      expect(parsed.specialties).toBeUndefined();
      expect("partnerRef" in parsed).toBe(false);
    });

    it("EARS-2: an empty payload is a valid no-op patch", () => {
      expect(UpdateEventRequestSchema.parse({})).toEqual({});
    });

    it("EARS-2: partnerRef: null explicitly clears the reference; a string sets it", () => {
      expect(
        UpdateEventRequestSchema.parse({ partnerRef: null }).partnerRef,
      ).toBe(null);
      expect(
        UpdateEventRequestSchema.parse({ partnerRef: "sponsor:x" }).partnerRef,
      ).toBe("sponsor:x");
    });

    it("EARS-2: a present field is validated (a non-МСК datetime / blank title is rejected)", () => {
      expect(
        UpdateEventRequestSchema.safeParse({ startsAtMsk: "17.07.2026 20:00" })
          .success,
      ).toBe(false);
      expect(UpdateEventRequestSchema.safeParse({ title: "" }).success).toBe(
        false,
      );
    });

    it("EARS-2: the lifecycle state is not an editable field (an edit is never a state reversal)", () => {
      // `state` is server-owned — it is not in the edit contract, so a client
      // cannot smuggle a state change (e.g. an unpublish) through UpdateEvent.
      expect(
        "state" in UpdateEventRequestSchema.parse({ state: "draft" }),
      ).toBe(false);
    });
  });
});

// 004 wave-2 month-calendar contract logic — the МСК month/year instant ranges,
// the query-param shapes, and the publish-safe month projections (requirements
// EARS-15/EARS-16, design §3/§4). Framework-free unit coverage complementing the
// month API e2e.
describe("004 month-calendar schema (EARS-15/EARS-16)", () => {
  describe("MONTH_BROADCAST_STATES (EARS-15 — publish-visible incl. past ended)", () => {
    it("is exactly published/live/ended — draft and archived have no month projection", () => {
      expect([...MONTH_BROADCAST_STATES]).toEqual([
        "published",
        "live",
        "ended",
      ]);
      expect(MONTH_BROADCAST_STATES).not.toContain("draft");
      expect(MONTH_BROADCAST_STATES).not.toContain("archived");
    });
  });

  describe("MONTH_PARAM / YEAR_PARAM (EARS-15/16 — boundary shapes, no baked message)", () => {
    it("accepts YYYY-MM with months 01..12 and rejects malformed / out-of-range", () => {
      for (const ok of ["2031-01", "2031-07", "2031-12"]) {
        expect(MONTH_PARAM.test(ok)).toBe(true);
      }
      for (const bad of [
        "2031-00",
        "2031-13",
        "2031-7",
        "31-07",
        "2031/07",
        "",
      ]) {
        expect(MONTH_PARAM.test(bad)).toBe(false);
      }
    });

    it("accepts a 4-digit year and rejects anything else", () => {
      expect(YEAR_PARAM.test("2031")).toBe(true);
      for (const bad of ["31", "20311", "2031-01", "abcd", ""]) {
        expect(YEAR_PARAM.test(bad)).toBe(false);
      }
    });
  });

  describe("mskMonthRange (EARS-15 — half-open МСК month range)", () => {
    it("folds YYYY-MM into МСК-midnight [start, next-month-start)", () => {
      const { start, end } = mskMonthRange("2031-07");
      // 2031-07-01T00:00:00+03:00 = 2031-06-30T21:00Z
      expect(start.toISOString()).toBe("2031-06-30T21:00:00.000Z");
      expect(end.toISOString()).toBe("2031-07-31T21:00:00.000Z");
    });

    it("rolls December to the next calendar year", () => {
      const { start, end } = mskMonthRange("2031-12");
      expect(start.toISOString()).toBe("2031-11-30T21:00:00.000Z");
      expect(end.toISOString()).toBe("2031-12-31T21:00:00.000Z");
    });

    it("classifies a UTC instant near the МСК boundary into the right month", () => {
      // 2031-07-31T21:30:00Z = 2031-08-01T00:30 МСК → belongs to AUGUST, not July.
      const boundary = new Date("2031-07-31T21:30:00.000Z");
      const july = mskMonthRange("2031-07");
      const august = mskMonthRange("2031-08");
      const inRange = (r: { start: Date; end: Date }) =>
        boundary >= r.start && boundary < r.end;
      expect(inRange(july)).toBe(false);
      expect(inRange(august)).toBe(true);
    });

    it("throws RangeError on a malformed month", () => {
      expect(() => mskMonthRange("2031-13")).toThrow(RangeError);
      expect(() => mskMonthRange("nope")).toThrow(RangeError);
    });
  });

  describe("mskYearRange (EARS-16 — half-open МСК year range)", () => {
    it("folds YYYY into МСК-midnight [Jan-1, next-Jan-1)", () => {
      const { start, end } = mskYearRange("2031");
      expect(start.toISOString()).toBe("2030-12-31T21:00:00.000Z");
      expect(end.toISOString()).toBe("2031-12-31T21:00:00.000Z");
    });

    it("throws RangeError on a malformed year", () => {
      expect(() => mskYearRange("31")).toThrow(RangeError);
    });
  });

  describe("MonthBroadcastEntrySchema (EARS-15 — thin publish-safe allow-list)", () => {
    const valid = {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "achilles-2031-07",
      title: "Пластика ахиллова сухожилия",
      school: "Школа травматологии",
      startsAt: "2031-07-10T09:00:00.000Z",
      state: "ended" as const,
    };

    it("accepts a well-formed entry with a publish-visible state", () => {
      expect(MonthBroadcastEntrySchema.parse(valid)).toEqual(valid);
    });

    it("rejects draft/archived — they have no month projection", () => {
      expect(
        MonthBroadcastEntrySchema.safeParse({ ...valid, state: "draft" })
          .success,
      ).toBe(false);
      expect(
        MonthBroadcastEntrySchema.safeParse({ ...valid, state: "archived" })
          .success,
      ).toBe(false);
    });

    it("strips any extra internal field — the allow-list is closed", () => {
      const parsed = MonthBroadcastEntrySchema.parse({
        ...valid,
        partnerRef: "sponsor:acme",
        description: "leak",
        speakers: [{ name: "x" }],
      }) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(
        ["id", "school", "slug", "startsAt", "state", "title"].sort(),
      );
    });
  });

  describe("MonthlyEventCountsSchema (EARS-16 — exactly 12 rows)", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      count: 0,
    }));

    it("accepts exactly 12 rows and rejects a short list", () => {
      expect(MonthlyEventCountsSchema.parse(twelve)).toHaveLength(12);
      expect(
        MonthlyEventCountsSchema.safeParse(twelve.slice(0, 11)).success,
      ).toBe(false);
    });

    it("rejects a negative count or an out-of-range month", () => {
      const bad = twelve.map((r) => ({ ...r }));
      bad[0] = { month: 1, count: -1 };
      expect(MonthlyEventCountsSchema.safeParse(bad).success).toBe(false);
      const badMonth = twelve.map((r) => ({ ...r }));
      badMonth[0] = { month: 13, count: 0 };
      expect(MonthlyEventCountsSchema.safeParse(badMonth).success).toBe(false);
    });
  });
});
