import {
  Controller,
  Get,
  HttpCode,
  Inject,
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
  AdminMaterialListQuerySchema,
  CANONICAL_UUID_REGEX,
  CreateMaterialRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IF_MATCH_HEADER,
  MAX_IMAGE_BYTES,
  type MaterialAdminList,
  parseIfMatchVersion,
  UpdateMaterialRequestSchema,
} from "@ds/schemas";
import type { ZodError } from "zod";
import { Authz } from "../authz/index.js";
import {
  IdempotencyService,
  TaxonomyError,
  TaxonomyProblemFilter,
} from "../taxonomy/index.js";
import type { IdempotencyOutcome } from "../taxonomy/idempotency.service.js";
import {
  sha256,
  type UploadedImage,
} from "../taxonomy/media/still-image-normalizer.js";
import { MaterialsService } from "./materials.service.js";

// 048 EARS-8 (#3512) — the «Материалы» admin surface (048-design §Endpoints).
// The contract is the 012/032 admin one, unchanged: feature 011's dedicated
// MFA-verified admin session plus CSRF double-submit, `platform_admin` required
// by the route guard BEFORE validation, idempotency or handler; every write
// re-establishes the role against the live IdP (`revalidate: "live"`), carries
// a canonical UUID `Idempotency-Key` and — except create — the `If-Match` of
// the version it was read at. The 010 audit row is written by the capture
// trigger inside the command transaction.

const SCOPE = "materials";
/** The one file part a material write accepts — the 012 media slot `cover`. */
const COVER_PART = "cover";

@Controller({ path: "admin/materials", version: "1" })
@UseFilters(TaxonomyProblemFilter)
export class MaterialsAdminController {
  constructor(
    @Inject(MaterialsService) private readonly materials: MaterialsService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  /** EARS-7 — the list with title search and kind / status filters. */
  @Get()
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-7", "EARS-8"],
  })
  list(@Query() rawQuery: Record<string, string>): Promise<MaterialAdminList> {
    const parsed = AdminMaterialListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw invalid("invalid list query", parsed.error);
    return this.materials.list(parsed.data);
  }

  /** EARS-1 — create one draft; key required, no `If-Match`. */
  @Post()
  @HttpCode(201)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-1", "EARS-8", "EARS-19"],
  })
  async create(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const { payload, file } = await readAuthoringRequest(req, false);
    const parsed = CreateMaterialRequestSchema.safeParse(payload);
    if (!parsed.success)
      throw invalid("invalid material payload", parsed.error);
    const path = "/v1/admin/materials";
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "POST",
      route: path,
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path,
        payload: parsed.data,
        fileSha256: file ? sha256(file.body) : null,
        fileBytes: file?.body.length ?? null,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    const { detail, etag } = await this.materials.create({
      payload: parsed.data,
      cover: file,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    void reply.header("location", `/v1/admin/materials/${detail.id}`);
    return detail;
  }

  /** EARS-1 — the form's read by stable id, with the ETag. */
  @Get(":id")
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    audit: "none",
    tests: ["EARS-1", "EARS-8"],
  })
  async detail(
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireId(id);
    const { detail, etag } = await this.materials.detail(id);
    void reply.header("etag", etag);
    return detail;
  }

  /** EARS-1 / EARS-5 / EARS-19 — edit under `If-Match`. */
  @Patch(":id")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-1", "EARS-5", "EARS-8", "EARS-19"],
  })
  async update(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    requireId(id);
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const { raw, version } = requireVersion(req, "an edit");
    const { payload, file } = await readAuthoringRequest(req, true);
    const parsed = UpdateMaterialRequestSchema.safeParse(payload ?? {});
    if (!parsed.success)
      throw invalid("invalid material payload", parsed.error);
    // A file together with an explicit clear is contradictory — refuse before
    // upload rather than silently preferring one of the two.
    if (file && parsed.data.mediaAction === "clear") {
      throw new TaxonomyError(
        "MEDIA_INPUT_CONFLICT",
        'a cover file and mediaAction: "clear" cannot be combined',
      );
    }
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "PATCH",
      route: "/v1/admin/materials/:id",
      fingerprint: this.idempotency.fingerprint({
        method: "PATCH",
        path: `/v1/admin/materials/${id}`,
        payload: parsed.data,
        ifMatch: raw,
        fileSha256: file ? sha256(file.body) : null,
        fileBytes: file?.body.length ?? null,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    const { detail, etag } = await this.materials.update({
      id,
      payload: parsed.data,
      cover: file,
      expectedVersion: version,
      lease: outcome.lease,
    });
    void reply.header("etag", etag);
    return detail;
  }

  /** EARS-4 — «Опубликовать». */
  @Post(":id/publish")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-4", "EARS-6", "EARS-8"],
  })
  publish(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.lifecycle(id, "publish", req, reply);
  }

  /** EARS-6 — «Снять с публикации». */
  @Post(":id/unpublish")
  @HttpCode(200)
  @Authz({
    access: "authenticated",
    roles: ["platform_admin"],
    check: "fast-path",
    revalidate: "live",
    audit: "low-stakes",
    tests: ["EARS-6", "EARS-8"],
  })
  unpublish(
    @Param("id") id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.lifecycle(id, "unpublish", req, reply);
  }

  private async lifecycle(
    id: string,
    action: "publish" | "unpublish",
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    requireId(id);
    const key = this.idempotency.requireKey(
      req.headers[IDEMPOTENCY_KEY_HEADER],
    );
    const { raw, version } = requireVersion(req, `a ${action}`);
    const outcome = await this.idempotency.begin({
      key,
      scope: SCOPE,
      actorId: actorSub(req),
      method: "POST",
      route: `/v1/admin/materials/:id/${action}`,
      fingerprint: this.idempotency.fingerprint({
        method: "POST",
        path: `/v1/admin/materials/${id}/${action}`,
        payload: {},
        ifMatch: raw,
      }),
    });
    if (replayed(outcome, reply)) return outcome.replay.body;
    const input = { id, expectedVersion: version, lease: outcome.lease };
    const { detail, etag } =
      action === "publish"
        ? await this.materials.publish(input)
        : await this.materials.unpublish(input);
    void reply.header("etag", etag);
    return detail;
  }
}

/** The admin surface is id-only; a non-UUID token addresses nothing. */
function requireId(id: string): void {
  if (!CANONICAL_UUID_REGEX.test(id))
    throw new TaxonomyError("RESOURCE_NOT_FOUND");
}

/**
 * The 012 §5.1 request shape, as the project / partner controllers read it.
 * JSON → the parsed body, no file. Multipart → exactly one `payload` JSON part
 * plus at most one `cover` file; multipart with NO file is 415, and a second
 * file or a wrong part name is 400 `MEDIA_INPUT_CONFLICT`. Every file part is
 * drained even when refused, so a rejected upload never leaves the connection
 * half-read.
 */
async function readAuthoringRequest(
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
  let oversize: string | undefined;
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const body = await part.toBuffer(); // always drained
      if (part.fieldname !== COVER_PART) {
        conflict ??= `unexpected file part "${part.fieldname}"; a material accepts only "${COVER_PART}"`;
        continue;
      }
      if (file) {
        conflict ??= "more than one cover file part";
        continue;
      }
      if (body.length > MAX_IMAGE_BYTES) {
        // Recorded, not thrown: throwing mid-`req.parts()` would leave the
        // remaining parts unread.
        oversize ??= `the cover exceeds the ${MAX_IMAGE_BYTES}-byte limit`;
        continue;
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
  // An ambiguous SHAPE outranks a bad payload: a request asking for two
  // contradictory things has no single interpretation to validate.
  if (conflict) throw new TaxonomyError("MEDIA_INPUT_CONFLICT", conflict);
  if (oversize) throw new TaxonomyError("MEDIA_INVALID", oversize);
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

/** Absent `If-Match` is 428; one this API did not issue is 412. */
function requireVersion(
  req: FastifyRequest,
  what: string,
): { raw: string; version: number } {
  const raw = req.headers[IF_MATCH_HEADER] as string | undefined;
  if (!raw || raw.trim().length === 0) {
    throw new TaxonomyError(
      "PRECONDITION_REQUIRED",
      `${what} must carry the If-Match of the version it was read at`,
    );
  }
  const version = parseIfMatchVersion(raw);
  if (version === null) {
    throw new TaxonomyError(
      "PRECONDITION_FAILED",
      "the If-Match validator is not one this API issued",
    );
  }
  return { raw, version };
}

function invalid(message: string, error: ZodError): TaxonomyError {
  return new TaxonomyError(
    "VALIDATION_FAILED",
    message,
    error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

/** Replay a completed record's stored outcome verbatim. */
function replayed(
  outcome: IdempotencyOutcome,
  reply: FastifyReply,
): outcome is Extract<IdempotencyOutcome, { kind: "replay" }> {
  if (outcome.kind !== "replay") return false;
  void reply.status(outcome.replay.status);
  if (outcome.replay.etag) void reply.header("etag", outcome.replay.etag);
  if (outcome.replay.location)
    void reply.header("location", outcome.replay.location);
  return true;
}

function actorSub(req: FastifyRequest): string | null {
  return (req as { user?: { sub?: string } }).user?.sub ?? null;
}
