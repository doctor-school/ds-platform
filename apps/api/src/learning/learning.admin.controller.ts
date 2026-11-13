import { createHash } from "node:crypto";
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  ApplyLearningPresetRequestSchema,
  CANONICAL_UUID_REGEX,
  CreateLearningCourseRequestSchema,
  CreateLearningLessonRequestSchema,
  CreateLearningModuleRequestSchema,
  CreateLearningSchoolRequestSchema,
  CreateLearningStepRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  LEARNING_STEP_MEDIA_PART,
  LearningScopeKindSchema,
  parseIfMatchVersion,
  ReorderLearningStepsRequestSchema,
  SetLearningStepSourceRequestSchema,
  UpdateLearningLessonRequestSchema,
  UpdateLearningStepRequestSchema,
  type LearningScopeKind,
} from "@ds/schemas";
import {
  LearningAdminService,
  type LearningCommandResult,
  type LearningComplete,
} from "@ds/learning/server";
import type { z } from "zod";
import { Authz } from "../authz/index.js";
import type { Role } from "../authz/authz.types.js";
import { ObjectAlreadyExistsError } from "../storage/storage.types.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/storage.types.js";
import { MediaCleanupService } from "../taxonomy/index.js";
import {
  type IdempotencyLease,
  type IdempotencyOutcome,
  IdempotencyService,
} from "../taxonomy/idempotency.service.js";
import { TaxonomyError } from "../taxonomy/taxonomy.errors.js";
import { adminCommand, LearningProblemFilter } from "./learning.errors.js";

// 024 EARS-1, EARS-4, EARS-9, EARS-28, EARS-29 (#4011) — the learning admin
// surface (024-design §7). The 012 admin contract, reused: feature 011's MFA
// admin session + CSRF, `platform_admin` before validation, idempotency on every
// write, `If-Match` on every write after a create, RFC 7807 problems. The
// `learning_rules_editor` staff role is slice 2 (047 «Доступы»).

const SCOPE = "learning.admin";
const BASE = "/v1/admin/learning";

const ADMIN = {
  access: "authenticated" as const,
  roles: ["platform_admin"] as Role[],
  check: "fast-path" as const,
};
const READ = { ...ADMIN, audit: "none" as const };
const WRITE = {
  ...ADMIN,
  revalidate: "live" as const,
  audit: "low-stakes" as const,
};

interface Command {
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  /** The route template (the idempotency record's route). */
  route: string;
  /** The concrete path (the fingerprint's path). */
  path: string;
  payload: unknown;
  /** Required for every write after a create (412/428 otherwise). */
  versioned: boolean;
  /** The rules layer starts at version 0 (no row yet). */
  allowZero?: boolean;
}

@Controller({ path: "admin/learning", version: "1" })
@UseFilters(LearningProblemFilter)
export class LearningAdminController {
  private readonly logger = new Logger(LearningAdminController.name);

  constructor(
    @Inject(LearningAdminService) private readonly admin: LearningAdminService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MediaCleanupService) private readonly cleanup: MediaCleanupService,
  ) {}

  // ── Schools and courses (EARS-1) ──────────────────────────────────────────

  @Get("schools")
  @Authz({ ...READ, tests: ["EARS-1"] })
  async schools(): Promise<unknown> {
    return { data: await adminCommand(() => this.admin.listSchools()) };
  }

  @Post("schools")
  @HttpCode(201)
  @Authz({ ...WRITE, tests: ["EARS-1"] })
  createSchool(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const payload = parse(CreateLearningSchoolRequestSchema, readJson(req));
    return this.run(
      req,
      reply,
      { method: "POST", route: `${BASE}/schools`, path: `${BASE}/schools`, payload, versioned: false },
      (_v, complete) => this.admin.createSchool(payload, complete),
    );
  }

  @Get("courses")
  @Authz({ ...READ, tests: ["EARS-1"] })
  async courses(@Query("schoolId") schoolId?: string): Promise<unknown> {
    if (schoolId !== undefined) requireUuid(schoolId);
    return { data: await adminCommand(() => this.admin.listCourses(schoolId)) };
  }

  @Post("courses")
  @HttpCode(201)
  @Authz({ ...WRITE, tests: ["EARS-1"] })
  createCourse(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const payload = parse(CreateLearningCourseRequestSchema, readJson(req));
    return this.run(
      req,
      reply,
      { method: "POST", route: `${BASE}/courses`, path: `${BASE}/courses`, payload, versioned: false },
      (_v, complete) => this.admin.createCourse(payload, complete),
    );
  }

  @Get("courses/:id")
  @Authz({ ...READ, tests: ["EARS-1", "EARS-28"] })
  async course(
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const { body, etag } = await adminCommand(() =>
      this.admin.courseComposition(id),
    );
    void reply.header("etag", etag);
    return body;
  }

  @Post("courses/:id/publish")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-4"] })
  publishCourse(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.courseState(id, "published", req, reply);
  }

  @Post("courses/:id/unpublish")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-4"] })
  unpublishCourse(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.courseState(id, "draft", req, reply);
  }

  private courseState(
    id: string,
    state: "draft" | "published",
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const verb = state === "published" ? "publish" : "unpublish";
    return this.run(
      req,
      reply,
      { method: "POST", route: `${BASE}/courses/:id/${verb}`, path: `${BASE}/courses/${id}/${verb}`, payload: {}, versioned: true },
      (v, complete) => this.admin.setCourseState(id, state, v, complete),
    );
  }

  // ── Modules and lessons (EARS-1, EARS-4, EARS-28) ─────────────────────────

  @Post("modules")
  @HttpCode(201)
  @Authz({ ...WRITE, tests: ["EARS-1", "EARS-28"] })
  createModule(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const payload = parse(CreateLearningModuleRequestSchema, readJson(req));
    return this.run(
      req,
      reply,
      { method: "POST", route: `${BASE}/modules`, path: `${BASE}/modules`, payload, versioned: false },
      (_v, complete) => this.admin.createModule(payload, complete),
    );
  }

  @Post("lessons")
  @HttpCode(201)
  @Authz({ ...WRITE, tests: ["EARS-1", "EARS-28"] })
  createLesson(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const payload = parse(CreateLearningLessonRequestSchema, readJson(req));
    return this.run(
      req,
      reply,
      { method: "POST", route: `${BASE}/lessons`, path: `${BASE}/lessons`, payload, versioned: false },
      (_v, complete) => this.admin.createLesson(payload, complete),
    );
  }

  @Get("lessons/:id")
  @Authz({ ...READ, tests: ["EARS-28"] })
  async lesson(
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const { body, etag } = await adminCommand(() => this.admin.lesson(id));
    void reply.header("etag", etag);
    return body;
  }

  @Patch("lessons/:id")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-28"] })
  updateLesson(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const payload = parse(UpdateLearningLessonRequestSchema, readJson(req));
    return this.run(
      req,
      reply,
      { method: "PATCH", route: `${BASE}/lessons/:id`, path: `${BASE}/lessons/${id}`, payload, versioned: true },
      (v, complete) => this.admin.updateLesson(id, payload, v, complete),
    );
  }

  @Post("lessons/:id/publish")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-4"] })
  publishLesson(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.lessonState(id, "published", req, reply);
  }

  @Post("lessons/:id/unpublish")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-4"] })
  unpublishLesson(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.lessonState(id, "draft", req, reply);
  }

  private lessonState(
    id: string,
    state: "draft" | "published",
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const verb = state === "published" ? "publish" : "unpublish";
    return this.run(
      req,
      reply,
      { method: "POST", route: `${BASE}/lessons/:id/${verb}`, path: `${BASE}/lessons/${id}/${verb}`, payload: {}, versioned: true },
      (v, complete) => this.admin.setLessonState(id, state, v, complete),
    );
  }

  /** EARS-28 — the lesson's steps in a new order, under the lesson's `If-Match`. */
  @Put("lessons/:id/step-order")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-28"] })
  reorderSteps(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const payload = parse(ReorderLearningStepsRequestSchema, readJson(req));
    return this.run(
      req,
      reply,
      { method: "PUT", route: `${BASE}/lessons/:id/step-order`, path: `${BASE}/lessons/${id}/step-order`, payload, versioned: true },
      (v, complete) =>
        this.admin.reorderSteps(id, payload.stepIds, v, complete),
    );
  }

  // ── Steps (EARS-2, EARS-28) ───────────────────────────────────────────────

  @Post("steps")
  @HttpCode(201)
  @Authz({ ...WRITE, tests: ["EARS-2", "EARS-28"] })
  createStep(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const payload = parse(CreateLearningStepRequestSchema, readJson(req));
    return this.run(
      req,
      reply,
      { method: "POST", route: `${BASE}/steps`, path: `${BASE}/steps`, payload, versioned: false },
      (_v, complete) => this.admin.createStep(payload, complete),
    );
  }

  @Patch("steps/:id")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-2", "EARS-28"] })
  updateStep(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const payload = parse(UpdateLearningStepRequestSchema, readJson(req));
    return this.run(
      req,
      reply,
      { method: "PATCH", route: `${BASE}/steps/:id`, path: `${BASE}/steps/${id}`, payload, versioned: true },
      (v, complete) => this.admin.updateStep(id, payload, v, complete),
    );
  }

  @Delete("steps/:id")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-28"] })
  removeStep(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    return this.run(
      req,
      reply,
      { method: "DELETE", route: `${BASE}/steps/:id`, path: `${BASE}/steps/${id}`, payload: {}, versioned: true },
      (v, complete) => this.admin.removeStep(id, v, complete),
    );
  }

  /** EARS-28 — a `video` step's source: the 006 provider abstraction, as a 014 recording. */
  @Put("steps/:id/source")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-4", "EARS-28"] })
  setStepSource(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const payload = parse(SetLearningStepSourceRequestSchema, readJson(req));
    return this.run(
      req,
      reply,
      { method: "PUT", route: `${BASE}/steps/:id/source`, path: `${BASE}/steps/${id}/source`, payload, versioned: true },
      (v, complete) => this.admin.setStepSource(id, payload, v, complete),
    );
  }

  /**
   * EARS-28 — a `download` step's file through the 012 upload pipeline:
   * multipart, one `file` part; the type's catalog rule bounds its content
   * type and size; stored write-once under a server-generated key; the
   * replaced object is queued for cleanup in the same transaction.
   */
  @Put("steps/:id/media")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-4", "EARS-28"] })
  async setStepMedia(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireUuid(id);
    const file = await readMediaPart(req);
    const { media } = await adminCommand(() => this.admin.mediaRuleOf(id));
    if (!media.contentTypes.includes(file.contentType)) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        `this step accepts ${media.contentTypes.join(", ")}`,
      );
    }
    if (file.body.length > media.maxBytes) {
      throw new TaxonomyError(
        "MEDIA_INVALID",
        `the file exceeds the ${media.maxBytes}-byte limit`,
      );
    }
    const sha256 = createHash("sha256").update(file.body).digest("hex");
    return this.run(
      req,
      reply,
      { method: "PUT", route: `${BASE}/steps/:id/media`, path: `${BASE}/steps/${id}/media`, payload: { sha256, contentType: file.contentType }, versioned: true },
      async (v, complete, lease) => {
        const key = await this.upload(lease, file, sha256);
        return this.admin.setStepMedia(
          id,
          { ref: key, contentType: file.contentType, sizeBytes: file.body.length },
          v,
          (tx, objectKey) =>
            this.cleanup
              .enqueue(tx, {
                cleanupKind: "replace",
                entityKind: "learning_step",
                entityId: id,
                slot: "file",
                objectKey,
              })
              .then(() => undefined),
          complete,
        );
      },
    );
  }

  private async upload(
    lease: IdempotencyLease,
    file: StepFile,
    sha256: string,
  ): Promise<string> {
    const key = this.idempotency.objectKeyFor({
      lease,
      prefix: "learning/steps",
      canonicalSha256: sha256,
      extension: extensionOf(file),
    });
    // Record the locator BEFORE the PUT: an orphan we know about is reclaimable.
    await this.idempotency.noteUploadLocator(lease, key);
    try {
      await this.storage.put({
        key,
        body: file.body,
        contentType: file.contentType,
        onlyIfAbsent: true,
      });
    } catch (err) {
      if (err instanceof ObjectAlreadyExistsError) return key;
      this.logger.error(
        `object storage refused the step file PUT: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new TaxonomyError(
        "MEDIA_STORAGE_UNAVAILABLE",
        "the file could not be stored; no step data changed",
      );
    }
    return key;
  }

  // ── Rules and presets (EARS-5, EARS-9, EARS-29) ───────────────────────────

  @Get("presets")
  @Authz({ ...READ, tests: ["EARS-9", "EARS-29"] })
  async presets(): Promise<unknown> {
    return { data: await adminCommand(() => this.admin.presets()) };
  }

  @Get("rules/:scopeKind/:scopeId")
  @Authz({ ...READ, tests: ["EARS-5", "EARS-29"] })
  async rules(
    @Param("scopeKind") rawKind: string,
    @Param("scopeId") scopeId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const kind = scopeKind(rawKind);
    const body = await adminCommand(() => this.admin.scopeRules(kind, scopeId));
    void reply.header("etag", `W/"${body.layerVersion}"`);
    return body;
  }

  @Put("rules/:scopeKind/:scopeId")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-5", "EARS-29"] })
  setRules(
    @Param("scopeKind") rawKind: string,
    @Param("scopeId") scopeId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const kind = scopeKind(rawKind);
    const body = readJson(req) as { values?: unknown } | undefined;
    const payload = { values: body?.values };
    return this.run(
      req,
      reply,
      { method: "PUT", route: `${BASE}/rules/:scopeKind/:scopeId`, path: `${BASE}/rules/${kind}/${scopeId}`, payload, versioned: true, allowZero: true },
      (v, complete) =>
        this.admin.setScopeValues(kind, scopeId, payload.values, v, complete),
    );
  }

  @Post("rules/:scopeKind/:scopeId/apply-preset")
  @HttpCode(200)
  @Authz({ ...WRITE, tests: ["EARS-9", "EARS-29"] })
  applyPreset(
    @Param("scopeKind") rawKind: string,
    @Param("scopeId") scopeId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const kind = scopeKind(rawKind);
    if (kind !== "school" && kind !== "course") {
      throw new TaxonomyError(
        "VALIDATION_FAILED",
        "a preset applies to a school or a course",
        [{ path: "scopeKind", message: "school or course" }],
      );
    }
    const payload = parse(ApplyLearningPresetRequestSchema, readJson(req));
    return this.run(
      req,
      reply,
      { method: "POST", route: `${BASE}/rules/:scopeKind/:scopeId/apply-preset`, path: `${BASE}/rules/${kind}/${scopeId}/apply-preset`, payload, versioned: true, allowZero: true },
      (v, complete) =>
        this.admin.applyPreset(kind, scopeId, payload.presetId, v, complete),
    );
  }

  // ── The shared command envelope (012) ─────────────────────────────────────

  private async run<T>(
    req: FastifyRequest,
    reply: FastifyReply,
    cmd: Command,
    exec: (
      expectedVersion: number,
      complete: LearningComplete,
      lease: IdempotencyLease,
    ) => Promise<LearningCommandResult<T>>,
  ): Promise<unknown> {
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const ifMatch = cmd.versioned
      ? requireVersion(req, cmd.allowZero === true)
      : null;
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: cmd.method,
      route: cmd.route,
      fingerprint: this.idempotency.fingerprint({
        method: cmd.method,
        path: cmd.path,
        payload: cmd.payload,
        ...(ifMatch ? { ifMatch: ifMatch.raw } : {}),
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    const lease = outcome.lease;
    const complete: LearningComplete = (tx, r) =>
      this.idempotency.complete(tx, lease, {
        status: r.status,
        body: r.body,
        etag: r.etag,
        location: r.location ?? null,
      });
    const result = await adminCommand(
      () => exec(ifMatch?.version ?? 0, complete, lease),
      lease,
    );
    void reply.status(result.status);
    void reply.header("etag", result.etag);
    if (result.location) void reply.header("location", result.location);
    return result.body;
  }
}

interface StepFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

/** Exactly one `file` part; every part is drained even when refused. */
async function readMediaPart(req: FastifyRequest): Promise<StepFile> {
  const isMultipart =
    typeof req.isMultipart === "function" && req.isMultipart();
  if (!isMultipart) {
    throw new TaxonomyError(
      "UNSUPPORTED_MEDIA_TYPE",
      `use multipart/form-data with one "${LEARNING_STEP_MEDIA_PART}" part`,
    );
  }
  let file: StepFile | undefined;
  let conflict: string | undefined;
  for await (const part of req.parts()) {
    if (part.type !== "file") continue;
    const body = await part.toBuffer();
    if (part.fieldname !== LEARNING_STEP_MEDIA_PART) {
      conflict ??= `unexpected file part "${part.fieldname}"; a step accepts only "${LEARNING_STEP_MEDIA_PART}"`;
      continue;
    }
    if (file) {
      conflict ??= "more than one file part";
      continue;
    }
    file = { filename: part.filename, contentType: part.mimetype, body };
  }
  if (conflict) throw new TaxonomyError("MEDIA_INPUT_CONFLICT", conflict);
  if (!file) {
    throw new TaxonomyError(
      "UNSUPPORTED_MEDIA_TYPE",
      `the request carries no "${LEARNING_STEP_MEDIA_PART}" part`,
    );
  }
  return file;
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function extensionOf(file: StepFile): string {
  return EXTENSIONS[file.contentType] ?? "bin";
}

function parse<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new TaxonomyError(
      "VALIDATION_FAILED",
      "the request is refused",
      parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
  }
  return parsed.data;
}

function scopeKind(raw: string): LearningScopeKind {
  const parsed = LearningScopeKindSchema.safeParse(raw);
  if (!parsed.success) throw new TaxonomyError("RESOURCE_NOT_FOUND");
  return parsed.data;
}

function requireUuid(id: string): void {
  if (!CANONICAL_UUID_REGEX.test(id)) {
    throw new TaxonomyError("RESOURCE_NOT_FOUND");
  }
}

function requireVersion(
  req: FastifyRequest,
  allowZero: boolean,
): { raw: string; version: number } {
  const raw = req.headers[IF_MATCH_HEADER] as string | undefined;
  if (!raw || raw.trim().length === 0) {
    throw new TaxonomyError(
      "PRECONDITION_REQUIRED",
      "a change must carry the If-Match of the version it was read at",
    );
  }
  // A rules layer with no row yet reads as version 0.
  if (allowZero && /^(?:W\/)?"?0"?$/.test(raw.trim())) return { raw, version: 0 };
  const version = parseIfMatchVersion(raw);
  if (version === null) {
    throw new TaxonomyError(
      "PRECONDITION_FAILED",
      "the If-Match validator is not one this API issued",
    );
  }
  return { raw, version };
}

function readJson(req: FastifyRequest): unknown {
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType && !contentType.includes("application/json")) {
    throw new TaxonomyError(
      "UNSUPPORTED_MEDIA_TYPE",
      "use application/json",
    );
  }
  return req.body;
}

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

function actorSub(req: FastifyRequest): string | null {
  return (req as { user?: { sub?: string } }).user?.sub ?? null;
}
