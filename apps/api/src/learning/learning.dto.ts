import { createZodDto } from "nestjs-zod";
import {
  LearningAttemptResultSchema,
  LearningAttemptSchema,
  LearningCourseAdminSchema,
  LearningCourseCompositionSchema,
  LearningCourseListSchema,
  LearningCoursePathSchema,
  LearningLessonAdminSchema,
  LearningLessonReadSchema,
  LearningModuleAdminSchema,
  LearningPresetListSchema,
  LearningSchoolAdminSchema,
  LearningSchoolListSchema,
  LearningScopeRulesSchema,
  LearningStepAdminSchema,
  LearningStepReadSchema,
  RecordLearningFactResponseSchema,
} from "@ds/schemas";

// 024 EARS-25 (#4011) — the response DTOs of every learning route, so the
// generated `@ds/api-client` types each body from the `@ds/schemas` SSOT.

// Public + doctor reads and writes.
export class LearningCoursePathDto extends createZodDto(LearningCoursePathSchema) {}
export class LearningLessonReadDto extends createZodDto(LearningLessonReadSchema) {}
export class LearningStepReadDto extends createZodDto(LearningStepReadSchema) {}
export class RecordLearningFactResponseDto extends createZodDto(
  RecordLearningFactResponseSchema,
) {}
export class LearningAttemptDto extends createZodDto(LearningAttemptSchema) {}
export class LearningAttemptResultDto extends createZodDto(
  LearningAttemptResultSchema,
) {}

// Admin.
export class LearningSchoolListDto extends createZodDto(LearningSchoolListSchema) {}
export class LearningSchoolAdminDto extends createZodDto(LearningSchoolAdminSchema) {}
export class LearningCourseListDto extends createZodDto(LearningCourseListSchema) {}
export class LearningCourseAdminDto extends createZodDto(LearningCourseAdminSchema) {}
export class LearningCourseCompositionDto extends createZodDto(
  LearningCourseCompositionSchema,
) {}
export class LearningModuleAdminDto extends createZodDto(LearningModuleAdminSchema) {}
export class LearningLessonAdminDto extends createZodDto(LearningLessonAdminSchema) {}
export class LearningStepAdminDto extends createZodDto(LearningStepAdminSchema) {}
export class LearningPresetListDto extends createZodDto(LearningPresetListSchema) {}
export class LearningScopeRulesDto extends createZodDto(LearningScopeRulesSchema) {}
