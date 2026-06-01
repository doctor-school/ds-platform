import { z } from "zod";

export const CheckStatusSchema = z.enum(["ok", "down"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const ReadinessResponseSchema = z.strictObject({
  status: CheckStatusSchema,
  checks: z.strictObject({
    postgres: CheckStatusSchema,
    pgvector: CheckStatusSchema,
  }),
  timestamp: z.iso.datetime({ offset: false }),
});

export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
