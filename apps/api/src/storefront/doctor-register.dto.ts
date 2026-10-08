import { createZodDto } from "nestjs-zod";
import {
  DoctorRegisterRequestSchema,
  DoctorVerifyRequestSchema,
} from "@ds/schemas";

// nestjs-zod DTO at the I/O boundary (ADR-0002 §3). The schema in
// `packages/schemas` stays the SSOT; this class only adapts it to Nest's
// `@Body()` + `ZodValidationPipe`, so a payload whose
// `medicalWorkerDeclaration` is missing or `false` is refused before the
// handler runs (021 EARS-4).
export class DoctorRegisterRequestDto extends createZodDto(
  DoctorRegisterRequestSchema,
) {}

// 003 EARS-23/41: the doctor host's code-step request — same boundary rule.
export class DoctorVerifyRequestDto extends createZodDto(
  DoctorVerifyRequestSchema,
) {}
