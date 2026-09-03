import { createZodDto } from "nestjs-zod";
import {
  ConfigureStreamRequestSchema,
  EventAdminListSchema,
  EventPageViewSchema,
  LegacyBroadcastCreateBodySchema,
  ParticipationCtaSchema,
  MonthBroadcastListSchema,
  PublicEventListingPageSchema,
  TransitionEventRequestSchema,
  UpcomingBroadcastListSchema,
} from "@ds/schemas";

/** Paged response of `GET /v1/admin/events`, including picker pagination facts. */
export class EventAdminListDto extends createZodDto(EventAdminListSchema) {}

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
 * 014 EARS-24 (#1741) — `POST /v1/admin/legacy-broadcasts` body. The SSOT schema
 * is `.strict()`, so `origin` / `state` (both server-assigned) are a 400 at the
 * `ZodValidationPipe`, before the handler runs and before any row is written.
 */
export class LegacyBroadcastCreateDto extends createZodDto(
  LegacyBroadcastCreateBodySchema,
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

/**
 * 020 EARS-1 (#1764) — the ONE server-resolved participation policy object
 * returned by `…/events/:idOrSlug/participation` on BOTH storefront hosts
 * (LD-2). Same schema, same DTO, two thin routes.
 */
export class ParticipationCtaDto extends createZodDto(ParticipationCtaSchema) {}

/**
 * 020 EARS-1 / LD-1 (#1764) — the ONE public event read, 004's `PublicEventPage`
 * widened in place. Both host routes (`GET /v1/public/events/:idOrSlug` and
 * `GET /v1/storefront/doctor/events/:idOrSlug`) answer with this exact shape;
 * their bodies are content-identical for the same event by construction, because
 * there is only one projection to answer with.
 */
export class EventPageViewDto extends createZodDto(EventPageViewSchema) {}

/** Public bare-path response without a selector (004 EARS-7). */
export class UpcomingBroadcastListDto extends createZodDto(
  UpcomingBroadcastListSchema,
) {}

/** Public bare-path response selected by `month=YYYY-MM` (004 EARS-15). */
export class MonthBroadcastListDto extends createZodDto(
  MonthBroadcastListSchema,
) {}

/** Cursor-paged public feed selected by `timeframe` (014 EARS-11). */
export class PublicEventListingPageDto extends createZodDto(
  PublicEventListingPageSchema,
) {}
