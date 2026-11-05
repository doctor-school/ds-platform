import "reflect-metadata";

import {
  SUPERADMIN_USAGE,
  bootstrapAndRunSuperadmin,
  parseSuperadminArgs,
} from "./superadmin-cli.js";
import { SuperadminRefusal } from "./superadmin-command.js";

/**
 * 049 EARS-6: give or remove `superadmin` — the only path that does either.
 * The entry lives under `src/` so it compiles into the api image's `dist/`,
 * which carries no `scripts/`, no tsx and no pnpm.
 *
 *   # on the API host, in the running api container (prod and the stage slots):
 *   sudo docker compose exec -T api node dist/staff-access/superadmin-main.js grant  --email <email> --by-admin <operator sub>
 *   # on a workstation, against the dev stand:
 *   pnpm --filter @ds/api superadmin -- remove --email <email> --by-admin <operator sub>
 *
 * Procedure, including the MANDATORY post-action note:
 * `apps/docs/content/operations/admin-onboarding.md` → Superadministrator.
 *
 * stdout carries one JSON result line (no secret); a refusal or failure exits
 * non-zero with the reason on stderr — the error's name and message only, since
 * an IdP adapter message is not guaranteed free of a response body's detail
 * beyond that, and a stack adds nothing an operator acts on.
 */
async function main(): Promise<void> {
  const command = parseSuperadminArgs(process.argv.slice(2));
  if (!command) throw new SuperadminUsageError();
  const result = await bootstrapAndRunSuperadmin(command);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

class SuperadminUsageError extends Error {
  constructor() {
    super(SUPERADMIN_USAGE);
    this.name = "Usage";
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const reason =
      err instanceof SuperadminRefusal
        ? `REFUSED — ${err.message}; nothing was changed`
        : err instanceof SuperadminUsageError
          ? err.message
          : `FAILED — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`;
    process.stderr.write(`[superadmin] ${reason}\n`);
    process.exit(1);
  });
