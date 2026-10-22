import { createZodDto } from "nestjs-zod";
import {
  StorefrontTransactionRequestSchema,
  StorefrontRedeemRequestSchema,
} from "@ds/schemas";

// nestjs-zod DTOs at the I/O boundary (ADR-0002 §3); the schemas are the SSOT
// in `packages/schemas/src/auth/storefront-oidc.schema.ts`.
export class StorefrontTransactionRequestDto extends createZodDto(
  StorefrontTransactionRequestSchema,
) {}
export class StorefrontRedeemRequestDto extends createZodDto(
  StorefrontRedeemRequestSchema,
) {}
