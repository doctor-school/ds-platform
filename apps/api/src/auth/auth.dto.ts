import { createZodDto } from "nestjs-zod";
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  VerifyRequestSchema,
  ZitadelWebhookSchema,
} from "@ds/schemas";

// nestjs-zod DTOs at the I/O boundary (ADR-0002 §3). The schema is the SSOT in
// `packages/schemas`; these classes only adapt it to Nest's `@Body()` +
// `ZodValidationPipe` so a malformed request is a 400 before the handler runs.

export class RegisterRequestDto extends createZodDto(RegisterRequestSchema) {}
export class LoginRequestDto extends createZodDto(LoginRequestSchema) {}
export class VerifyRequestDto extends createZodDto(VerifyRequestSchema) {}
export class ZitadelWebhookDto extends createZodDto(ZitadelWebhookSchema) {}
