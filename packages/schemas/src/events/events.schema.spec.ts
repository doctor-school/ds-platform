import { describe, expect, it } from "vitest";
import {
  CreateEventRequestSchema,
  LIFECYCLE_TRANSITIONS,
  mskLocalToInstant,
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
        CreateEventRequestSchema.safeParse({ ...base, startsAtMsk: "2026-07-17 19:00" })
          .success,
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
});
