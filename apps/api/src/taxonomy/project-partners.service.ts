import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { ProjectPartner } from "@ds/db";
import {
  type CreateProjectPartnerRequest,
  type ProjectPartnerAdminDetail,
  type ProjectPartnerAdminList,
  type ProjectPartnerAdminListQuery,
  type PublicCursorQuery,
  type PublicPartnerProjectItemPage,
  type PublicProjectPartnerItemPage,
  taxonomyETag,
  type UpdateProjectPartnerRequest,
} from "@ds/schemas";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import {
  type ProjectPartnerRow,
  ProjectPartnersRepository,
} from "./project-partners.repository.js";
import {
  PublicProjectSummaryService,
  toPartnerSummary,
} from "./public-project-summary.service.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";

// 012 EARS-10 (#1292) — the project↔partner relationship commands and both §5.2
// traversals.
//
// One rule shapes the writes: at most ONE active `is_primary` relation per
// project (012-design §2.1 / :210). Unlike the curator seat there is no lower
// bound — a published project with no primary partner is legal and reports
// `primaryPartner: null` — so the whole invariant lives inside one project's
// rows and the project lock plus the partial unique index is the entire
// correctness argument.
//
// The index is IMMEDIATE, so the flag is MOVED by two writes (clear the
// incumbent, then set the successor) rather than promoted over an occupied
// seat. Every command therefore PRE-CHECKS the seat under the project lock and
// refuses with 409 `RELATIONSHIP_CONFLICT` before touching a row: the contract
// promises zero mutation and zero audit row on that refusal, and letting the
// index fire instead would both write nothing useful and surface as a
// 500-shaped constraint fault.

export interface CreateProjectPartnerInput {
  payload: CreateProjectPartnerRequest;
  lease: IdempotencyLease;
}

export interface UpdateProjectPartnerInput {
  id: string;
  payload: UpdateProjectPartnerRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface TransitionProjectPartnerInput {
  id: string;
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface ProjectPartnerCommandResult {
  detail: ProjectPartnerAdminDetail;
  etag: string;
}

/** Either half of a §5.2 public key: a canonical UUID id, or a slug. */
export interface PublicKey {
  id?: string;
  slug?: string;
}

@Injectable()
export class ProjectPartnersService {
  // Explicit @Inject tokens on every dependency — the root-level
  // `endpoint-authz` gate boots this module graph under `tsx`, whose esbuild
  // transform emits no `design:paramtypes`.
  constructor(
    @Inject(ProjectPartnersRepository)
    private readonly repo: ProjectPartnersRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PublicProjectSummaryService)
    private readonly summaries: PublicProjectSummaryService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** `POST /v1/admin/project-partners` — list one partner on one project. */
  create(
    input: CreateProjectPartnerInput,
  ): Promise<ProjectPartnerCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/project-partners/:id` — edit the SAME row's `isPrimary`. */
  update(
    input: UpdateProjectPartnerInput,
  ): Promise<ProjectPartnerCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  /** `POST /v1/admin/project-partners/:id/retire` — `active → retired`. */
  retire(
    input: TransitionProjectPartnerInput,
  ): Promise<ProjectPartnerCommandResult> {
    return this.fenced(input.lease, () =>
      this.transitionCommand(input, "retire"),
    );
  }

  /** `POST /v1/admin/project-partners/:id/restore` — `retired → active`. */
  restore(
    input: TransitionProjectPartnerInput,
  ): Promise<ProjectPartnerCommandResult> {
    return this.fenced(input.lease, () =>
      this.transitionCommand(input, "restore"),
    );
  }

  /** `GET /v1/admin/project-partners/:id` — detail by id, retired included. */
  async detail(id: string): Promise<ProjectPartnerCommandResult> {
    const row = await this.repo.hydratePooled(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return { detail: toDetail(row), etag: taxonomyETag(row.relation.version) };
  }

  /** `GET /v1/admin/project-partners` — the filtered join list (§5.1). */
  async list(
    query: ProjectPartnerAdminListQuery,
  ): Promise<ProjectPartnerAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map(toDetail),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * `GET /v1/public/projects/:key/partners` (§5.2) — exactly
   * `PublicPartnerSummary + { isPrimary }`.
   *
   * An unknown OR not-publicly-eligible project is 404, indistinguishable from
   * each other so a draft leaks no "exists but private" oracle; an eligible
   * project with no eligible partners is an ordinary EMPTY page, never a 404.
   * No join id, no admin field and no commercial term reaches this body — the
   * relationship contributes exactly one boolean.
   */
  async publicPartnersForProject(
    key: PublicKey,
    query: PublicCursorQuery,
  ): Promise<PublicProjectPartnerItemPage> {
    const project = await this.repo.findPublicProject(key);
    if (!project || project.status !== "published" || project.deletedAt) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const after = decodeCursor(query.cursor, TITLE_CURSOR_SHAPE);
    const rows = await this.repo.listPartnersForProject(
      project.id,
      query.limit + 1,
      after,
    );
    const page = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const last = page.at(-1);
    return {
      data: await Promise.all(
        page.map(async (row) => ({
          ...(await toPartnerSummary(row.partner, this.storage)),
          isPrimary: row.isPrimary,
        })),
      ),
      pagination: {
        nextCursor:
          hasMore && last
            ? encodeCursor({ title: last.partner.title, id: last.partner.id })
            : null,
        hasMore,
      },
    };
  }

  /**
   * `GET /v1/public/partners/:key/projects` (§5.2) — exactly
   * `PublicProjectSummary + { isPrimary }`, built through the ONE summary mapper
   * so `primaryPartner` is populated here exactly as on every other route.
   */
  async publicProjectsForPartner(
    key: PublicKey,
    query: PublicCursorQuery,
  ): Promise<PublicPartnerProjectItemPage> {
    const partner = await this.repo.findPublicPartner(key);
    if (!partner || partner.status !== "published" || partner.deletedAt) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const after = decodeCursor(query.cursor, TITLE_CURSOR_SHAPE);
    const rows = await this.repo.listProjectsForPartner(
      partner.id,
      query.limit + 1,
      after,
    );
    const page = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const last = page.at(-1);
    const summaries = await this.summaries.summarize(
      page.map((row) => row.project),
    );
    return {
      data: summaries.map((summary, index) => ({
        ...summary,
        isPrimary: page[index]!.isPrimary,
      })),
      pagination: {
        nextCursor:
          hasMore && last
            ? encodeCursor({ title: last.project.title, id: last.project.id })
            : null,
        hasMore,
      },
    };
  }

  /**
   * Tag any DETERMINISTIC refusal with the reserved idempotency record, so the
   * problem filter fenced-stores the outcome and an exact retry replays it
   * (§6 bullet 3 / EARS-17).
   */
  private async fenced<T>(
    lease: IdempotencyLease,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw markReplayable(err, lease);
    }
  }

  private async createCommand(
    input: CreateProjectPartnerInput,
  ): Promise<ProjectPartnerCommandResult> {
    const { projectId, partnerId, isPrimary } = input.payload;

    const created = await this.repo.transaction(async (tx) => {
      const [project] = await this.repo.lockProjects(tx, [projectId]);
      if (!project) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      const partner = await this.repo.partnerLifecycle(tx, partnerId);
      if (!partner || partner.deletedAt) {
        throw new TaxonomyError("RESOURCE_NOT_FOUND");
      }
      const relations = await this.repo.lockRelationsOfProject(tx, projectId);

      // The logical pair spans retained rows: an existing retired relation is
      // RESTORED, never duplicated by a second create.
      if (await this.repo.pairTaken(tx, projectId, partnerId)) {
        throw new TaxonomyError(
          "RELATIONSHIP_CONFLICT",
          "this partner is already listed on this project; restore that relation instead of creating a second one",
        );
      }
      // Pre-checked under the project lock so the immediate partial unique index
      // never fires: the refusal is a 409 with ZERO rows written and therefore
      // zero audit rows captured.
      if (isPrimary) assertPrimaryFree(relations);

      const row = await this.repo.insert(tx, {
        projectId,
        partnerId,
        isPrimary,
      });
      const hydrated = await this.repo.hydrate(tx, row.id);
      if (!hydrated) throw new Error("project_partner hydrate returned no row");
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(hydrated),
        etag: taxonomyETag(row.version),
        location: `/v1/admin/project-partners/${row.id}`,
      });
      return hydrated;
    });

    return {
      detail: toDetail(created),
      etag: taxonomyETag(created.relation.version),
    };
  }

  private async updateCommand(
    input: UpdateProjectPartnerInput,
  ): Promise<ProjectPartnerCommandResult> {
    // Read the row OUTSIDE the transaction only to learn which project to lock —
    // every value it carries is re-read under that lock.
    const seed = await this.repo.findById(input.id);
    if (!seed) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const updated = await this.repo.transaction(async (tx) => {
      const [project] = await this.repo.lockProjects(tx, [seed.projectId]);
      if (!project) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      const relations = await this.repo.lockRelationsOfProject(
        tx,
        seed.projectId,
      );
      const current = relations.find((row) => row.id === input.id);
      if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      assertVersion(current, input.expectedVersion);

      const nextPrimary = input.payload.isPrimary ?? current.isPrimary;
      // Setting the flag while another ACTIVE row holds it is refused with a 409
      // and zero mutation: the operator clears the incumbent first, so «who is
      // the primary partner» is never decided by request arrival order.
      if (nextPrimary && !current.isPrimary && current.status === "active") {
        assertPrimaryFree(relations, current.id);
      }

      const row = await this.repo.updateVersioned(
        tx,
        current.id,
        input.expectedVersion,
        {
          ...(input.payload.isPrimary !== undefined
            ? { isPrimary: nextPrimary }
            : {}),
        },
      );
      if (!row) throw stale();
      const hydrated = await this.repo.hydrate(tx, row.id);
      if (!hydrated) throw new Error("project_partner hydrate returned no row");
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(hydrated),
        etag: taxonomyETag(row.version),
      });
      return hydrated;
    });

    return {
      detail: toDetail(updated),
      etag: taxonomyETag(updated.relation.version),
    };
  }

  private async transitionCommand(
    input: TransitionProjectPartnerInput,
    transition: "retire" | "restore",
  ): Promise<ProjectPartnerCommandResult> {
    const seed = await this.repo.findById(input.id);
    if (!seed) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const updated = await this.repo.transaction(async (tx) => {
      const [project] = await this.repo.lockProjects(tx, [seed.projectId]);
      if (!project) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      const relations = await this.repo.lockRelationsOfProject(
        tx,
        seed.projectId,
      );
      const current = relations.find((row) => row.id === input.id);
      if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      assertVersion(current, input.expectedVersion);

      const nextStatus = transition === "retire" ? "retired" : "active";
      if (current.status === nextStatus) {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          `the relation is already ${nextStatus}`,
        );
      }
      // Restoring a row that still carries `is_primary` while another active row
      // took the flag in the meantime would collide with the index — refuse it
      // as the conflict it is, with zero mutation.
      if (transition === "restore" && current.isPrimary) {
        assertPrimaryFree(relations, current.id);
      }

      const row = await this.repo.updateVersioned(
        tx,
        current.id,
        input.expectedVersion,
        {
          status: nextStatus,
          deletedAt: transition === "retire" ? new Date() : null,
        },
      );
      if (!row) throw stale();
      const hydrated = await this.repo.hydrate(tx, row.id);
      if (!hydrated) throw new Error("project_partner hydrate returned no row");
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(hydrated),
        etag: taxonomyETag(row.version),
      });
      return hydrated;
    });

    return {
      detail: toDetail(updated),
      etag: taxonomyETag(updated.relation.version),
    };
  }
}

/**
 * The at-most-one-active-primary bound, pre-checked so the immediate partial
 * unique index never has to fire.
 */
function assertPrimaryFree(
  relations: readonly ProjectPartner[],
  exceptId?: string,
): void {
  const held = relations.some(
    (row) =>
      row.id !== exceptId && row.status === "active" && row.isPrimary === true,
  );
  if (held) {
    throw new TaxonomyError(
      "RELATIONSHIP_CONFLICT",
      "this project already has a primary partner; clear that flag before setting another",
    );
  }
}

function assertVersion(row: ProjectPartner, expected: number): void {
  if (row.version !== expected) throw stale();
}

function stale(): TaxonomyError {
  return new TaxonomyError(
    "PRECONDITION_FAILED",
    "the relation changed since it was read; reload and retry",
  );
}

/** The admin projection of one relation — both endpoints' display forms inline. */
function toDetail(row: ProjectPartnerRow): ProjectPartnerAdminDetail {
  return {
    id: row.relation.id,
    projectId: row.project.id,
    projectTitle: row.project.title,
    projectSlug: row.project.slug,
    partnerId: row.partner.id,
    partnerTitle: row.partner.title,
    partnerSlug: row.partner.slug,
    isPrimary: row.relation.isPrimary,
    status: row.relation.status,
    version: row.relation.version,
    createdAt: row.relation.createdAt.toISOString(),
    updatedAt: row.relation.updatedAt.toISOString(),
  };
}

/**
 * The §5.2 cursor is opaque BY CONTRACT: it encodes the stable order tuple the
 * server chose, and a client that decodes and edits it is holding a value the
 * server refuses with 400 `CURSOR_INVALID` rather than one it silently trusts.
 */
function encodeCursor(value: Record<string, string>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * Both directions order by `(title, id)`, so one SHAPE serves both. It is a
 * shape rather than a cast because a cursor is caller-supplied bytes on a
 * ZERO-AUTH route: the decoded values become SQL operands, and an `id` that is
 * not a UUID reaches a `uuid` column as Postgres `22P02` — a 500 for what
 * EARS-16 contracts as 400.
 */
const TITLE_CURSOR_SHAPE = z
  .object({ title: z.string(), id: z.uuid() })
  .strict();

function decodeCursor<T>(
  cursor: string | undefined,
  shape: z.ZodType<T>,
): T | null {
  if (cursor === undefined) return null;
  try {
    return shape.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new TaxonomyError(
      "CURSOR_INVALID",
      "this cursor was not issued by this API; start from the first page",
    );
  }
}
