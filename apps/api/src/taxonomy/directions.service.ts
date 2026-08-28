import { Inject, Injectable } from "@nestjs/common";
import type { Direction } from "@ds/db";
import {
  type AdminTaxonomyListQuery,
  type CreateDirectionRequest,
  slugifyTaxonomyTitle,
  SlugSchema,
  TAXONOMY_SLUG_ATTEMPT_LIMIT,
  taxonomySlugCandidate,
  taxonomyETag,
  type DirectionAdminDetail,
  type DirectionAdminList,
  type UpdateDirectionRequest,
} from "@ds/schemas";
import type {
  LifecycleImpact,
  LifecycleImpactRow,
  TaxonomyLifecycleTransition,
} from "@ds/schemas";
import {
  type DirectionIncidentRelation,
  DirectionsRepository,
} from "./directions.repository.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import {
  type LifecycleImpactBinding,
  LifecycleImpactService,
  type LifecycleImpactTuple,
} from "./lifecycle-impact.service.js";
import {
  markReplayable,
  TaxonomyError,
  withSerializationAbortMapping,
} from "./taxonomy.errors.js";

// 012 EARS-3 (#1285) — the curated direction authoring commands. The same §5.1
// failure ORDER the project and expert verticals established, minus the media
// stages this entity has none of:
//
//   auth (guard) → key shape → fingerprint binding → domain transaction
//   (precondition recheck → write → audit → fenced record completion).
//
// A direction is a first-class retained record, never a free-form event tag: this
// service is the ONLY way a `directions` row comes into existence, so there is no
// inline creation path from an event form and no per-event string that could
// become a second spelling of the same subject. Classifying an event is the
// separate `event_directions` link of #1293.
//
// There is deliberately no publish-requirement check here as the sibling
// verticals have: `title` is NOT NULL in the schema and the PATCH contract
// refuses a null one, so a direction can never be edited into an incomplete public
// projection — §5.2's `PublicDirection` is exactly `{ id, slug, title }`.

export interface CreateDirectionInput {
  payload: CreateDirectionRequest;
  lease: IdempotencyLease;
}

export interface UpdateDirectionInput {
  id: string;
  payload: UpdateDirectionRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** A command result plus the ETag the client must echo on its next write. */
export interface DirectionCommandResult {
  detail: DirectionAdminDetail;
  etag: string;
}

/** `POST /v1/admin/directions/:id/publish` — no impact envelope (see below). */
export interface PublishDirectionInput {
  id: string;
  expectedVersion: number;
  lease: IdempotencyLease;
}

/** `POST /v1/admin/directions/:id/{retire|restore}` — impact-gated (§3.1). */
export interface DirectionTransitionInput {
  id: string;
  transition: TaxonomyLifecycleTransition;
  expectedVersion: number;
  impactToken: string;
  lease: IdempotencyLease;
}

/** The §3.1 target kind this vertical previews and binds envelopes against. */
const TARGET_KIND = "direction" as const;

@Injectable()
export class DirectionsService {
  // Explicit @Inject tokens on every dependency, class ones included — the
  // root-level `endpoint-authz` gate boots this module graph under `tsx`, whose
  // esbuild transform emits no `design:paramtypes`, so a type-inferred injection
  // resolves to `undefined` there while working fine under `nest build`.
  constructor(
    @Inject(DirectionsRepository) private readonly repo: DirectionsRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(LifecycleImpactService)
    private readonly impact: LifecycleImpactService,
  ) {}

  /** `POST /v1/admin/directions/:id/publish` — put the draft on the public surface. */
  publish(input: PublishDirectionInput): Promise<DirectionCommandResult> {
    return this.fenced(input.lease, () => this.publishCommand(input));
  }

  /** `POST /v1/admin/directions/:id/{retire|restore}` — the §3.1 gated pair. */
  transition(input: DirectionTransitionInput): Promise<DirectionCommandResult> {
    return this.fenced(input.lease, () => this.transitionCommand(input));
  }

  /**
   * `GET /v1/admin/directions/:id/lifecycle-impact?transition=` (§3.1) — what
   * the transition would change, plus the signed envelope authorizing exactly
   * THIS transition against exactly this discovered set.
   */
  async lifecycleImpact(
    id: string,
    transition: TaxonomyLifecycleTransition,
  ): Promise<LifecycleImpact> {
    const target = await this.repo.findById(id);
    if (!target) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    assertLifecycleTransitionApplies(target.status, transition);

    const incident = await this.repo.discoverIncidentAnywhere(id);

    return {
      transition,
      version: target.version,
      affected: affectedRows(incident),
      impactToken: this.impact.issue({
        transition,
        targetKind: TARGET_KIND,
        targetId: target.id,
        targetVersion: target.version,
        fingerprint: this.impact.fingerprint(fingerprintTuples(incident)),
      }),
    };
  }

  /** `POST /v1/admin/directions` — create one draft direction. */
  create(input: CreateDirectionInput): Promise<DirectionCommandResult> {
    return this.fenced(input.lease, () => this.createCommand(input));
  }

  /** `PATCH /v1/admin/directions/:id` — edit the SAME row. */
  update(input: UpdateDirectionInput): Promise<DirectionCommandResult> {
    return this.fenced(input.lease, () => this.updateCommand(input));
  }

  /**
   * Run a command that already reserved an idempotency record and tag any
   * DETERMINISTIC refusal with that record, so the problem filter fenced-stores
   * the outcome and an exact retry replays it (§6 bullet 3 / EARS-17).
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
    input: CreateDirectionInput,
  ): Promise<DirectionCommandResult> {
    const base = this.deriveBaseSlug(input.payload.title);

    const row = await this.repo.transaction(async (tx) => {
      // The address is DERIVED, so a taken candidate is not a refusal the
      // operator could act on — they never chose it. Walk the deterministic
      // candidate sequence inside the transaction. The sequence lock makes
      // concurrent allocators wait, and the unique index remains the final
      // integrity guard, instead of leaking a race as an opaque 500.
      await this.repo.lockSlugSequence(tx, base);
      const slug = await this.resolveFreeSlug(tx, base);
      const created = await this.repo.insert(tx, {
        slug,
        title: input.payload.title,
      });
      await this.idempotency.complete(tx, input.lease, {
        status: 201,
        body: toDetail(created),
        etag: taxonomyETag(created.version),
        location: `/v1/admin/directions/${created.id}`,
      });
      return created;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  private async updateCommand(
    input: UpdateDirectionInput,
  ): Promise<DirectionCommandResult> {
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    if (current.version !== input.expectedVersion) {
      throw new TaxonomyError(
        "PRECONDITION_FAILED",
        "the direction changed since it was read; reload and retry",
      );
    }

    const row = await this.repo.transaction(async (tx) => {
      // Re-read under the row lock: everything above was optimistic.
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the direction changed since it was read; reload and retry",
        );
      }
      let derivedSlug: string | undefined;
      if (
        input.payload.title !== undefined &&
        locked.firstPublishedAt === null
      ) {
        const base = this.deriveBaseSlug(input.payload.title);
        await this.repo.lockSlugSequence(tx, base);
        derivedSlug = await this.resolveFreeSlug(tx, base, locked.id);
      }
      const updated = await this.repo.updateVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
          ...(input.payload.title !== undefined
            ? { title: input.payload.title }
            : {}),
          ...(derivedSlug !== undefined ? { slug: derivedSlug } : {}),
        },
      );
      if (!updated) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the direction changed since it was read; reload and retry",
        );
      }
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(updated),
        etag: taxonomyETag(updated.version),
      });
      return updated;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  /**
   * `draft → published`, with `first_published_at` stamped ONCE (LD-3).
   *
   * Deliberately WITHOUT the §3.1 impact envelope: the preview gate exists so an
   * operator sees what a transition WITHDRAWS from the public surface, and a
   * publish withdraws nothing — it only adds. 012 EARS-13/14 scope the gate to
   * retire and restore for exactly that reason, and a mandatory 428 on a purely
   * additive move would be ceremony, not a safeguard.
   *
   * There is no publish-requirements check to run: `title` is NOT NULL and the
   * PATCH contract refuses a null one, so a direction is never editable into an
   * incomplete public projection (§5.2's `PublicDirection` is `{ id, slug, title }`).
   */
  private async publishCommand(
    input: PublishDirectionInput,
  ): Promise<DirectionCommandResult> {
    const current = await this.repo.findById(input.id);
    if (!current) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    const row = await this.repo.transaction(async (tx) => {
      const locked = await this.repo.lockById(tx, input.id);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the direction changed since it was read; reload and retry",
        );
      }
      if (locked.status !== "draft") {
        throw new TaxonomyError(
          "INVALID_TRANSITION",
          locked.status === "published"
            ? "this direction is already published"
            : "this direction is retired; restore it before publishing it again",
        );
      }

      const moved = await this.repo.transitionVersioned(
        tx,
        input.id,
        input.expectedVersion,
        {
          status: "published",
          deletedAt: null,
          // Set ONCE and never re-stamped: a republished direction keeps the
          // date it first became public, which is what pins its slug (LD-3).
          ...(locked.firstPublishedAt ? {} : { firstPublishedAt: new Date() }),
        },
      );
      if (!moved) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the direction changed since it was read; reload and retry",
        );
      }
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body: toDetail(moved),
        etag: taxonomyETag(moved.version),
      });
      return moved;
    });

    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  private async transitionCommand(
    input: DirectionTransitionInput,
  ): Promise<DirectionCommandResult> {
    // Optimistic pre-flight OUTSIDE the transaction: a doomed request never
    // opens a SERIALIZABLE one. The authoritative checks all repeat inside.
    const preflight = await this.repo.findById(input.id);
    if (!preflight) throw new TaxonomyError("RESOURCE_NOT_FOUND");

    // LD-1: a SERIALIZABLE abort is a stale confirmation, not a server fault —
    // mapped to the same 412 as every other stale mode, never auto-retried.
    const row = await withSerializationAbortMapping(() =>
      this.repo.serializableTransaction(async (tx) => {
        const locked = await this.repo.lockById(tx, input.id);
        if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
        if (locked.version !== input.expectedVersion) {
          throw new TaxonomyError(
            "PRECONDITION_FAILED",
            "the direction changed since it was read; reload and retry",
          );
        }
        assertLifecycleTransitionApplies(locked.status, input.transition);

        // Recompute the fingerprint under the lock and verify the envelope
        // against it: a join created, retired or restored since the preview, or
        // a neighbouring direction whose status moved, changes the digest and
        // makes the confirmation stale. Verification runs BEFORE any write, so
        // a stale token leaves zero domain and zero audit mutation.
        const incident = await this.repo.discoverIncident(tx, input.id);
        const expected: LifecycleImpactBinding = {
          transition: input.transition,
          targetKind: TARGET_KIND,
          targetId: locked.id,
          targetVersion: locked.version,
          fingerprint: this.impact.fingerprint(fingerprintTuples(incident)),
        };
        this.impact.verify(input.impactToken, expected);

        const moved = await this.repo.transitionVersioned(
          tx,
          input.id,
          input.expectedVersion,
          input.transition === "retire"
            ? { status: "retired", deletedAt: new Date() }
            : // §102: an ordinary restore returns an entity to `draft` — never
              // straight back to `published`. Re-publishing is a separate,
              // deliberate act, and `first_published_at` is left untouched.
              { status: "draft", deletedAt: null },
        );
        if (!moved) {
          throw new TaxonomyError(
            "PRECONDITION_FAILED",
            "the direction changed since it was read; reload and retry",
          );
        }
        await this.idempotency.complete(tx, input.lease, {
          status: 200,
          body: toDetail(moved),
          etag: taxonomyETag(moved.version),
        });
        return moved;
      }),
    );

    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  /** `GET /v1/admin/directions/:id` — detail by stable id, retired rows included. */
  async detail(id: string): Promise<DirectionCommandResult> {
    const row = await this.repo.findById(id);
    if (!row) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return { detail: toDetail(row), etag: taxonomyETag(row.version) };
  }

  /** `GET /v1/admin/directions` — the shared admin list with LD-6 title search. */
  async list(query: AdminTaxonomyListQuery): Promise<DirectionAdminList> {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        status: row.status,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Fold the authored Russian title into the base address.
   *
   * A title that yields nothing sluggable at all (only emoji, only punctuation)
   * is refused against `title`, the field the operator actually typed — there is
   * no `slug` input left to point them at, and inventing an identity for a
   * permanent public URL is worse than asking for a real title.
   */
  private deriveBaseSlug(title: string): string {
    const parsed = SlugSchema.safeParse(slugifyTaxonomyTitle(title));
    if (!parsed.success) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "the title yields no usable page address; use a title with letters or digits",
        [{ path: "title", message: "yields no usable page address" }],
      );
    }
    return parsed.data;
  }

  /**
   * The first candidate in the derived sequence that no retained row holds.
   * Bounded: fifty directions folding to one address is a data problem, not a
   * collision, and a create must never become an unbounded scan.
   */
  private async resolveFreeSlug(
    tx: Parameters<Parameters<DirectionsRepository["transaction"]>[0]>[0],
    base: string,
    exceptId?: string,
  ): Promise<string> {
    for (
      let attempt = 1;
      attempt <= TAXONOMY_SLUG_ATTEMPT_LIMIT;
      attempt += 1
    ) {
      const candidate = taxonomySlugCandidate(base, attempt);
      if (!(await this.repo.slugTaken(tx, candidate, exceptId)))
        return candidate;
    }
    throw new TaxonomyError(
      "SLUG_CONFLICT",
      "too many directions already derive this page address; give this one a more specific title",
    );
  }
}

/**
 * An entity has THREE states, so which transition applies depends on where the
 * row is: `draft | published → retire`, `retired → restore` (§102). Asking for
 * the one that does not apply is not a no-op to swallow — the operator is
 * looking at a stale screen, and 409 `INVALID_TRANSITION` says so.
 */
export function assertLifecycleTransitionApplies(
  status: "draft" | "published" | "retired",
  transition: TaxonomyLifecycleTransition,
): void {
  const applies =
    transition === "retire" ? status !== "retired" : status === "retired";
  if (applies) return;
  throw new TaxonomyError(
    "INVALID_TRANSITION",
    transition === "retire"
      ? "this direction is already retired"
      : "this direction is not retired, so there is nothing to restore",
  );
}

/**
 * What the operator is SHOWN (§3.1): the joins that resolve today and therefore
 * stop (or start) resolving because of this transition. A retired join is not
 * listed — it is already withdrawn, so naming it would overstate the change —
 * but it IS covered by the fingerprint below, so a join restored between preview
 * and confirmation still invalidates the envelope.
 */
function affectedRows(
  incident: readonly DirectionIncidentRelation[],
): LifecycleImpactRow[] {
  return incident
    .filter((relation) => relation.status === "active")
    .map((relation) => ({
      kind: relation.kind,
      id: relation.id,
      title: relation.title,
      // A join has no address of its own — the dialog renders «не задан».
      slug: null,
      status: relation.status,
    }));
}

/** The canonical fingerprint input — EVERY incident join, retired ones included. */
function fingerprintTuples(
  incident: readonly DirectionIncidentRelation[],
): LifecycleImpactTuple[] {
  return incident.map((relation) => ({
    kind: relation.kind,
    id: relation.id,
    version: relation.version,
    state: relation.status,
    eligibility: relation.eligibility,
  }));
}

/**
 * The admin projection. Synchronous — unlike a project or an expert there is no
 * storage key to resolve into a signed URL, because a direction has no media.
 */
function toDetail(row: Direction): DirectionAdminDetail {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
