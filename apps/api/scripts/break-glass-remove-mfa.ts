#!/usr/bin/env tsx
import "reflect-metadata";

import { bootstrapAndRemoveFactor } from "../src/auth/admin-session/break-glass-cli.js";

/**
 * 011 LD-2 break-glass: remove a `platform_admin`'s TOTP factor when the EARS-13
 * endpoint cannot be used — i.e. while fewer than two operators hold an enrolled
 * factor, so no caller can supply the fresh-possession proof the endpoint demands.
 *
 * It is the ONLY sanctioned removal path outside that endpoint, and it is not an
 * unobserved one: it writes the same `auth.mfa.reset` row, through the same
 * writer, with the acting operator in `by_admin`.
 *
 * Run with the target environment injected (no dotenv autoload — see
 * `.claude/rules/dev-stand.md`):
 *
 *   set -a; source ~/.ds-platform/.env.local; set +a
 *   pnpm --filter @ds/api break-glass:remove-mfa --target <sub> --by <sub>
 *
 * Full procedure, including the MANDATORY post-action note:
 * `apps/api/src/auth/README.md` → Operator factor recovery (LD-2).
 *
 * Exits non-zero on failure so an ops wrapper sees it.
 */
function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const targetSub = argValue("--target");
  const byAdmin = argValue("--by");
  // Fail closed on a missing argument rather than defaulting either subject. A
  // removal with an unnamed actor would write the row this path exists to
  // guarantee — with the one field that makes it accountable left empty.
  if (!targetSub || !byAdmin) {
    throw new Error(
      "usage: break-glass:remove-mfa --target <target IdP sub> --by <acting operator IdP sub>",
    );
  }
  await bootstrapAndRemoveFactor({ targetSub, byAdmin });
  // The machine-readable result is the script's stdout contract.
  process.stdout.write(`${JSON.stringify({ removed: targetSub, byAdmin })}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    process.stderr.write(
      `[break-glass:remove-mfa] FAILED — ${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }\n`,
    );
    process.exit(1);
  });
