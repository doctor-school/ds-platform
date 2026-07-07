import { createZodDto } from "nestjs-zod";
import {
  ConfigureStreamRequestSchema,
  TransitionEventRequestSchema,
} from "@ds/schemas";

// nestjs-zod DTO at the I/O boundary (ADR-0002 §3). The schema is the SSOT in
// `@ds/schemas`; this class only adapts it to Nest's `@Body()` +
// `ZodValidationPipe` so a target outside the closed lifecycle enum is a 400
// before the EARS-7 guard handler runs. (The create request is multipart, so it
// is Zod-parsed manually in the controller — only this JSON body uses a DTO.)

/** `POST /v1/admin/events/:id/transition` body — the target lifecycle state (EARS-7). */
export class TransitionEventRequestDto extends createZodDto(
  TransitionEventRequestSchema,
) {}

/**
 * `PUT /v1/admin/events/:id/stream` body — the explicit stream provider (closed
 * enum `rutube | youtube`) + the embed reference (EARS-3). An out-of-enum
 * provider is a 400 at the `ZodValidationPipe`, before the handler runs, so no
 * config is recorded for an unknown provider.
 */
export class ConfigureStreamRequestDto extends createZodDto(
  ConfigureStreamRequestSchema,
) {}
