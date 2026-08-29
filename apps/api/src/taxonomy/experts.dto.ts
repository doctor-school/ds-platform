import { createZodDto } from "nestjs-zod";
import {
  CreateExpertRequestSchema,
  EligibleExpertUserListSchema,
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

export class EligibleExpertUserListDto extends createZodDto(
  EligibleExpertUserListSchema,
) {}
