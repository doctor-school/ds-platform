#!/usr/bin/env tsx
import "reflect-metadata";

import { bootstrapAndExport } from "../src/room/presence-export-cli.js";

/**
 * 006 EARS-5 wave-1 manual sponsor export (design §5). Boots an HTTP-less Nest
 * application context, derives the per-doctor `EventPresence` minutes for one
 * event (parameterized over the server cadence N, concurrent-tab-coalesced),
 * prints the JSON, and exits. NOT an HTTP endpoint — the per-doctor presence data
 * is never exposed on a public surface (EARS-8), so the read is ops-only.
 *
 * Run with the dev-stand env injected (no dotenv autoload — see
 * `.claude/rules/dev-stand.md` / `reference_local_api_portal_live_run_recipe`):
 *
 *   set -a; source ~/.ds-platform/.env.local; set +a
 *   pnpm --filter @ds/api presence:export -- <event-id-or-slug> [intervalSeconds]
 *
 * `<event-id-or-slug>` is required (the event to export). `[intervalSeconds]`
 * optionally overrides the server-config cadence N for a what-if / re-cadenced
 * export — omitted, the default `ROOM_HEARTBEAT_INTERVAL_SECONDS` is used. The
 * machine-readable `EventPresence` JSON is the script's stdout contract; exits
 * non-zero on failure so an ops wrapper sees it.
 */
async function main(): Promise<void> {
  // `pnpm --filter @ds/api presence:export -- <slug>` forwards the `--` separator
  // as a literal argv token — drop a single leading `--` so the documented recipe
  // resolves `<slug>` as the event ref, not the separator.
  const rawArgs = process.argv.slice(2);
  const [idOrSlug, intervalRaw] =
    rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  if (!idOrSlug) {
    process.stderr.write(
      "[presence:export] usage: presence:export -- <event-id-or-slug> [intervalSeconds]\n",
    );
    process.exit(2);
  }
  let intervalSeconds: number | undefined;
  if (intervalRaw !== undefined) {
    intervalSeconds = Number(intervalRaw);
    if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
      process.stderr.write(
        `[presence:export] intervalSeconds must be a positive integer, got "${intervalRaw}"\n`,
      );
      process.exit(2);
    }
  }
  const result = await bootstrapAndExport(idOrSlug, intervalSeconds);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    process.stderr.write(
      `[presence:export] FAILED — ${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }\n`,
    );
    process.exit(1);
  });
