import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "../../packages/db/src/schema/users.ts",
  ],
  out: "../../apps/api/drizzle",
  dialect: "postgresql",
});
