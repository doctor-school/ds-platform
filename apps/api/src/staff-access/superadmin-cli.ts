import { Logger, type INestApplicationContext } from "@nestjs/common";

import { AdminSessionService } from "../auth/admin-session/admin-session.service.js";
import { IDP_CLIENT, type IdpClient } from "../auth/idp/idp.types.js";
import { StaffAccessRepository } from "./staff-access.repository.js";
import {
  applySuperadminCommand,
  type SuperadminCommand,
  type SuperadminCommandResult,
} from "./superadmin-command.js";

/**
 * 049 EARS-6 — the superadmin operator command, on the shape of the 011
 * break-glass CLI (`../auth/admin-session/break-glass-cli.ts`): a boot half that
 * opens an HTTP-less Nest context and a run half testable against a booted
 * context. No step-up — the operator has shell access to the API host, the
 * trust root ADR-0001 §8 gives staff-account creation; the compensating control
 * is the runbook's post-action note
 * (`apps/docs/content/operations/admin-onboarding.md` → Superadministrator).
 */

export const SUPERADMIN_USAGE =
  "usage: superadmin -- grant|remove --email <account email> --by-admin <operator IdP sub>";

/** Parse `grant|remove --email <e> --by-admin <sub>`; `null` when malformed. */
export function parseSuperadminArgs(
  argv: readonly string[],
): SuperadminCommand | null {
  const args = argv.filter((a) => a !== "--");
  const verb = args.find((a) => a === "grant" || a === "remove");
  const value = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    const next = index === -1 ? undefined : args[index + 1];
    return next === undefined || next.startsWith("--") ? undefined : next;
  };
  const email = value("--email")?.trim();
  const byAdmin = value("--by-admin")?.trim();
  // Fail closed on a missing argument rather than defaulting either one: a row
  // with an unnamed actor is the one thing the audit trail exists to prevent.
  if (verb === undefined || !email || !byAdmin) return null;
  return { verb, email, byAdmin };
}

/** Run one command against an already-booted Nest context; the caller closes it. */
export function runSuperadminCommand(
  app: INestApplicationContext,
  command: SuperadminCommand,
): Promise<SuperadminCommandResult> {
  return applySuperadminCommand(
    {
      idp: app.get<IdpClient>(IDP_CLIENT),
      repo: app.get(StaffAccessRepository),
      adminSessions: app.get(AdminSessionService),
    },
    command,
  );
}

/**
 * Boot an HTTP-less Nest application context, run one command, close it. The
 * entry script (`apps/api/scripts/superadmin.ts`) calls this.
 */
export async function bootstrapAndRunSuperadmin(
  command: SuperadminCommand,
): Promise<SuperadminCommandResult> {
  const logger = new Logger("SuperadminCli");
  // Lazy imports so a test of the run half never boots a second Nest.
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error"],
  });
  try {
    const result = await runSuperadminCommand(app, command);
    logger.warn(
      `SUPERADMIN ${result.verb}: ${result.sub} on the authority of ${result.byAdmin}, changed [${result.changed.join(", ")}] — record the post-action note on the tracking Issue`,
    );
    return result;
  } finally {
    await app.close();
  }
}
