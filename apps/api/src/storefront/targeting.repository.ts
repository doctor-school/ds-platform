import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { directions, directionAdjacency, directionSpecialties } from "@ds/db";
import type { DirectionAdjacencyKind } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";

type Db = DrizzleHandle["db"];

export interface TargetingDirectionRow {
  id: string;
  slug: string;
  title: string;
}

export interface TargetingAdjacencyRow extends TargetingDirectionRow {
  edgeId: string;
  kind: DirectionAdjacencyKind;
  weight: number;
}

/**
 * 017 EARS-8 read-through access to the two managed targeting relations. There
 * is deliberately no cache and no inference query: each answer reflects the
 * currently active retained rows, and every returned direction has a concrete
 * relation row behind it.
 */
@Injectable()
export class TargetingRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  findOwnDirections(specialtyId: string): Promise<TargetingDirectionRow[]> {
    return this.db
      .select({
        id: directions.id,
        slug: directions.slug,
        title: directions.title,
      })
      .from(directionSpecialties)
      .innerJoin(
        directions,
        eq(directions.id, directionSpecialties.directionId),
      )
      .where(
        and(
          eq(directionSpecialties.specialtyMinzdravId, specialtyId),
          eq(directionSpecialties.status, "active"),
          isNull(directionSpecialties.deletedAt),
          eq(directions.status, "published"),
          isNull(directions.deletedAt),
        ),
      )
      .orderBy(asc(directions.id));
  }

  async findAdjacentDirections(
    ownDirectionIds: string[],
  ): Promise<TargetingAdjacencyRow[]> {
    if (ownDirectionIds.length === 0) return [];

    return this.db
      .select({
        edgeId: directionAdjacency.id,
        id: directions.id,
        slug: directions.slug,
        title: directions.title,
        kind: directionAdjacency.kind,
        weight: directionAdjacency.weight,
      })
      .from(directionAdjacency)
      .innerJoin(
        directions,
        eq(directions.id, directionAdjacency.adjacentDirectionId),
      )
      .where(
        and(
          inArray(directionAdjacency.directionId, ownDirectionIds),
          eq(directionAdjacency.status, "active"),
          isNull(directionAdjacency.deletedAt),
          eq(directions.status, "published"),
          isNull(directions.deletedAt),
        ),
      )
      .orderBy(desc(directionAdjacency.weight), asc(directionAdjacency.id));
  }
}
