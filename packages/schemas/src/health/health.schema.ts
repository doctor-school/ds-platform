import { z } from "zod";

export const HealthResponseSchema = z.strictObject({
  status: z.literal("ok"),
  uptime: z.number().nonnegative(),
  timestamp: z.iso.datetime({ offset: false }),
  // The deployed commit SHA (DSO-127), sourced from the `DEPLOY_SHA` env the
  // deploy script (`pnpm deploy:prod`) bakes into the api container. Lets an
  // operator confirm which build is live over plain HTTP (`GET /v1/health`).
  // Optional: unset in local dev / tests, where no deploy stamped a SHA.
  version: z.string().min(1).optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
