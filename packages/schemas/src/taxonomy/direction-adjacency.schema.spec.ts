import { describe, expect, it } from "vitest";

import {
  CreateDirectionAdjacencyRequestSchema,
  DirectionAdjacencyAdminDetailSchema,
  DirectionAdjacencyAdminListQuerySchema,
  DirectionAdjacencyKindSchema,
  DIRECTION_ADJACENCY_KINDS,
  DIRECTION_ADJACENCY_WEIGHT_MAX,
  DIRECTION_ADJACENCY_WEIGHT_MIN,
  UpdateDirectionAdjacencyRequestSchema,
} from "./index.js";

const DIRECTION_A = "11111111-1111-4111-8111-111111111111";
const DIRECTION_B = "22222222-2222-4222-8222-222222222222";

// 017 EARS-18 (#1483) — «Вид связи» became a CLOSED vocabulary and «Вес» left
// the operator interface. Both are contract facts before they are UI facts, so
// they are proved here against the SSOT rather than only through the admin form.
describe("017 taxonomy — direction adjacency authoring contract (SSOT)", () => {
  it("EARS-18.12: the «Вид связи» vocabulary shall be exactly the three authored relations, and nothing else", () => {
    expect([...DIRECTION_ADJACENCY_KINDS]).toEqual([
      "related",
      "subdiscipline",
      "interdisciplinary",
    ]);
    for (const kind of DIRECTION_ADJACENCY_KINDS) {
      expect(DirectionAdjacencyKindSchema.safeParse(kind).success).toBe(true);
    }
    // The stored value is a machine slug: the RU label an operator reads
    // («Смежное направление») is presentation and never reaches the wire.
    for (const rejected of [
      "Related",
      "смежное направление",
      "sibling",
      "broader",
      "",
      " related",
      null,
      42,
    ]) {
      expect(DirectionAdjacencyKindSchema.safeParse(rejected).success).toBe(
        false,
      );
    }
  });

  it("EARS-18.13: a create shall need only the two endpoints and the kind — «Вес» is optional and the column default applies", () => {
    expect(
      CreateDirectionAdjacencyRequestSchema.parse({
        directionId: DIRECTION_A,
        adjacentDirectionId: DIRECTION_B,
        kind: "related",
      }),
    ).toEqual({
      directionId: DIRECTION_A,
      adjacentDirectionId: DIRECTION_B,
      kind: "related",
    });
    // Weight is a tuning parameter of targeting resolution, so the schema does
    // NOT invent a value here: an absent key stays absent and the DB default is
    // the single place the number is decided.
    expect(
      CreateDirectionAdjacencyRequestSchema.parse({
        directionId: DIRECTION_A,
        adjacentDirectionId: DIRECTION_B,
        kind: "subdiscipline",
      }),
    ).not.toHaveProperty("weight");

    // A caller that does state a weight is still held to the bounds.
    for (const weight of [
      DIRECTION_ADJACENCY_WEIGHT_MIN,
      DIRECTION_ADJACENCY_WEIGHT_MAX,
    ]) {
      expect(
        CreateDirectionAdjacencyRequestSchema.safeParse({
          directionId: DIRECTION_A,
          adjacentDirectionId: DIRECTION_B,
          kind: "related",
          weight,
        }).success,
      ).toBe(true);
    }
    for (const weight of [0, 101, 50.5, "много"]) {
      expect(
        CreateDirectionAdjacencyRequestSchema.safeParse({
          directionId: DIRECTION_A,
          adjacentDirectionId: DIRECTION_B,
          kind: "related",
          weight,
        }).success,
      ).toBe(false);
    }
  });

  it("EARS-18.14: a create shall refuse a missing kind, a self-edge and any field the edge does not have", () => {
    expect(
      CreateDirectionAdjacencyRequestSchema.safeParse({
        directionId: DIRECTION_A,
        adjacentDirectionId: DIRECTION_B,
      }).success,
    ).toBe(false);

    const selfEdge = CreateDirectionAdjacencyRequestSchema.safeParse({
      directionId: DIRECTION_A,
      adjacentDirectionId: DIRECTION_A,
      kind: "related",
    });
    expect(selfEdge.success).toBe(false);
    if (!selfEdge.success) {
      expect(selfEdge.error.issues[0]!.path).toEqual(["adjacentDirectionId"]);
    }

    // `.strict()`: an operator who believes they authored a label the edge does
    // not carry would only discover it after publication.
    for (const extra of [{ label: "Смежное" }, { title: "Кардиология" }]) {
      expect(
        CreateDirectionAdjacencyRequestSchema.safeParse({
          directionId: DIRECTION_A,
          adjacentDirectionId: DIRECTION_B,
          kind: "related",
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it("EARS-18.15: a PATCH shall re-label or re-weight the SAME edge and never move its endpoints", () => {
    expect(
      UpdateDirectionAdjacencyRequestSchema.parse({
        kind: "interdisciplinary",
      }),
    ).toEqual({ kind: "interdisciplinary" });
    expect(UpdateDirectionAdjacencyRequestSchema.parse({ weight: 90 })).toEqual({
      weight: 90,
    });
    expect(
      UpdateDirectionAdjacencyRequestSchema.safeParse({ kind: "sibling" })
        .success,
    ).toBe(false);
    // Moving an edge is retiring one and authoring another, so the endpoints are
    // not patchable at all.
    for (const endpoint of [
      { directionId: DIRECTION_B },
      { adjacentDirectionId: DIRECTION_A },
    ]) {
      expect(
        UpdateDirectionAdjacencyRequestSchema.safeParse(endpoint).success,
      ).toBe(false);
    }
  });

  it("EARS-18.16: the admin projection and its list filter shall speak the same closed vocabulary", () => {
    const now = new Date().toISOString();
    const detail = {
      id: "33333333-3333-4333-8333-333333333333",
      directionId: DIRECTION_A,
      directionTitle: "Кардиология",
      directionSlug: "kardiologiya",
      adjacentDirectionId: DIRECTION_B,
      adjacentDirectionTitle: "Детская кардиология",
      adjacentDirectionSlug: "detskaya-kardiologiya",
      kind: "subdiscipline" as const,
      weight: 50,
      status: "active" as const,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    expect(
      DirectionAdjacencyAdminDetailSchema.parse(detail).kind,
    ).toBe("subdiscipline");
    expect(
      DirectionAdjacencyAdminDetailSchema.safeParse({
        ...detail,
        kind: "sibling",
      }).success,
    ).toBe(false);
    expect(
      DirectionAdjacencyAdminListQuerySchema.safeParse({ kind: "related" })
        .success,
    ).toBe(true);
    expect(
      DirectionAdjacencyAdminListQuerySchema.safeParse({ kind: "sibling" })
        .success,
    ).toBe(false);
  });
});
