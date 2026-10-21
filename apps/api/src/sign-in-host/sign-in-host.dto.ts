import { createZodDto } from "nestjs-zod";
import {
  SignInHostDoctorRegisterRequestSchema,
  SignInHostDoctorVerifyRequestSchema,
  SignInHostEntryQuerySchema,
  SignInHostHandoffRequestSchema,
  SignInHostOtpRequestSchema,
  SignInHostOtpVerifySchema,
  SignInHostPasswordRequestSchema,
  SignInHostPasswordResetCompleteRequestSchema,
  SignInHostPasswordResetRequestSchema,
  SignInHostRegisterRequestSchema,
  SignInHostVerifyRequestSchema,
} from "@ds/schemas";

// nestjs-zod DTOs at the I/O boundary (ADR-0002 §3); the schemas are the SSOT
// in `packages/schemas/src/auth/sign-in-host.schema.ts`.
export class SignInHostEntryQueryDto extends createZodDto(
  SignInHostEntryQuerySchema,
) {}
export class SignInHostPasswordRequestDto extends createZodDto(
  SignInHostPasswordRequestSchema,
) {}
export class SignInHostOtpRequestDto extends createZodDto(
  SignInHostOtpRequestSchema,
) {}
export class SignInHostHandoffRequestDto extends createZodDto(
  SignInHostHandoffRequestSchema,
) {}
export class SignInHostOtpVerifyDto extends createZodDto(
  SignInHostOtpVerifySchema,
) {}
export class SignInHostVerifyRequestDto extends createZodDto(
  SignInHostVerifyRequestSchema,
) {}
export class SignInHostPasswordResetRequestDto extends createZodDto(
  SignInHostPasswordResetRequestSchema,
) {}
export class SignInHostPasswordResetCompleteRequestDto extends createZodDto(
  SignInHostPasswordResetCompleteRequestSchema,
) {}
export class SignInHostRegisterRequestDto extends createZodDto(
  SignInHostRegisterRequestSchema,
) {}
export class SignInHostDoctorRegisterRequestDto extends createZodDto(
  SignInHostDoctorRegisterRequestSchema,
) {}
export class SignInHostDoctorVerifyRequestDto extends createZodDto(
  SignInHostDoctorVerifyRequestSchema,
) {}
