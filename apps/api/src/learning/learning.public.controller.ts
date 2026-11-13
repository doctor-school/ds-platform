import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Req,
  UseFilters,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { type DrizzleHandle } from "@ds/db";
import { LearningDoctorService, LearningServerError } from "@ds/learning/server";
import {
  CANONICAL_UUID_REGEX,
  type LearningCoursePath,
  type LearningLessonRead,
} from "@ds/schemas";
import { Authz, Public } from "../authz/index.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { LearningProblemFilter } from "./learning.errors.js";
import { optionalPersonId } from "./learning.person.js";

// 024 EARS-13, EARS-15, EARS-17, EARS-22 (#4011) — the public reads: the course
// path and a lesson, for a guest (every state from no facts) and a signed-in
// doctor (states from their facts) alike. No step payload is ever served here.

@Controller({ path: "learning", version: "1" })
@UseFilters(LearningProblemFilter)
export class LearningPublicController {
  constructor(
    @Inject(LearningDoctorService)
    private readonly learning: LearningDoctorService,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleHandle["db"],
  ) {}

  @Get("courses/:courseSlug/path")
  @Public()
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-13"],
  })
  async path(
    @Param("courseSlug") courseSlug: string,
    @Req() req: FastifyRequest,
  ): Promise<LearningCoursePath> {
    return this.learning.path(
      courseSlug,
      await optionalPersonId(this.db, req),
    );
  }

  @Get("lessons/:lessonId")
  @Public()
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @Authz({
    access: "public",
    check: "none",
    audit: "none",
    tests: ["EARS-15", "EARS-17", "EARS-22"],
  })
  async lesson(
    @Param("lessonId") lessonId: string,
    @Req() req: FastifyRequest,
  ): Promise<LearningLessonRead> {
    if (!CANONICAL_UUID_REGEX.test(lessonId))
      throw new LearningServerError("NOT_FOUND", "lesson not found");
    return this.learning.lesson(lessonId, await optionalPersonId(this.db, req));
  }
}
