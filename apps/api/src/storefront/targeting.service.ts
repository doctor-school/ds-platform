import { Inject, Injectable } from "@nestjs/common";
import type { TargetingSet } from "@ds/schemas";
import { TARGETING_GENERAL_FALLBACK_STATEMENT_RU } from "@ds/schemas";
import { SpecialtiesService } from "./specialties.service.js";
import { TargetingRepository } from "./targeting.repository.js";

/**
 * Resolve EARS-8's `TargetingSet` from a chosen closed-book specialty. Choice
 * ownership stays with `SpecialtyChoiceService`; callers hand this resolver the
 * remembered reference, and it resolves membership plus the current managed
 * traversal on every read.
 */
@Injectable()
export class TargetingService {
  constructor(
    @Inject(SpecialtiesService)
    private readonly specialties: SpecialtiesService,
    @Inject(TargetingRepository)
    private readonly targeting: TargetingRepository,
  ) {}

  async resolve(specialtyReference: string): Promise<TargetingSet> {
    const primary = await this.specialties.resolveMember(specialtyReference);

    if (primary.isOther) {
      return {
        primary,
        mode: "general",
        statement: TARGETING_GENERAL_FALLBACK_STATEMENT_RU,
        directions: [],
        adjacentDirections: [],
      };
    }

    const ownRows = await this.targeting.findOwnDirections(primary.id);
    const ownIds = new Set(ownRows.map((row) => row.id));
    const adjacentRows = await this.targeting.findAdjacentDirections([
      ...ownIds,
    ]);

    const adjacentDirections: TargetingSet["adjacentDirections"] = [];
    const admittedAdjacentIds = new Set<string>();
    for (const row of adjacentRows) {
      if (ownIds.has(row.id) || admittedAdjacentIds.has(row.id)) continue;
      admittedAdjacentIds.add(row.id);
      adjacentDirections.push({
        id: row.id,
        slug: row.slug,
        title: row.title,
        role: "adjacent",
        kind: row.kind,
        weight: row.weight,
      });
    }

    return {
      primary,
      mode: "targeted",
      statement: null,
      directions: ownRows.map((row) => ({ ...row, role: "own" as const })),
      adjacentDirections,
    };
  }
}
