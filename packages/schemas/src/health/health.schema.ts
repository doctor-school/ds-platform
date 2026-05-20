import { z } from 'zod';

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    uptime: z.number().nonnegative(),
    timestamp: z.string().datetime({ offset: false }),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
