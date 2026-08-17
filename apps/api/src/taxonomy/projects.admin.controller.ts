import {
  Controller,
  Get,
  Inject,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  AdminTaxonomyListQuerySchema,
  CANONICAL_UUID_REGEX,
  CreateProjectRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  MAX_IMAGE_BYTES,
  parseIfMatchVersion,
  type ProjectAdminList,
  UpdateProjectRequestSchema,
} from "@ds/schemas";
import { Authz } from "../authz/index.js";
import {
  type IdempotencyOutcome,
  IdempotencyService,
} from "./idempotency.service.js";
import { sha256, type UploadedImage } from "./media/still-image-normalizer.js";
import { ProjectsService } from "./projects.service.js";
import { TaxonomyError, TaxonomyProblemFilter } from "./taxonomy.errors.js";

// 012 EARS-1 (#1283) — the project admin surface (012-design §5.1). Authorization
// is feature 011 exactly as 007 has it: the dedicated MFA-verified admin session
// plus CSRF double-submit, and the route guard requires `platform_admin` BEFORE
// validation, idempotency, upload or handler (EARS-16). There is no per-mutation
// live IdP revalidation and no step-up in 012 (§5.3).
//
// The request-shape rules are exact (§5.1): JSON is the canonical no-file shape;
// a binary rides `multipart/form-data` with exactly one `payload` JSON part plus
// at most one `cover` file part. Multipart WITHOUT a file is 415 — it is not a
// synonym for JSON, it is a malformed upload. A file together with
// `mediaAction: "clear"`, several files, or a wrong-named file part is 400
// `MEDIA_INPUT_CONFLICT` *before* any upload, because a request that asks for two
// contradictory things must never be guessed at.

/** The only file part name a project accepts. */
const COVER_PART = "cover";

@Controller({ path: "admin/projects", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class ProjectsAdminController {
  // Explicit @Inject tokens — see the note in `projects.service.ts`: the
  // root-level authz gate boots this graph under `tsx`, which emits no
  // `design:paramtypes`, so type-inferred injection resolves to `undefined`.
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * EARS-15 / §5.1 — the shared admin list: page/pageSize offset pagination,
   * case-insensitive `q`, explicit `status`, and retired rows excluded by
   * default. The same envelope backs #1284–#1286's lists.
   */
  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-1", "EARS-15", "EARS-16"],
  })
  list(@Query() rawQuery: Record<string, string>): Promise<ProjectAdminList> {
    const parsed = AdminTaxonomyListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "invalid list query",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }
    return this.projects.list(parsed.data);
  }

  /**
   * EARS-1 — `POST /v1/admin/projects`. Requires a canonical UUID
   * `Idempotency-Key`, no `If-Match` (there is no prior version to assert).
   * Answers 201 with the detail body, the row's `ETag` and a `Location`.
   */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    // The domain audit row is written by feature 010's capture trigger inside
    // the command transaction (012-design §6), not by an authz-tier emission —
    // so this is the same `low-stakes` AUTH-audit tier as 007's authoring writes.
    audit: "low-stakes",
    tests: ["EARS-1", "EARS-16", "EARS-17"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    // 1. Key shape — before a single file byte is read (§5.1 failure order).
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    // 2. Request shape + payload; the file is buffered but nothing is stored yet.
    const { payload, file } = await this.readAuthoringRequest(req, false);
    const parsed = CreateProjectRequestSchema.safeParse(payload);
    if (!parsed.success) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "invalid project payload",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }
    // 3. Fingerprint binding — before normalization or upload.
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.projects",
      actorId: actorSub(req),
      method: "POST",
      route: "/v1/admin/projects",
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path: "/v1/admin/projects",
        payload: parsed.data,
        fileSha256: file ? sha256(file.body) : null,
        fileBytes: file?.body.length ?? null,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.projects.create({
      payload: parsed.data,
      cover: file,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    void reply.header("location", `/v1/admin/projects/${detail.id}`);
    return detail;
  }

  /** EARS-1 — detail by stable id, retired rows included (§5.1). */
  @Get(":id")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-1", "EARS-16"],
  })
  async detail(
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    // A non-UUID token cannot address an admin row: the admin surface is
    // id-only, slugs belong to the public surface (§5.2).
    if (!CANONICAL_UUID_REGEX.test(id)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const { detail, etag } = await this.projects.detail(id);
    void reply.header("etag", etag);
    return detail;
  }

  /**
   * EARS-1 — `PATCH /v1/admin/projects/:id`. Requires the target `If-Match`
   * (absent is 428 `PRECONDITION_REQUIRED`, stale is 412 `PRECONDITION_FAILED`)
   * plus a canonical UUID `Idempotency-Key`.
   */
  @Patch(":id")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "low-stakes",
    tests: ["EARS-1", "EARS-16", "EARS-17"],
  })
  async update(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    if (!CANONICAL_UUID_REGEX.test(id)) {
      throw new TaxonomyError("RESOURCE_NOT_FOUND");
    }
    const key = this.idempotency.requireKey(req.headers[IDEMPOTENCY_KEY_HEADER]);
    const rawIfMatch = req.headers[IF_MATCH_HEADER] as string | undefined;
    if (!rawIfMatch || rawIfMatch.trim().length === 0) {
      throw new TaxonomyError(
        "PRECONDITION_REQUIRED",
        "an edit must carry the If-Match of the version it was read at",
      );
    }
    const expectedVersion = parseIfMatchVersion(rawIfMatch);
    if (expectedVersion === null) {
      // A syntactically unusable validator asserts nothing, so it cannot pass:
      // treat it as the failed precondition it is, never as "no precondition".
      throw new TaxonomyError(
        "PRECONDITION_FAILED",
        "the If-Match validator is not one this API issued",
      );
    }

    const { payload, file } = await this.readAuthoringRequest(req, true);
    const parsed = UpdateProjectRequestSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "invalid project payload",
        parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      );
    }
    // A file together with an explicit clear is contradictory — refuse before
    // upload rather than silently preferring one of the two.
    if (file && parsed.data.mediaAction === "clear") {
      throw new TaxonomyError(
        "MEDIA_INPUT_CONFLICT",
        "a cover file and mediaAction: \"clear\" cannot be combined",
      );
    }

    const route = "/v1/admin/projects/:id";
    const outcome = await this.idempotency.begin({
      key,
      scope: "taxonomy.projects",
      actorId: actorSub(req),
      method: "PATCH",
      route,
      fingerprint: this.idempotency.fingerprint({
        method: "PATCH",
        path: `/v1/admin/projects/${id}`,
        payload: parsed.data,
        ifMatch: rawIfMatch,
        fileSha256: file ? sha256(file.body) : null,
        fileBytes: file?.body.length ?? null,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;

    const { detail, etag } = await this.projects.update({
      id,
      payload: parsed.data,
      cover: file,
      expectedVersion,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }

  /**
   * Read the exact §5.1 request shape.
   *
   * JSON → the parsed body, no file. Multipart → exactly one `payload` JSON part
   * plus at most one `cover` file; multipart with NO file is 415, and a second
   * file / a wrong part name is 400 `MEDIA_INPUT_CONFLICT`. Every file part is
   * drained even when refused, so a rejected upload cannot leave the connection
   * half-read.
   */
  private async readAuthoringRequest(
    req: FastifyRequest,
    payloadOptional: boolean,
  ): Promise<{ payload: unknown; file?: UploadedImage | undefined }> {
    const isMultipart =
      typeof req.isMultipart === "function" && req.isMultipart();
    if (!isMultipart) {
      const contentType = String(req.headers["content-type"] ?? "");
      if (contentType && !contentType.includes("application/json")) {
        throw new TaxonomyError(
          "UNSUPPORTED_MEDIA_TYPE",
          "use application/json, or multipart/form-data with one payload part and one cover file",
        );
      }
      return { payload: req.body ?? (payloadOptional ? {} : undefined) };
    }

    let payloadRaw: string | undefined;
    let file: UploadedImage | undefined;
    let conflict: string | undefined;
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const body = await part.toBuffer(); // always drained
        if (part.fieldname !== COVER_PART) {
          conflict ??= `unexpected file part "${part.fieldname}"; a project accepts only "${COVER_PART}"`;
          continue;
        }
        if (file) {
          conflict ??= "more than one cover file part";
          continue;
        }
        if (body.length > MAX_IMAGE_BYTES) {
          // Bounded here as well as in the normalizer: the size refusal must not
          // depend on reaching the decoder.
          conflict ??= undefined;
          throw new TaxonomyError(
            "MEDIA_INVALID",
            `the cover exceeds the ${MAX_IMAGE_BYTES}-byte limit`,
          );
        }
        file = {
          fieldname: part.fieldname,
          filename: part.filename,
          contentType: part.mimetype,
          body,
        };
      } else if (part.fieldname === "payload") {
        payloadRaw = String(part.value);
      }
    }
    if (conflict) throw new TaxonomyError("MEDIA_INPUT_CONFLICT", conflict);
    if (!file) {
      throw new TaxonomyError(
        "UNSUPPORTED_MEDIA_TYPE",
        "multipart/form-data without a file part is not a request shape this API accepts; use application/json",
      );
    }
    if (payloadRaw === undefined) {
      if (!payloadOptional) {
        throw new TaxonomyError(
          "VALIDATION_FAILED",
          "the multipart request is missing its payload part",
          [{ path: "payload", message: "required" }],
        );
      }
      return { payload: {}, file };
    }
    try {
      return { payload: JSON.parse(payloadRaw), file };
    } catch {
      throw new TaxonomyError("VALIDATION_FAILED", "payload is not valid JSON", [
        { path: "payload", message: "must be valid JSON" },
      ]);
    }
  }
}

/**
 * Replay a completed record's stored outcome verbatim (§6): the exact status,
 * body and allow-listed `ETag`/`Location`. Returns `true` when the caller must
 * return the stored body instead of running the command again.
 */
function replayed(
  outcome: IdempotencyOutcome,
  reply: FastifyReply,
): outcome is Extract<IdempotencyOutcome, { kind: "replay" }> {
  if (outcome.kind !== "replay") return false;
  void reply.status(outcome.replay.status);
  if (outcome.replay.etag) void reply.header("etag", outcome.replay.etag);
  if (outcome.replay.location) {
    void reply.header("location", outcome.replay.location);
  }
  return true;
}

/** The acting admin's subject — the actor half of the record's identity binding. */
function actorSub(req: FastifyRequest): string | null {
  return (req as { user?: { sub?: string } }).user?.sub ?? null;
}
