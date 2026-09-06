import { createZodDto } from "nestjs-zod";
import {
  DoctorConfirmRequestSchema,
  DoctorRegisterRequestSchema,
} from "@ds/schemas";

// nestjs-zod DTO at the I/O boundary (ADR-0002 §3). The schema in
// `packages/schemas` stays the SSOT; this class only adapts it to Nest's
// `@Body()` + `ZodValidationPipe`, so a payload whose
// `medicalWorkerDeclaration` is missing or `false` is refused before the
// handler runs (021 EARS-4).
export class DoctorRegisterRequestDto extends createZodDto(
  DoctorRegisterRequestSchema,
) {}

// 021 EARS-10 (#1546) — the confirmation command's DTO. Same adapter role: the
// SSOT stays `DoctorConfirmRequestSchema`, and `.strict()` there is what refuses
// an unknown field at the boundary. `returnTo` is validated by the GUARD in the
// service, not by this pipe, so a hostile value is an absent target rather than
// a 400 (021-design §3).
export class DoctorConfirmRequestDto extends createZodDto(
  DoctorConfirmRequestSchema,
) {}
