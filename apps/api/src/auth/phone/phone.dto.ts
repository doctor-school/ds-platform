import { createZodDto } from "nestjs-zod";
import {
  ConfirmPhoneRequestSchema,
  RequestPhoneCodeRequestSchema,
} from "@ds/schemas";

// 003 EARS-47/48 request DTOs — nestjs-zod adapters over the
// `packages/schemas` SSOT. The account is always the session subject, never
// a body field (self-scoped).

/** `POST /v1/me/phone` body (EARS-47): the number as typed. */
export class RequestPhoneCodeRequestDto extends createZodDto(
  RequestPhoneCodeRequestSchema,
) {}

/** `POST /v1/me/phone/confirm` body (EARS-48): the code from the SMS. */
export class ConfirmPhoneRequestDto extends createZodDto(
  ConfirmPhoneRequestSchema,
) {}
