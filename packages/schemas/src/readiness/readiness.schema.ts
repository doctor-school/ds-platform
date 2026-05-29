import { z } from "zod";

export const CheckStatusSchema = z.enum(["ok", "down"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const ReadinessResponseSchema = z
  .object({
    status: CheckStatusSchema,
    checks: z
      .object({
        postgres: CheckStatusSchema,
        pgvector: CheckStatusSchema,
      })
      .strict(),
    timestamp: z.string().datetime({ offset: false }),
  })
  .strict();

export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
