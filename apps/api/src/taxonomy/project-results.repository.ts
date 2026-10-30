import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import type { DrizzleHandle, ProjectOutputKind, ProjectResult } from "@ds/db";
import { projectOutputKinds, projectResults } from "@ds/db";
import { DRIZZLE_DB } from "../database/database.tokens.js";

// 030 EARS-2 (#3503) — Drizzle data access for a project's ordered result set.
// The set is replaced inside the project's version-checked, audit-attributed
// transaction (the caller's `tx`), so `projects.version` stays the one ETag.

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ProjectResultWithKind = ProjectResult & {
  outputKind: ProjectOutputKind;
};

export interface ProjectResultInsert {
  outputKindId: string;
  position: number;
  title: string;
  description: string | null;
  storefrontUrl: string | null;
}

@Injectable()
export class ProjectResultsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** The project's results in order, each with its kind (a retired one included). */
  async listForProject(
    projectId: string,
    tx?: Tx,
  ): Promise<ProjectResultWithKind[]> {
    const rows = await (tx ?? this.db)
      .select({ result: projectResults, kind: projectOutputKinds })
      .from(projectResults)
      .innerJoin(
        projectOutputKinds,
        eq(projectOutputKinds.id, projectResults.outputKindId),
      )
      .where(eq(projectResults.projectId, projectId))
      .orderBy(asc(projectResults.position));
    return rows.map(({ result, kind }) => ({ ...result, outputKind: kind }));
  }

  /** Replace the whole set: the old rows go, the new ones take positions 0..n-1. */
  async replace(
    tx: Tx,
    projectId: string,
    rows: readonly ProjectResultInsert[],
  ): Promise<void> {
    await tx
      .delete(projectResults) // retained-data-ok: 030 EARS-2 — the result set is replaced as one ordered set; each removed row is captured by the 010 `project_results_audit` trigger
      .where(eq(projectResults.projectId, projectId));
    if (rows.length === 0) return;
    await tx
      .insert(projectResults)
      .values(rows.map((row) => ({ ...row, projectId })));
  }
}
