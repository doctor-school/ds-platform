import { createZodDto } from "nestjs-zod";
import { AdminLoginRequestSchema, AdminMfaCodeRequestSchema } from "@ds/schemas";

// nestjs-zod DTO at the I/O boundary (ADR-0002 §3). The schema is the SSOT in
// `packages/schemas`; this class only adapts it to Nest's `@Body()` +
// `ZodValidationPipe` so a malformed request is a 400 before the handler runs.
export class AdminLoginRequestDto extends createZodDto(
  AdminLoginRequestSchema,
) {}

/**
 * 011 EARS-5: the submitted TOTP code. The six-digit constraint lives in the
 * SSOT schema, so garbage input is a 400 from the validation pipe — it never
 * reaches the IdP and never consumes an attempt budget.
 */
export class AdminMfaCodeRequestDto extends createZodDto(
  AdminMfaCodeRequestSchema,
) {}
