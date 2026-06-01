import { z } from "zod";

export const HealthResponseSchema = z.strictObject({
  status: z.literal("ok"),
  uptime: z.number().nonnegative(),
  timestamp: z.iso.datetime({ offset: false }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
