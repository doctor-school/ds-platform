import { createZodDto } from "nestjs-zod";
import { AdminLoginRequestSchema } from "@ds/schemas";

// nestjs-zod DTO at the I/O boundary (ADR-0002 §3). The schema is the SSOT in
// `packages/schemas`; this class only adapts it to Nest's `@Body()` +
// `ZodValidationPipe` so a malformed request is a 400 before the handler runs.
export class AdminLoginRequestDto extends createZodDto(
  AdminLoginRequestSchema,
) {}
