import { Inject, Injectable } from "@nestjs/common";
import {
  type ProjectResults,
  type ReplaceProjectResultsRequest,
  taxonomyETag,
} from "@ds/schemas";
import {
  doctorStorefrontOrigin,
  isOnStorefrontOrigin,
} from "./doctor-storefront-origin.js";
import {
  type IdempotencyLease,
  IdempotencyService,
} from "./idempotency.service.js";
import { ProjectOutputKindsRepository } from "./project-output-kinds.repository.js";
import {
  type ProjectResultWithKind,
  ProjectResultsRepository,
} from "./project-results.repository.js";
import { ProjectsRepository } from "./projects.repository.js";
import {
  markReplayable,
  TaxonomyError,
  type TaxonomyFieldError,
} from "./taxonomy.errors.js";

// 030 EARS-2 / EARS-6 (#3503) — a project's results, replaced as ONE ordered set
// under the project's `If-Match` (the 032 role-set pattern). Lock order: the
// project row (`FOR UPDATE`), then the named kinds (`FOR SHARE`, ascending id) —
// the mirror of a kind retire, which locks the kind and then reads its holders,
// so a retire and a save that adds the kind serialize (030-design §Data model).
//
// Refusals, all field-addressed under `results.<i>.<field>` and changing nothing:
// an unknown kind; a retired kind the project's results did not already hold
// (a held one stays, shown «Вид снят»); a storefront link off the configured
// doctor-storefront origin. Emptying the results of a PUBLISHED project is
// `409 PUBLISH_REQUIREMENTS_NOT_MET` (EARS-6).

export interface ReplaceProjectResultsInput {
  projectId: string;
  payload: ReplaceProjectResultsRequest;
  expectedVersion: number;
  lease: IdempotencyLease;
}

export interface ProjectResultsCommandResult {
  body: ProjectResults;
  etag: string;
}

@Injectable()
export class ProjectResultsService {
  constructor(
    @Inject(ProjectsRepository) private readonly projects: ProjectsRepository,
    @Inject(ProjectResultsRepository)
    private readonly results: ProjectResultsRepository,
    @Inject(ProjectOutputKindsRepository)
    private readonly kinds: ProjectOutputKindsRepository,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** `GET /v1/admin/projects/:id/results` — the ordered set plus the project ETag. */
  async read(projectId: string): Promise<ProjectResultsCommandResult> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    const rows = await this.results.listForProject(projectId);
    return {
      body: toBody(rows, project.version),
      etag: taxonomyETag(project.version),
    };
  }

  /** `PUT /v1/admin/projects/:id/results` — replace the set. */
  async replace(
    input: ReplaceProjectResultsInput,
  ): Promise<ProjectResultsCommandResult> {
    try {
      return await this.replaceCommand(input);
    } catch (err) {
      throw markReplayable(err, input.lease);
    }
  }

  private async replaceCommand(
    input: ReplaceProjectResultsInput,
  ): Promise<ProjectResultsCommandResult> {
    const { results } = input.payload;
    return this.projects.transaction(async (tx) => {
      const locked = await this.projects.lockById(tx, input.projectId);
      if (!locked) throw new TaxonomyError("RESOURCE_NOT_FOUND");
      if (locked.version !== input.expectedVersion) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the project changed since it was read; reload and retry",
        );
      }

      const current = await this.results.listForProject(input.projectId, tx);
      const held = new Set(current.map((r) => r.outputKindId));
      const named = [...new Set(results.map((r) => r.outputKindId))].sort();
      const kinds = new Map(
        (await this.kinds.shareLockByIds(tx, named)).map((k) => [k.id, k]),
      );

      const errors: TaxonomyFieldError[] = [];
      let origin: string | null = null;
      results.forEach((result, index) => {
        const kind = kinds.get(result.outputKindId);
        if (!kind) {
          errors.push({
            path: `results.${index}.outputKindId`,
            message: "unknown output kind",
          });
        } else if (kind.status === "retired" && !held.has(kind.id)) {
          errors.push({
            path: `results.${index}.outputKindId`,
            message: "this output kind is retired («Вид снят»)",
          });
        }
        if (result.storefrontUrl) {
          origin ??= doctorStorefrontOrigin();
          if (!isOnStorefrontOrigin(result.storefrontUrl, origin)) {
            errors.push({
              path: `results.${index}.storefrontUrl`,
              message: `the link must lead to the doctor storefront (${new URL(origin).origin})`,
            });
          }
        }
      });
      if (errors.length > 0) {
        throw new TaxonomyError(
          "VALIDATION_FAILED",
          "invalid project results",
          errors,
        );
      }
      if (locked.status === "published" && results.length === 0) {
        throw new TaxonomyError(
          "PUBLISH_REQUIREMENTS_NOT_MET",
          "a published project cannot be left without results",
          [
            {
              path: "results",
              message: "a published project requires at least one result",
            },
          ],
        );
      }

      await this.results.replace(
        tx,
        input.projectId,
        results.map((result, position) => ({
          outputKindId: result.outputKindId,
          position,
          title: result.title,
          description: result.description,
          storefrontUrl: result.storefrontUrl,
        })),
      );
      // One ETag for the form: the set's write bumps the project's version.
      const bumped = await this.projects.updateVersioned(
        tx,
        input.projectId,
        input.expectedVersion,
        {},
      );
      if (!bumped) {
        throw new TaxonomyError(
          "PRECONDITION_FAILED",
          "the project changed since it was read; reload and retry",
        );
      }
      const rows = await this.results.listForProject(input.projectId, tx);
      const body = toBody(rows, bumped.version);
      const etag = taxonomyETag(bumped.version);
      await this.idempotency.complete(tx, input.lease, {
        status: 200,
        body,
        etag,
      });
      return { body, etag };
    });
  }
}

function toBody(rows: ProjectResultWithKind[], version: number): ProjectResults {
  return {
    data: rows.map((row) => ({
      id: row.id,
      position: row.position,
      outputKind: {
        id: row.outputKind.id,
        slug: row.outputKind.slug,
        title: row.outputKind.title,
        status: row.outputKind.status,
      },
      title: row.title,
      description: row.description,
      storefrontUrl: row.storefrontUrl,
    })),
    version,
  };
}
