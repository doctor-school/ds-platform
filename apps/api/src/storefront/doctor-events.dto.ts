import { createZodDto } from "nestjs-zod";
import {
  DoctorEventsFeedSchema,
  DoctorEventsLiveStripSchema,
  DoctorEventsMonthGridSchema,
} from "@ds/schemas";

/**
 * 019 EARS-3 — the day-grouped feed response of
 * `GET /v1/storefront/doctor/events`. The Zod schema in `@ds/schemas` is the
 * SSOT (ADR-0002 §3); this class only adapts it so the OpenAPI document — and
 * therefore the generated `@ds/api-client` the doctor route reads — carries the
 * real `DayGroup[]` envelope rather than a free-form object.
 */
export class DoctorEventsFeedDto extends createZodDto(DoctorEventsFeedSchema) {}

/**
 * 019 EARS-4 — the `MonthGrid` response of
 * `GET /v1/storefront/doctor/events/month`. Same rule as the feed DTO: the Zod
 * schema is the SSOT and this class exists only so the OpenAPI document — and
 * the generated `@ds/api-client` both the in-feed grid (#1516) and the calendar
 * page (#1520) read — carries the real day-cell array rather than an object.
 */
export class DoctorEventsMonthGridDto extends createZodDto(
  DoctorEventsMonthGridSchema,
) {}

/**
 * 019 EARS-6 — the «Идёт сейчас» response of
 * `GET /v1/storefront/doctor/events/live`. Same rule as its two siblings: the
 * Zod schema is the SSOT, and this class exists only so the OpenAPI document —
 * and the `@ds/api-client` the doctor host's live block reads — carries the
 * real strip envelope. `LiveStrip | null` is expressed as a NULLABLE response
 * rather than a 204, so «nothing live» is a value the client parses with the
 * same schema as a strip and never an empty body it has to special-case.
 */
export class DoctorEventsLiveDto extends createZodDto(
  DoctorEventsLiveStripSchema,
) {}
