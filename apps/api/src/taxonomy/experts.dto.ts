import { createZodDto } from "nestjs-zod";
import {
  CreateExpertRequestSchema,
  ExpertAdminDetailSchema,
  ExpertAdminListSchema,
  UpdateExpertRequestSchema,
} from "@ds/schemas";

export class CreateExpertRequestDto extends createZodDto(
  CreateExpertRequestSchema,
) {}

export class UpdateExpertRequestDto extends createZodDto(
  UpdateExpertRequestSchema,
) {}

export class ExpertAdminDetailDto extends createZodDto(
  ExpertAdminDetailSchema,
) {}

export class ExpertAdminListDto extends createZodDto(ExpertAdminListSchema) {}
