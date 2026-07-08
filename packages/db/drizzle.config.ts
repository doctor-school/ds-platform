import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Paths are resolved relative to the drizzle-kit invocation CWD, which is
  // apps/api (the `drizzle:*` scripts live there per spec 002 §5), NOT relative
  // to this config file. `out` lands on the repo root from either dir, but
  // `schema` must be spelled relative to apps/api.
  //
  // We point at the concrete table file(s), NOT the `src/schema/index.ts`
  // barrel: drizzle-kit 0.30 loads schema files through a CJS require, and the
  // barrel's NodeNext-mandated `.js` re-export (`./idempotency-keys.js`) does
  // not resolve back to the `.ts` source under that loader. Append new table
  // files here as they land.
  schema: [
    "../../packages/db/src/schema/idempotency-keys.ts",
    "../../packages/db/src/schema/users.ts",
    "../../packages/db/src/schema/consent-records.ts",
    "../../packages/db/src/schema/audit-ledger.ts",
    "../../packages/db/src/schema/events.ts",
    "../../packages/db/src/schema/registrations.ts",
    "../../packages/db/src/schema/presence-beats.ts",
  ],
  out: "../../apps/api/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
