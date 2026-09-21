import { createZodDto } from "nestjs-zod";
import { CongressSignUpRequestSchema } from "@ds/schemas";

/**
 * 044 EARS-1 — the nestjs-zod DTO at the intake's I/O boundary (ADR-0002 §3).
 *
 * The schema in `packages/schemas` stays the SSOT; this class only adapts it to
 * Nest's `@Body()` + `ZodValidationPipe`, so a submission with a missing
 * consent, an unparseable contact phone or a malformed specialty id is refused
 * BEFORE the handler runs — and therefore before the window check, the account
 * lookup and any write.
 */
export class CongressSignUpRequestDto extends createZodDto(
  CongressSignUpRequestSchema,
) {}
