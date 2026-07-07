import { describe, expect, it } from "vitest";
import {
  canTransition,
  ConfigureStreamRequestSchema,
  CreateEventRequestSchema,
  EVENT_LIFECYCLE_STATES,
  isPubliclyReachable,
  LIFECYCLE_TRANSITIONS,
  mskLocalToInstant,
  PUBLIC_EVENT_STATES,
  STREAM_PROVIDERS,
  TransitionEventRequestSchema,
  UpdateEventRequestSchema,
  validTransitions,
} from "./events.schema.js";

// 007 EARS-1 pure contract logic — the МСК→instant fold, the closed transition
// map, and the create-request validation. Framework-free unit coverage that
// runs in the shared CI unit job (no infra), complementing the API e2e.
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
    it("EARS-3: the closed provider set is exactly rutube | youtube (no additive drift)", () => {
      // Locks the wave-1 enum — extending it later is a deliberate additive
      // migration (owner decision 2026-07-06), never a silent widening.
      expect([...STREAM_PROVIDERS]).toEqual(["rutube", "youtube"]);
    });

    it("EARS-3: accepts each provider from the closed enum + an embed reference", () => {
      for (const provider of STREAM_PROVIDERS) {
        const parsed = ConfigureStreamRequestSchema.parse({
          provider,
          embedRef: "abc123XYZ",
        });
        expect(parsed.provider).toBe(provider);
        expect(parsed.embedRef).toBe("abc123XYZ");
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
          embedRef: "  vid-42  ",
        }).embedRef,
      ).toBe("vid-42");
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
