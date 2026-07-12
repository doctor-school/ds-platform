import { createZodDto } from "nestjs-zod";
import { SetDisplayNameRequestSchema } from "@ds/schemas";

// 006 self-scoped display-name request DTO — a nestjs-zod adapter over the
// `packages/schemas` SSOT (never a re-cut schema): this class only binds the
// schema to Nest's `@Body()` + the global `ZodValidationPipe`, so a malformed /
// empty / whitespace-only / over-long value is a 400 before the handler runs —
// the SAME rule the portal JIT prompt enforces.

/**
 * `PUT /v1/me/display-name` body (EARS-14) — `{ displayName }`, validated by the
 * {@link SetDisplayNameRequestSchema} SSOT (trimmed, non-empty after trim,
 * ≤100 chars). The caller's identity is the authenticated session, NEVER a body
 * field — self-scoped (EARS-16).
 */
export class SetDisplayNameRequestDto extends createZodDto(
  SetDisplayNameRequestSchema,
) {}
