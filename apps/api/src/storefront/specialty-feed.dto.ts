import { createZodDto } from "nestjs-zod";
import { FeedEventsSchema, SpecialtyFeedSchema } from "@ds/schemas";

/**
 * 018 EARS-1 — the feed envelope of `GET /v1/storefront/feed/{specialty}`. The
 * Zod schema in `@ds/schemas` is the SSOT (ADR-0002 §3); this class only adapts
 * it so the OpenAPI document — and the generated `@ds/api-client` the doctor
 * feed route reads — carries the real envelope.
 */
export class SpecialtyFeedDto extends createZodDto(SpecialtyFeedSchema) {}

/** 018 EARS-4 — the nearest-events block read of the same feed. */
export class FeedEventsDto extends createZodDto(FeedEventsSchema) {}
