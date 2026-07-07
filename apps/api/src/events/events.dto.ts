import { createZodDto } from "nestjs-zod";
import { TransitionEventRequestSchema } from "@ds/schemas";

// nestjs-zod DTO at the I/O boundary (ADR-0002 §3). The schema is the SSOT in
// `@ds/schemas`; this class only adapts it to Nest's `@Body()` +
// `ZodValidationPipe` so a target outside the closed lifecycle enum is a 400
// before the EARS-7 guard handler runs. (The create request is multipart, so it
// is Zod-parsed manually in the controller — only this JSON body uses a DTO.)

/** `POST /v1/admin/events/:id/transition` body — the target lifecycle state (EARS-7). */
export class TransitionEventRequestDto extends createZodDto(
  TransitionEventRequestSchema,
) {}
