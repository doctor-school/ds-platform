import { createZodDto } from "nestjs-zod";
import {
  DoctorEventsFeedSchema,
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
