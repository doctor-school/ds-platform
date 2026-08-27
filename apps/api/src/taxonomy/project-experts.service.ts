import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { ProjectExpert } from "@ds/db";
import {
  type CreateProjectExpertRequest,
  type ProjectExpertAdminDetail,
  type ProjectExpertAdminList,
  type ProjectExpertAdminListQuery,
  type PublicCursorQuery,
  type PublicExpertProjectItemPage,
  type PublicProjectExpertItemPage,
  taxonomyETag,
  type UpdateProjectExpertRequest,
} from "@ds/schemas";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import {
  type ExpertLifecycle,
  type ProjectExpertRow,
  ProjectExpertsRepository,
  type ProjectLifecycle,
} from "./project-experts.repository.js";
import { PublicProjectSummaryService } from "./public-project-summary.service.js";
import { markReplayable, TaxonomyError } from "./taxonomy.errors.js";

// 012 EARS-9 (#1291) — the project↔expert relationship commands and both §5.2
// traversals.
//
// One rule shapes this whole file: 012-design §3.2 requires every committed
// PUBLISHED project to carry exactly ONE active curator, and that curator's
// expert to be published and non-retired. Half of that is an index
// (`project_experts_project_curator_active_uniq` — the at-most-one upper bound);
// the other half spans two tables and is therefore enforced here, under the
// §3.2 lock order:
//
//   affected experts (ascending stable id)
//     → affected projects (ascending stable id)
//       → the project's `project_experts` rows
//
// Because the partial unique index is IMMEDIATE rather than deferrable,
// `ReplaceProjectCurator` cannot promote the candidate and then demote the
// incumbent: the two curator rows would collide mid-transaction even though the
// end state is legal. It demotes FIRST, which is also the order §2.4's
// `RemoveExpertContent` (#1306) will need when it retires a curator's relation.
//
// Every command recomputes the WOULD-BE relation set and runs one invariant
// check over it, rather than reasoning about its own delta. That is what makes a
// retire, a demote and a replace share one correctness argument instead of three.

export interface CreateProjectExpertInput {
  payload: CreateProjectExpertRequest;
  lease: IdempotencyLease;
}

export interface UpdateProjectExpertInput {
  id: string;
  payload: UpdateProjectExpertRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface TransitionProjectExpertInput {
  id: string;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface ReplaceCuratorInput {
  projectId: string;
  expertId: string;
  /** The PROJECT's asserted version — the invariant belongs to the project. */
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface ProjectExpertCommandResult {
  detail: ProjectExpertAdminDetail;
  etag: string;
}

/** Either half of a §5.2 public key: a canonical UUID id, or a slug. */
export interface PublicKey {
  id?: string;
  slug?: string;
}

/** The relation shape the invariant check reasons over. */
interface RelationSlot {
  id: string;
  expertId: string;
  role: "curator" | "member";
  status: "active" | "retired";
}

@Injectable()
export class ProjectExpertsService {
  // Explicit @Inject tokens on every dependency — the root-level
  // `endpoint-authz` gate boots this module graph under `tsx`, whose esbuild
  // transform emits no `design:paramtypes`, so a type-inferred injection
  // resolves to `undefined` there while working fine under `nest build`.
  constructor(
    @Inject(ProjectExpertsRepository)
    private readonly repo: ProjectExpertsRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(PublicProjectSummaryService)
    private readonly summaries: PublicProjectSummaryService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** `POST /v1/admin/project-experts` — list one expert on one project. */
  create(input: CreateProjectExpertInput): Promise<ProjectExpertCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/project-experts/:id` — edit the SAME row's role. */
  update(input: UpdateProjectExpertInput): Promise<ProjectExpertCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  /** `POST /v1/admin/project-experts/:id/retire` — `active → retired`. */
  retire(
    input: TransitionProjectExpertInput,
  ): Promise<ProjectExpertCommandResult> {
    return this.fenced(input.lease, () =>
      this.transitionCommand(input, "retire"),
    );
  }

  /** `POST /v1/admin/project-experts/:id/restore` — `retired → active`. */
  restore(
    input: TransitionProjectExpertInput,
  ): Promise<ProjectExpertCommandResult> {
    return this.fenced(input.lease, () =>
      this.transitionCommand(input, "restore"),
    );
  }

  /** `POST /v1/admin/projects/:id/replace-curator` — the §3.2 atomic handover. */
  replaceCurator(
    input: ReplaceCuratorInput,
  ): Promise<ProjectExpertCommandResult> {
    return this.fenced(input.lease, () => this.replaceCuratorCommand(input));
  }

  /** `GET /v1/admin/project-experts/:id` — detail by id, retired included. */
  async detail(id: string): Promise<ProjectExpertCommandResult> {
    const row = await this.repo.hydratePooled(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return { detail: toDetail(row), etag: taxonomyETag(row.relation.version) };
  }

  /** `GET /v1/admin/project-experts` — the filtered join list (§5.1). */
  async list(
    query: ProjectExpertAdminListQuery,
  ): Promise<ProjectExpertAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map(toDetail),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * `GET /v1/public/projects/:key/experts` (§5.2) — exactly
   * `PublicExpertSummary + { role }`.
   *
   * An unknown OR not-publicly-eligible project is 404, indistinguishable from
   * each other so a draft leaks no "exists but private" oracle; an eligible
   * project with no eligible experts is an ordinary EMPTY page, never a 404.
   */
  async publicExpertsForProject(
    key: PublicKey,
    query: PublicCursorQuery,
  ): Promise<PublicProjectExpertItemPage> {
    const project = await this.repo.findPublicProject(key);
    if (!project || project.status !== "published" || project.deletedAt) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const after = decodeCursor(query.cursor, EXPERT_CURSOR_SHAPE);
    const rows = await this.repo.listExpertsForProject(
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
          id: row.expert.id,
          slug: row.expert.slug,
          // The public item is a string DTO; the query already excludes rows
          // with no name, and the remaining optional regalia become "" rather
          // than null or a missing key (the §5.2 shape the 007 projection uses).
          name: row.expert.name ?? "",
          professionalRole: row.expert.professionalRole ?? "",
          credentials: row.expert.credentials ?? "",
          affiliation: row.expert.affiliation ?? "",
          photoUrl: row.expert.photoRef
            ? await this.storage.urlFor(row.expert.photoRef)
            : null,
          role: row.role,
        })),
      ),
      pagination: {
        nextCursor:
          hasMore && last
            ? encodeCursor({ name: last.expert.name ?? "", id: last.expert.id })
            : null,
        hasMore,
      },
    };
  }

  /**
   * `GET /v1/public/experts/:key/projects` (§5.2) — exactly
   * `PublicProjectSummary + { role }`, built through the ONE summary mapper so
   * `primaryPartner` is populated here exactly as it is on every other route.
   */
  async publicProjectsForExpert(
    key: PublicKey,
    query: PublicCursorQuery,
  ): Promise<PublicExpertProjectItemPage> {
    const expert = await this.repo.findPublicExpert(key);
    if (
      !expert ||
      expert.status !== "published" ||
      expert.deletedAt ||
      expert.contentRemovedAt
    ) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const after = decodeCursor(query.cursor, PROJECT_CURSOR_SHAPE);
    const rows = await this.repo.listProjectsForExpert(
      expert.id,
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
        role: page[index]!.role,
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
    input: CreateProjectExpertInput,
  ): Promise<ProjectExpertCommandResult> {
    const { projectId, expertId, role } = input.payload;

    const created = await this.repo.transaction(async (tx) => {
      // §3.2 steps 1–3: experts, then projects, then the relation set.
      const [expert] = await this.repo.lockExperts(tx, [expertId]);
      if (!expert) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      assertLinkable(expert);
      const [project] = await this.repo.lockProjects(tx, [projectId]);
      if (!project) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      const relations = await this.repo.lockRelationsOfProject(tx, projectId);

      // The logical pair spans retained rows: an existing retired relation is
      // RESTORED, never duplicated by a second create.
      if (await this.repo.pairTaken(tx, projectId, expertId)) {
        throw new TaxonomyError(
          "RELATIONSHIP_CONFLICT",
          "this expert is already listed on this project; restore that relation instead of creating a second one",
        );
      }

      const eligibility = await this.eligibility(tx, relations, [expert]);
      const next: RelationSlot[] = [
        ...relations.map(toSlot),
        { id: PENDING_ROW_ID, expertId, role, status: "active" },
      ];
      assertCuratorInvariant(project, next, eligibility);

      const row = await this.repo.insert(tx, { projectId, expertId, role });
      const hydrated = await this.repo.hydrate(tx, row.id);
      if (!hydrated) throw new Error("project_expert hydrate returned no row");
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(hydrated),
        etag: taxonomyETag(row.version),
        location: `/v1/admin/project-experts/${row.id}`,
      });
      return hydrated;
    });

    return {
      detail: toDetail(created),
      etag: taxonomyETag(created.relation.version),
    };
  }

  private async updateCommand(
    input: UpdateProjectExpertInput,
  ): Promise<ProjectExpertCommandResult> {
    // Read the row OUTSIDE the transaction only to learn which expert and
    // project to lock — every value it carries is re-read under those locks.
    const seed = await this.repo.findById(input.id);
    if (!seed) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const updated = await this.repo.transaction(async (tx) => {
      const [expert] = await this.repo.lockExperts(tx, [seed.expertId]);
      if (!expert) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      const [project] = await this.repo.lockProjects(tx, [seed.projectId]);
      if (!project) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      const relations = await this.repo.lockRelationsOfProject(
        tx,
        seed.projectId,
      );
      const current = relations.find((row) => row.id === input.id);
      if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      assertVersion(current, input.expectedVersion);

      const nextRole = input.payload.role ?? current.role;
      const eligibility = await this.eligibility(tx, relations, [expert]);
      const next = relations.map((row) =>
        row.id === current.id
          ? { ...toSlot(row), role: nextRole }
          : toSlot(row),
      );
      assertCuratorInvariant(project, next, eligibility);
      // Promoting to `curator` while the seat is held is refused HERE with a
      // 409 rather than by the immediate partial unique index (a 500-shaped
      // fault): the seat is MOVED by `replace-curator`, never won by a race.
      if (nextRole === "curator" && current.role !== "curator") {
        assertSeatFree(relations, current.id);
      }

      const row = await this.repo.updateVersioned(
        tx,
        current.id,
        input.expectedVersion,
        { ...(input.payload.role !== undefined ? { role: nextRole } : {}) },
      );
      if (!row) throw stale();
      const hydrated = await this.repo.hydrate(tx, row.id);
      if (!hydrated) throw new Error("project_expert hydrate returned no row");
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
    input: TransitionProjectExpertInput,
    transition: "retire" | "restore",
  ): Promise<ProjectExpertCommandResult> {
    const seed = await this.repo.findById(input.id);
    if (!seed) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const updated = await this.repo.transaction(async (tx) => {
      const [expert] = await this.repo.lockExperts(tx, [seed.expertId]);
      if (!expert) throw new TaxonomyError("RESOURCE_NOT_FOUND");
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
      if (transition === "restore") {
        // §3 overlay: re-listing a person who asked to be taken off the site is
        // a fresh authoring act, not an undo.
        assertLinkable(expert);
        if (current.role === "curator") assertSeatFree(relations, current.id);
      }

      const eligibility = await this.eligibility(tx, relations, [expert]);
      const next = relations.map((row) =>
        row.id === current.id
          ? { ...toSlot(row), status: nextStatus as "active" | "retired" }
          : toSlot(row),
      );
      // Retiring the sole curator of a PUBLISHED project is refused with zero
      // row, version and audit mutation — the transaction never writes.
      assertCuratorInvariant(project, next, eligibility);

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
      if (!hydrated) throw new Error("project_expert hydrate returned no row");
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

  /**
   * `ReplaceProjectCurator` (012-design §3.2, :235) — ONE transaction, taking
   * the §3.2 lock order over BOTH experts:
   *
   *   1. lock the incumbent's and the candidate's expert rows, ascending id;
   *   2. lock the project; 3. lock the project's relation rows;
   *   4. re-read: the incumbent must still be the one the seed named, and the
   *      candidate must still be publish-eligible — a candidate retired between
   *      the seed read and the lock loses here, so of two racing replaces
   *      exactly one commits and the other is a 409;
   *   5. DEMOTE the incumbent to `member` FIRST — the partial unique index is
   *      immediate, so a promote-then-demote would collide mid-transaction;
   *   6. create / restore / promote the candidate;
   *   7. bump BOTH relation versions and the PROJECT's version.
   *
   * Any refusal aborts the transaction, which is what "rollback restores the
   * incumbent" means: the demote is never visible without the promote.
   */
  private async replaceCuratorCommand(
    input: ReplaceCuratorInput,
  ): Promise<ProjectExpertCommandResult> {
    const seedRelations = await this.repo.relationsOfProject(input.projectId);
    const seedIncumbent = seedRelations.find(
      (row) => row.status === "active" && row.role === "curator",
    );
    const lockIds = [input.expertId];
    if (seedIncumbent) lockIds.push(seedIncumbent.expertId);

    const promoted = await this.repo.transaction(async (tx) => {
      // 1–3: the canonical order. `lockExperts` sorts, so the caller cannot
      // establish a second order by passing the ids the other way round.
      const locked = await this.repo.lockExperts(tx, lockIds);
      const candidate = locked.find((row) => row.id === input.expertId);
      if (!candidate) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      assertLinkable(candidate);
      const [project] = await this.repo.lockProjects(tx, [input.projectId]);
      if (!project) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (project.status === "retired") {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          "a retired project has no curator seat to hand over",
        );
      }
      const relations = await this.repo.lockRelationsOfProject(
        tx,
        input.projectId,
      );

      // 4: re-read under the locks. An incumbent this transaction did NOT lock
      // cannot be demoted safely, so a seat that moved since the seed read is a
      // failed precondition rather than a silently widened lock set.
      const incumbent = relations.find(
        (row) => row.status === "active" && row.role === "curator",
      );
      if (incumbent && incumbent.id !== seedIncumbent?.id) throw stale();
      if (incumbent?.expertId === input.expertId) {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          "this expert is already the curator of this project",
        );
      }

      // 5: demote FIRST — the immediate partial unique index is why.
      let working = relations;
      if (incumbent) {
        const demoted = await this.repo.updateVersioned(
          tx,
          incumbent.id,
          incumbent.version,
          { role: "member" },
        );
        if (!demoted) throw stale();
        working = working.map((row) => (row.id === demoted.id ? demoted : row));
      }

      // 6: the candidate — restore + promote the retained relation if one
      // exists (§2.1: a retired relation is restored, never reinserted), else
      // create it.
      const existing = working.find((row) => row.expertId === input.expertId);
      let curatorId: string;
      if (existing) {
        const row = await this.repo.updateVersioned(
          tx,
          existing.id,
          existing.version,
          { role: "curator", status: "active", deletedAt: null },
        );
        if (!row) throw stale();
        working = working.map((r) => (r.id === row.id ? row : r));
        curatorId = row.id;
      } else {
        const row = await this.repo.insert(tx, {
          projectId: input.projectId,
          expertId: input.expertId,
          role: "curator",
        });
        working = [...working, row];
        curatorId = row.id;
      }

      const eligibility = await this.eligibility(tx, working, locked);
      assertCuratorInvariant(project, working.map(toSlot), eligibility);

      // 7: the project's own version — the token this command asserted against.
      const bumped = await this.repo.bumpProjectVersion(
        tx,
        input.projectId,
        input.expectedVersion,
      );
      if (!bumped) throw stale();

      const hydrated = await this.repo.hydrate(tx, curatorId);
      if (!hydrated) throw new Error("project_expert hydrate returned no row");
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(hydrated),
        etag: taxonomyETag(bumped.version),
      });
      return { hydrated, projectVersion: bumped.version };
    });

    return {
      detail: toDetail(promoted.hydrated),
      // The PROJECT's new ETag: the client asserted the project's version, so
      // the validator it must echo next is the project's too.
      etag: taxonomyETag(promoted.projectVersion),
    };
  }

  /**
   * Which experts of this project are currently ELIGIBLE to hold the curator
   * seat — published and non-retired (§3.2). The LOCKED experts' freshly-read
   * state wins over the batch read: those are the rows this command holds.
   */
  private async eligibility(
    tx: Parameters<Parameters<ProjectExpertsRepository["transaction"]>[0]>[0],
    relations: readonly Pick<ProjectExpert, "expertId">[],
    locked: readonly ExpertLifecycle[],
  ): Promise<Map<string, boolean>> {
    const rows = await this.repo.expertLifecycles(
      tx,
      relations.map((row) => row.expertId),
    );
    const map = new Map<string, boolean>();
    for (const row of rows) map.set(row.id, isEligible(row));
    for (const row of locked) map.set(row.id, isEligible(row));
    return map;
  }
}

/**
 * The id standing in for the row a create has not inserted yet. It never reaches
 * the database — it exists so the would-be relation set can be checked by the
 * same function the other commands use, rather than by a near-copy.
 */
const PENDING_ROW_ID = "__pending__";

function toSlot(row: ProjectExpert): RelationSlot {
  return {
    id: row.id,
    expertId: row.expertId,
    role: row.role,
    status: row.status,
  };
}

/** Published and non-retired — the only state in which an expert may curate. */
function isEligible(expert: ExpertLifecycle): boolean {
  return (
    expert.status === "published" &&
    expert.deletedAt === null &&
    expert.contentRemovedAt === null
  );
}

/**
 * Refuse to list or restore against a person who asked to be taken off the site
 * (§2.4 / §3): the row is retained, so `content_removed_at` is the only marker
 * distinguishing "removed on request" from an ordinary retire.
 */
function assertLinkable(expert: ExpertLifecycle): void {
  if (expert.contentRemovedAt !== null) {
    throw new TaxonomyError(
      "CONTENT_REMOVED",
      "this record was removed at the person's request; re-listing them is a fresh authoring act",
    );
  }
}

/** The upper bound, pre-checked so the immediate index never has to fire. */
function assertSeatFree(
  relations: readonly ProjectExpert[],
  exceptId: string,
): void {
  const held = relations.some(
    (row) =>
      row.id !== exceptId && row.status === "active" && row.role === "curator",
  );
  if (held) {
    throw new TaxonomyError(
      "RELATIONSHIP_CONFLICT",
      "this project already has an active curator; hand the seat over with POST /v1/admin/projects/:id/replace-curator",
    );
  }
}

/**
 * The whole §3.2 invariant, over the WOULD-BE relation set.
 *
 * The upper bound (at most one active curator) holds for every project, draft
 * ones included — it mirrors the immediate partial unique index, so refusing
 * here turns what would be a 500-shaped constraint fault into the 409 the
 * contract promises.
 *
 * The lower bound (at least one, and an ELIGIBLE one) applies to a PUBLISHED
 * project only: a draft project legitimately has no curator yet, and demanding
 * one would make the first `create` impossible.
 */
function assertCuratorInvariant(
  project: ProjectLifecycle,
  next: readonly RelationSlot[],
  eligibility: ReadonlyMap<string, boolean>,
): void {
  const curators = next.filter(
    (row) => row.status === "active" && row.role === "curator",
  );
  if (curators.length > 1) {
    throw new TaxonomyError(
      "RELATIONSHIP_CONFLICT",
      "this project already has an active curator; hand the seat over with POST /v1/admin/projects/:id/replace-curator",
    );
  }
  if (project.status !== "published") return;
  if (curators.length === 0) {
    throw new TaxonomyError(
      "PUBLISHED_PROJECT_REQUIRES_CURATOR",
      "a published project must keep exactly one active curator; hand the seat over instead of leaving it empty",
    );
  }
  if (eligibility.get(curators[0]!.expertId) !== true) {
    throw new TaxonomyError(
      "PUBLISHED_PROJECT_REQUIRES_CURATOR",
      "the curator of a published project must be a published, non-retired expert",
    );
  }
}

function assertVersion(row: ProjectExpert, expected: number): void {
  if (row.version !== expected) throw stale();
}

function stale(): TaxonomyError {
  return new TaxonomyError(
    "PRECONDITION_FAILED",
    "the relation changed since it was read; reload and retry",
  );
}

/** The admin projection of one relation — both endpoints' display forms inline. */
function toDetail(row: ProjectExpertRow): ProjectExpertAdminDetail {
  return {
    id: row.relation.id,
    projectId: row.project.id,
    projectTitle: row.project.title,
    projectSlug: row.project.slug,
    expertId: row.expert.id,
    // Null on an editorially removed expert (§2.4) — the admin renders its own
    // fixed label rather than the API storing a sentinel string.
    expertName: row.expert.name,
    expertSlug: row.expert.slug,
    role: row.relation.role,
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
 * The two order tuples, as SHAPES rather than casts. A cursor is caller-supplied
 * bytes on a ZERO-AUTH route, so "decodes to an object" is not enough: the
 * decoded values become SQL operands, and an `id` that is not a UUID reaches a
 * `uuid` column as Postgres `22P02` — a 500 for what EARS-16 contracts as 400.
 */
const EXPERT_CURSOR_SHAPE = z
  .object({ name: z.string(), id: z.uuid() })
  .strict();
const PROJECT_CURSOR_SHAPE = z
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
