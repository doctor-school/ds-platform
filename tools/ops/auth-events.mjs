#!/usr/bin/env node
// @ts-check
/**
 * auth-events — read-only ops view over Zitadel's `eventstore.events2` (#1112).
 *
 * The incident-runbook replacement for ad-hoc SSH `psql` one-liners: it prints
 * recent auth-relevant identity events (registration, code add/sent, verify,
 * password check success/failure, lockout, grant) so an operator can reconstruct
 * a "the code was rejected / the account never verified" incident without hand-
 * writing SQL against a live box. It is the LOWER-LEVEL companion to our own
 * `audit_ledger` (query that first for the reason-coded `auth.account.verify_failed`
 * / `auth.password.reset_failed` rows #1112 added) — this view surfaces the raw
 * Zitadel side (e.g. the null-payload `*.check.failed` events the ledger cannot
 * enrich).
 *
 * READ-ONLY by construction: every query runs inside a `READ ONLY` transaction, so
 * the script can never mutate the identity store even if misused.
 *
 * The connection string is taken from `--dsn` or `$AUTH_EVENTS_DSN` and is NEVER
 * hardcoded (dev-stand rule — the host differs per recipe/environment). It points
 * at the ZITADEL database (the `eventstore` schema lives there), which is a
 * SEPARATE database from the app's `DATABASE_URL`.
 *
 * Usage:
 *   AUTH_EVENTS_DSN=postgres://USER:PW@HOST:PORT/zitadel \
 *     node tools/ops/auth-events.mjs [flags]
 *   node tools/ops/auth-events.mjs --dsn postgres://…/zitadel --since '2 hours' --limit 100
 *
 * Flags:
 *   --dsn <url>        Zitadel eventstore connection string (else $AUTH_EVENTS_DSN).
 *   --type <like>      event_type LIKE pattern       (default 'user.human.%').
 *   --since <interval> Postgres interval look-back    (default '24 hours').
 *   --limit <n>        max rows, newest first         (default 50).
 *   --aggregate <id>   filter to one user aggregate_id (the Zitadel sub).
 *   --payload          include the raw JSON payload (may contain PII — off by default).
 *   --help             this help.
 */
import pg from "pg";

const HELP = `auth-events — read-only view over Zitadel eventstore.events2 (#1112)

  AUTH_EVENTS_DSN=postgres://USER:PW@HOST:PORT/zitadel \\
    node tools/ops/auth-events.mjs [flags]

Flags:
  --dsn <url>        Zitadel eventstore DSN (else $AUTH_EVENTS_DSN). Never hardcoded.
  --type <like>      event_type LIKE pattern        (default 'user.human.%')
  --since <interval> Postgres interval look-back     (default '24 hours')
  --limit <n>        max rows, newest first          (default 50)
  --aggregate <id>   filter to one user aggregate_id (the Zitadel sub)
  --payload          include raw JSON payload (may contain PII — off by default)
  --help             this help

Query our own audit_ledger FIRST for reason-coded failures:
  SELECT created_at, event_type, reason, metadata->>'identifier_hash'
    FROM audit_ledger
   WHERE event_type IN ('auth.account.verify_failed','auth.password.reset_failed')
   ORDER BY created_at DESC LIMIT 50;
`;

/** Minimal flag parser: `--k v` and boolean `--flag`. */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const dsn =
    (typeof args.dsn === "string" && args.dsn) || process.env.AUTH_EVENTS_DSN;
  if (!dsn) {
    process.stderr.write(
      "error: no DSN. Pass --dsn <url> or set AUTH_EVENTS_DSN to the ZITADEL " +
        "eventstore connection string (…/zitadel). It is never hardcoded — the " +
        "host differs per recipe/environment (dev-stand rule).\n\n" +
        HELP,
    );
    process.exitCode = 2;
    return;
  }

  const type = typeof args.type === "string" ? args.type : "user.human.%";
  const since = typeof args.since === "string" ? args.since : "24 hours";
  const limit = Number.parseInt(String(args.limit ?? "50"), 10) || 50;
  const aggregate =
    typeof args.aggregate === "string" ? args.aggregate : undefined;
  const withPayload = args.payload === true;

  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  try {
    // READ ONLY transaction — a hard guarantee this ops view never writes.
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");

    const params = [type, since, limit];
    let aggFilter = "";
    if (aggregate) {
      params.push(aggregate);
      aggFilter = `AND aggregate_id = $${params.length}`;
    }
    const { rows } = await client.query(
      `SELECT created_at, event_type, aggregate_id, creator, payload
         FROM eventstore.events2
        WHERE event_type LIKE $1
          AND created_at >= now() - $2::interval
          ${aggFilter}
        ORDER BY created_at DESC
        LIMIT $3::int`,
      params,
    );
    await client.query("COMMIT");

    if (rows.length === 0) {
      process.stdout.write(
        `no events matching '${type}' in the last ${since}.\n`,
      );
      return;
    }

    for (const r of rows) {
      const ts = new Date(r.created_at).toISOString();
      const base = `${ts}  ${r.event_type}  agg=${r.aggregate_id}  by=${r.creator ?? "-"}`;
      if (withPayload && r.payload != null) {
        process.stdout.write(`${base}  ${JSON.stringify(r.payload)}\n`);
      } else {
        process.stdout.write(`${base}\n`);
      }
    }
    process.stdout.write(`\n${rows.length} event(s).\n`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  process.stderr.write(`auth-events failed: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
