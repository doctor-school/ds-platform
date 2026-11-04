import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import type { DrizzleHandle, ProjectOutputKind } from "@ds/db";
import { projectOutputKinds, projectResults, projects } from "@ds/db";
import type { ProjectOutputKindStatus } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

// 030 EARS-3 (#3503) — Drizzle data access for the «Виды результатов» reference
// book. Every mutating path runs through `withRequestAuditContext`, so feature
// 010's capture trigger attributes the `data.project_output_kinds.*` ledger rows
// to the acting administrator (EARS-18).

type Db = DrizzleHandle["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A kind row with the number of results of that kind (every project, EARS-3). */
export type ProjectOutputKindWithCount = ProjectOutputKind & {
  resultCount: number;
};

/** A draft or published project holding a kind — the `OUTPUT_KIND_IN_USE` list. */
export interface OutputKindHolder {
  id: string;
  title: string;
}

@Injectable()
export class ProjectOutputKindsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /** Run `fn` in one audit-attributed transaction. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withRequestAuditContext(this.db, fn);
  }

  /** Serialize allocation of one derived slug sequence. */
  async lockSlugSequence(tx: Tx, base: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${base}, 0))`,
    );
  }

  /** Serialize writers of one case-insensitive active title. */
  async lockTitle(tx: Tx, title: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`project-output-kind-title:${title.toLowerCase()}`}, 0))`,
    );
  }

  async slugTaken(tx: Tx | Db, slug: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: projectOutputKinds.id })
      .from(projectOutputKinds)
      .where(eq(projectOutputKinds.slug, slug))
      .limit(1);
    return Boolean(row);
  }

  /** Whether another ACTIVE kind already carries `title`, case-insensitively. */
  async activeTitleTaken(
    tx: Tx | Db,
    title: string,
    exceptId?: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: projectOutputKinds.id })
      .from(projectOutputKinds)
      .where(
        and(
          eq(projectOutputKinds.status, "active"),
          sql`lower(${projectOutputKinds.title}) = lower(${title})`,
          exceptId ? ne(projectOutputKinds.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async insert(
    tx: Tx,
    values: { slug: string; title: string },
  ): Promise<ProjectOutputKind> {
    const [row] = await tx
      .insert(projectOutputKinds)
      .values(values)
      .returning();
    if (!row) throw new Error("project output kind insert returned no row");
    return row;
  }

  async lockById(tx: Tx, id: string): Promise<ProjectOutputKind | null> {
    const [row] = await tx
      .select()
      .from(projectOutputKinds)
      .where(eq(projectOutputKinds.id, id))
      .for("update");
    return row ?? null;
  }

  /**
   * Read the kinds a results save names, `FOR SHARE`, ascending id: a retire
   * (which takes the kind's row lock `FOR UPDATE`) cannot interleave with the
   * save that adds the kind (030-design §Data model).
   */
  async shareLockByIds(
    tx: Tx,
    ids: readonly string[],
  ): Promise<ProjectOutputKind[]> {
    if (ids.length === 0) return [];
    return tx
      .select()
      .from(projectOutputKinds)
      .where(inArray(projectOutputKinds.id, [...ids]))
      .orderBy(asc(projectOutputKinds.id))
      .for("share");
  }

  /** Apply a title or lifecycle patch and bump `version`, guarded by the expected version. */
  async updateVersioned(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: {
      title?: string;
      status?: ProjectOutputKindStatus;
      deletedAt?: Date | null;
    },
  ): Promise<ProjectOutputKind | null> {
    const [row] = await tx
      .update(projectOutputKinds)
      .set({
        ...patch,
        version: sql`${projectOutputKinds.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectOutputKinds.id, id),
          eq(projectOutputKinds.version, expectedVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Every result of `kindId`, whatever its project's status. */
  async resultCount(tx: Tx | Db, kindId: string): Promise<number> {
    const [row] = await tx
      .select({ value: count() })
      .from(projectResults)
      .where(eq(projectResults.outputKindId, kindId));
    return Number(row?.value ?? 0);
  }

  /** The draft and published projects holding `kindId` — the retire refusal list. */
  async holders(tx: Tx, kindId: string): Promise<OutputKindHolder[]> {
    return tx
      .selectDistinct({ id: projects.id, title: projects.title })
      .from(projectResults)
      .innerJoin(projects, eq(projects.id, projectResults.projectId))
      .where(
        and(
          eq(projectResults.outputKindId, kindId),
          inArray(projects.status, ["draft", "published"]),
        ),
      )
      .orderBy(asc(projects.title), asc(projects.id));
  }

  /** The whole book (a small one), ordered by title, with result counts. */
  async list(
    status: ProjectOutputKindStatus | undefined,
  ): Promise<ProjectOutputKindWithCount[]> {
    const counts = this.db
      .select({
        kindId: projectResults.outputKindId,
        n: count().as("n"),
      })
      .from(projectResults)
      .groupBy(projectResults.outputKindId)
      .as("result_counts");
    const rows = await this.db
      .select({ kind: projectOutputKinds, n: counts.n })
      .from(projectOutputKinds)
      .leftJoin(counts, eq(counts.kindId, projectOutputKinds.id))
      .where(status ? eq(projectOutputKinds.status, status) : undefined)
      .orderBy(asc(projectOutputKinds.title), asc(projectOutputKinds.id));
    return rows.map(({ kind, n }) => ({
      ...kind,
      resultCount: Number(n ?? 0),
    }));
  }
}
