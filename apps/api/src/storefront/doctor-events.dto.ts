import { createZodDto } from "nestjs-zod";
import { DoctorEventsFeedSchema } from "@ds/schemas";

/**
 * 019 EARS-3 — the day-grouped feed response of
 * `GET /v1/storefront/doctor/events`. The Zod schema in `@ds/schemas` is the
 * SSOT (ADR-0002 §3); this class only adapts it so the OpenAPI document — and
 * therefore the generated `@ds/api-client` the doctor route reads — carries the
 * real `DayGroup[]` envelope rather than a free-form object.
 */
export class DoctorEventsFeedDto extends createZodDto(DoctorEventsFeedSchema) {}
