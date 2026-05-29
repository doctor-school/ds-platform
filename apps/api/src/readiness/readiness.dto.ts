import { createZodDto } from "nestjs-zod";
import { ReadinessResponseSchema } from "@ds/schemas";

export class ReadinessResponseDto extends createZodDto(
  ReadinessResponseSchema,
) {}
