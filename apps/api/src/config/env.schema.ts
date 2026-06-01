import { z } from "zod";

export const ApiEnvSchema = z.looseObject({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5_000),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return ApiEnvSchema.parse(source);
}
