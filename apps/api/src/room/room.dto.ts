import { createZodDto } from "nestjs-zod";
import { PostChatMessageRequestSchema } from "@ds/schemas";

// 006 room request DTOs — nestjs-zod adapters over the `packages/schemas` SSOT
// (never a re-cut schema): these classes only bind the schema to Nest's `@Body()`
// + the global `ZodValidationPipe`, so a malformed request is a 400 before the
// handler runs. The room-config read and the heartbeat command take no body; the
// chat command's body is the message text.

/**
 * `POST /v1/events/:idOrSlug/chat` body (EARS-3) — `{ text }`, validated by the
 * {@link PostChatMessageRequestSchema} SSOT (trimmed, non-empty, ≤2000 chars). An
 * empty / whitespace-only / over-long post is a 400 at the boundary, the SAME rule
 * the portal composer enforces.
 */
export class PostChatMessageRequestDto extends createZodDto(
  PostChatMessageRequestSchema,
) {}
