#!/usr/bin/env tsx
import "reflect-metadata";

import {
  SUPERADMIN_USAGE,
  bootstrapAndRunSuperadmin,
  parseSuperadminArgs,
} from "../src/staff-access/superadmin-cli.js";
import { SuperadminRefusal } from "../src/staff-access/superadmin-command.js";

/**
 * 049 EARS-6: give or remove `superadmin` — the only path that does either.
 *
 *   set -a; source ~/.ds-platform/.env.local; set +a
 *   pnpm --filter @ds/api superadmin -- grant  --email <email> --by-admin <operator sub>
 *   pnpm --filter @ds/api superadmin -- remove --email <email> --by-admin <operator sub>
 *
 * Procedure, including the MANDATORY post-action note:
 * `apps/docs/content/operations/admin-onboarding.md` → Superadministrator.
 *
 * stdout carries one JSON result line (no secret); a refusal or failure exits
 * non-zero with the reason on stderr.
 */
async function main(): Promise<void> {
  const command = parseSuperadminArgs(process.argv.slice(2));
  if (!command) throw new Error(SUPERADMIN_USAGE);
  const result = await bootstrapAndRunSuperadmin(command);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const reason =
      err instanceof SuperadminRefusal
        ? `REFUSED — ${err.message}; nothing was changed`
        : `FAILED — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
    process.stderr.write(`[superadmin] ${reason}\n`);
    process.exit(1);
  });
