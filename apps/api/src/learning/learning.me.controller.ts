import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseFilters,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { type DrizzleHandle } from "@ds/db";
import { LearningDoctorService, LearningServerError } from "@ds/learning/server";
import {
  CANONICAL_UUID_REGEX,
  type LearningAttempt,
  type LearningAttemptResult,
  type LearningStepRead,
  RecordLearningFactRequestSchema,
  type RecordLearningFactResponse,
  SubmitLearningAttemptRequestSchema,
} from "@ds/schemas";
import type { z } from "zod";
import { Authz } from "../authz/index.js";
import type { Role } from "../authz/authz.types.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import {
  LearningAttemptDto,
  LearningAttemptResultDto,
  LearningStepReadDto,
  RecordLearningFactResponseDto,
} from "./learning.dto.js";
import { LearningProblemFilter } from "./learning.errors.js";
import { callerPersonId } from "./learning.person.js";

// 024 EARS-10, EARS-15, EARS-16, EARS-18, EARS-22 (#4011) — the doctor's own
// step reads and progress writes, the same for the website and the mobile app
// (EARS-25). A guest is refused with 401 before anything is read or stored.

/** Same audience as the sibling `/v1/me/*` routes (003, #2456). */
const DOCTOR: Role[] = ["doctor_guest", "platform_admin"];
const ME = {
  access: "authenticated" as const,
  roles: DOCTOR,
  check: "fast-path" as const,
};

@Controller({ path: "me/learning", version: "1" })
@UseFilters(LearningProblemFilter)
export class LearningMeController {
  constructor(
    @Inject(LearningDoctorService)
    private readonly learning: LearningDoctorService,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleHandle["db"],
  ) {}

  @Get("steps/:stepId")
  @Header("Cache-Control", "no-store")
  @Authz({ ...ME, audit: "none", tests: ["EARS-15", "EARS-16", "EARS-22"] })
  @ApiOkResponse({ type: LearningStepReadDto })
  async step(
    @Param("stepId") stepId: string,
    @Req() req: FastifyRequest,
  ): Promise<LearningStepRead> {
    const personId = await callerPersonId(this.db, req);
    requireUuid(stepId, "step");
    return this.learning.step(stepId, personId);
  }

  @Post("facts")
  @HttpCode(200)
  @Authz({ ...ME, audit: "low-stakes", tests: ["EARS-10", "EARS-22"] })
  @ApiOkResponse({ type: RecordLearningFactResponseDto })
  async fact(@Req() req: FastifyRequest): Promise<RecordLearningFactResponse> {
    const personId = await callerPersonId(this.db, req);
    const body = parse(RecordLearningFactRequestSchema, req.body);
    return this.learning.recordFact(personId, body);
  }

  @Post("tests/:testId/attempts")
  @HttpCode(201)
  @Authz({ ...ME, audit: "low-stakes", tests: ["EARS-18", "EARS-22"] })
  @ApiCreatedResponse({ type: LearningAttemptDto })
  async start(
    @Param("testId") testId: string,
    @Req() req: FastifyRequest,
  ): Promise<LearningAttempt> {
    const personId = await callerPersonId(this.db, req);
    requireUuid(testId, "test");
    return this.learning.startAttempt(personId, testId);
  }

  @Post("attempts/:attemptId/submit")
  @HttpCode(200)
  @Authz({ ...ME, audit: "low-stakes", tests: ["EARS-18", "EARS-22"] })
  @ApiOkResponse({ type: LearningAttemptResultDto })
  async submit(
    @Param("attemptId") attemptId: string,
    @Req() req: FastifyRequest,
  ): Promise<LearningAttemptResult> {
    const personId = await callerPersonId(this.db, req);
    requireUuid(attemptId, "attempt");
    const body = parse(SubmitLearningAttemptRequestSchema, req.body);
    return this.learning.submitAttempt(personId, attemptId, body);
  }
}

function requireUuid(id: string, what: string): void {
  if (!CANONICAL_UUID_REGEX.test(id))
    throw new LearningServerError("NOT_FOUND", `${what} not found`);
}

function parse<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new LearningServerError(
      "VALIDATION_FAILED",
      "the request is refused",
      parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
  return parsed.data;
}
