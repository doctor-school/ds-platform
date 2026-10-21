import { createDrizzle, type DrizzleHandle } from "@ds/db";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  assertObservedMainOrigin,
  chooseStageObserve,
  type StageObserve,
} from "./stage-observe.js";

export interface CongressObservationContour {
  academyBaseUrl: string;
  apiBaseUrl: string;
  databaseUrl: string;
  expectedDatabase: string;
  expectedDatabaseHost: string;
  expectedDatabasePort: number;
}
interface CongressFixture {
  email: string;
  displayName: string;
}
export interface CongressConsent {
  id: string;
  purpose: "congress-personal-data" | "tos";
  version: string;
  capturedAt: string;
  origin: null;
}
export interface CongressSnapshot {
  userId: string;
  subject: string;
  emailVerified: boolean;
  displayNameMatches: boolean;
  profileFingerprint: string;
  registrationCount: number;
  createdByIntake: boolean;
  registrationFingerprint: string;
  consents: CongressConsent[];
}
interface StageEffects {
  capture?: (script: string) => Promise<string>;
  observe?: StageObserve;
}
const FAILURE = "Owned congress observation failed";
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const EMAIL =
  /^congress-registration-2927-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}@example\.test$/;
// Exclude only the verification fields this journey deliberately changes, and
// the asynchronous confirmation-mail outcome, from the preservation fingerprint.
const SELECT = `SELECT u.id AS "userId", u.zitadel_sub AS subject,
  u.email_verified AS "emailVerified", u.display_name = $2 AS "displayNameMatches",
  md5((to_jsonb(u) - 'email_verified' - 'updated_at')::text) AS "profileFingerprint",
  (SELECT count(*)::int FROM registrations r WHERE r.user_id = u.id) AS "registrationCount",
  (SELECT bool_and(r.account_created_by_intake AND r.intake_origin = 'site') FROM registrations r WHERE r.user_id = u.id) AS "createdByIntake",
  (SELECT md5(string_agg((to_jsonb(r) - 'confirmation_mail_status' - 'confirmation_mail_at')::text, '' ORDER BY r.id)) FROM registrations r WHERE r.user_id = u.id) AS "registrationFingerprint",
  coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'purpose', c.purpose,
    'version', c.version, 'capturedAt', c.captured_at::text, 'origin', c.origin) ORDER BY c.id)
    FROM consent_records c WHERE c.user_id = u.id), '[]'::jsonb) AS consents
  FROM users u WHERE u.email = $1`;

function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    throw new Error();
  return value as Record<string, unknown>;
}
function snapshot(rows: unknown[]): CongressSnapshot {
  if (rows.length !== 1) throw new Error();
  const row = object(rows[0], [
    "userId",
    "subject",
    "emailVerified",
    "displayNameMatches",
    "profileFingerprint",
    "registrationCount",
    "createdByIntake",
    "registrationFingerprint",
    "consents",
  ]);
  if (
    typeof row.userId !== "string" ||
    !UUID.test(row.userId) ||
    typeof row.subject !== "string" ||
    !/^[1-9][0-9]{0,39}$/.test(row.subject) ||
    typeof row.emailVerified !== "boolean" ||
    row.displayNameMatches !== true ||
    row.registrationCount !== 1 ||
    row.createdByIntake !== true ||
    ![row.profileFingerprint, row.registrationFingerprint].every(
      (value) => typeof value === "string" && /^[a-f0-9]{32}$/.test(value),
    ) ||
    !Array.isArray(row.consents) ||
    row.consents.length < 1 ||
    row.consents.length > 2
  )
    throw new Error();
  for (const value of row.consents) {
    const consent = object(value, [
      "id",
      "purpose",
      "version",
      "capturedAt",
      "origin",
    ]);
    if (
      typeof consent.id !== "string" ||
      !UUID.test(consent.id) ||
      !["congress-personal-data", "tos"].includes(String(consent.purpose)) ||
      typeof consent.version !== "string" ||
      !(consent.purpose === "tos"
        ? consent.version === "2026-01"
        : /^\d{4}-\d{2}-\d{2}\.sha256-[0-9a-f]{64}$/.test(consent.version)) ||
      typeof consent.capturedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00$/.test(
        consent.capturedAt,
      ) ||
      !Number.isFinite(Date.parse(consent.capturedAt)) ||
      consent.origin !== null
    )
      throw new Error();
  }
  if (
    new Set(row.consents.map((c) => c.id)).size !== row.consents.length ||
    new Set(row.consents.map((c) => c.purpose)).size !== row.consents.length
  )
    throw new Error();
  return row as unknown as CongressSnapshot;
}
function record(
  id: string,
  operation: string,
  status: string,
  nativeExit: number | null,
): void {
  const log =
    process.env.E2E_STAND_COMMAND_LOG ||
    join(tmpdir(), "ds-e2e-stand-ops", "owned-congress-2927.jsonl");
  const fromTemp = relative(tmpdir(), log);
  if (!isAbsolute(log) || fromTemp.startsWith("..") || isAbsolute(fromTemp))
    throw new Error();
  mkdirSync(dirname(log), { recursive: true });
  appendFileSync(
    log,
    `${JSON.stringify({ id, at: new Date().toISOString(), operation, readOnly: true, status, nativeExit, stdout: "", stderr: status === "failed" ? FAILURE : "" })}\n`,
    "utf8",
  );
}
function stageSlot(base: string): string | undefined {
  const url = new URL(base);
  const match = /^academy-(main|pr-[1-9][0-9]{0,9})\.[a-z0-9.-]+$/.exec(
    url.hostname,
  );
  if (!match) return undefined;
  if (
    url.protocol !== "https:" ||
    url.origin !== base.replace(/\/$/, "") ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error();
  return match[1];
}
function validateLocal(contour: CongressObservationContour): void {
  const academy = new URL(contour.academyBaseUrl),
    api = new URL(contour.apiBaseUrl),
    db = new URL(contour.databaseUrl);
  for (const [url, text] of [
    [academy, contour.academyBaseUrl],
    [api, contour.apiBaseUrl],
  ] as const) {
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.origin !== text.replace(/\/$/, "") ||
      !url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error();
  }
  if (
    academy.hostname !== api.hostname ||
    academy.protocol !== api.protocol ||
    academy.port === api.port ||
    !/^ds_dev_[1-9][0-9]*$/.test(contour.expectedDatabase) ||
    !/^(?:[a-z0-9][a-z0-9.-]*|\[[a-f0-9:]+\])$/.test(
      contour.expectedDatabaseHost,
    ) ||
    /(?:^|\.)doctor\.school$/.test(contour.expectedDatabaseHost) ||
    !Number.isSafeInteger(contour.expectedDatabasePort) ||
    contour.expectedDatabasePort < 1 ||
    contour.expectedDatabasePort > 65535 ||
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    db.hostname !== contour.expectedDatabaseHost ||
    db.port !== String(contour.expectedDatabasePort) ||
    db.pathname !== `/${contour.expectedDatabase}` ||
    db.search ||
    db.hash
  )
    throw new Error();
}
async function localRead(
  contour: CongressObservationContour,
  fixture: CongressFixture,
): Promise<unknown[]> {
  validateLocal(contour);
  const id = randomUUID();
  record(id, "owned-congress-local-read", "started", null);
  const connect = (ownedPool: DrizzleHandle["pool"]) => ownedPool.connect();
  let pool: DrizzleHandle["pool"] | undefined;
  let client: Awaited<ReturnType<typeof connect>> | undefined;
  let failed = false,
    rows: unknown[] = [];
  try {
    pool = createDrizzle(contour.databaseUrl, {
      max: 1,
      statement_timeout: 5_000,
    }).pool;
    pool.removeAllListeners("error");
    pool.on("error", () => {
      failed = true;
    });
    client = await connect(pool);
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL timezone = 'UTC'");
    const actual = await client.query(
      "SELECT current_database() AS database, current_setting('transaction_read_only') = 'on' AS \"readOnly\"",
    );
    if (actual.rows.length !== 1) throw new Error();
    const target = object(actual.rows[0], ["database", "readOnly"]);
    if (
      target.database !== contour.expectedDatabase ||
      target.readOnly !== true
    )
      throw new Error();
    rows = (await client.query(SELECT, [fixture.email, fixture.displayName]))
      .rows;
  } catch {
    failed = true;
  } finally {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        failed = true;
      }
      try {
        client.release();
      } catch {
        failed = true;
      }
    }
    if (pool) {
      try {
        await pool.end();
      } catch {
        failed = true;
      }
    }
    record(
      id,
      "owned-congress-local-read",
      failed ? "failed" : "completed",
      null,
    );
  }
  if (failed) throw new Error();
  return rows;
}
async function stageRead(
  base: string,
  slot: string,
  fixture: CongressFixture,
  effects?: StageEffects,
): Promise<unknown[]> {
  // #3119: the CI observe transport runs the box's named observation instead.
  const observe = chooseStageObserve(effects);
  if (observe) {
    await assertObservedMainOrigin(observe, base, slot);
    const id = randomUUID();
    record(id, "owned-congress-stage-read", "started", null);
    let output: string;
    try {
      output = await observe("congress-snapshot", {
        email: fixture.email,
        displayName: fixture.displayName,
      });
    } catch {
      record(id, "owned-congress-stage-read", "failed", null);
      throw new Error();
    }
    record(id, "owned-congress-stage-read", "completed", null);
    return envelopeRows(output, "ds_main");
  }
  const staging = await import(
    new URL("../../../tools/staging/slot.mjs", import.meta.url).href
  );
  const capture = async (
    operation: string,
    script: string,
  ): Promise<string> => {
    const id = randomUUID();
    record(id, operation, "started", null);
    try {
      const output = effects?.capture
        ? await effects.capture(script)
        : await (
            await import(
              new URL("../../../tools/deploy/lib/remote.mjs", import.meta.url)
                .href
            )
          ).sshCapture(staging.STAGE_1, script, {
            sshOptions: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"],
            signal: AbortSignal.timeout(15_000),
            stderr: "pipe",
          });
      record(id, operation, "completed", effects?.capture ? null : 0);
      return output;
    } catch {
      record(id, operation, "failed", null);
      throw new Error();
    }
  };
  const env = staging.parseEnvFile(
    await capture(
      "owned-congress-stage-topology",
      staging.quoteCommand(["sudo", "cat", staging.STAGE_ENV_FILE]),
    ),
  );
  if (
    new URL(base).hostname !==
    staging.slotHostnames(slot, staging.requiredBaseDomain(env)).academy
  )
    throw new Error();
  const database: string = staging.slotDatabaseName(slot);
  if (!/^ds_(main|pr_[1-9][0-9]{0,9})$/.test(database)) throw new Error();
  const bound = SELECT.replaceAll("$1", `'${fixture.email}'`).replaceAll(
    "$2",
    `'${fixture.displayName.replaceAll("'", "''")}'`,
  );
  const sql = `BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SET LOCAL timezone = 'UTC'; SELECT json_build_object('database', current_database(), 'readOnly', current_setting('transaction_read_only') = 'on', 'rows', CASE WHEN current_database() = '${database}' AND current_setting('transaction_read_only') = 'on' THEN (SELECT coalesce(json_agg(row_to_json(binding)), '[]'::json) FROM (${bound}) binding) ELSE NULL END); ROLLBACK;`;
  const output = await capture(
    "owned-congress-stage-read",
    staging.quoteCommand([
      "sudo",
      "docker",
      "exec",
      "-i",
      staging.POSTGRES_CONTAINER,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "ds",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ]),
  );
  return envelopeRows(output, database);
}
/** The read-only envelope of a stage read, from the expected slot database only. */
function envelopeRows(output: string, database: string): unknown[] {
  const result = object(JSON.parse(output), ["database", "readOnly", "rows"]);
  if (
    result.database !== database ||
    result.readOnly !== true ||
    !Array.isArray(result.rows)
  )
    throw new Error();
  return result.rows;
}
/** 003 EARS-23/41: exact owned congress account, consent and intake preservation. */
export async function readOwnedCongressSnapshot(
  contour: CongressObservationContour,
  fixture: CongressFixture,
  effects?: StageEffects,
): Promise<CongressSnapshot> {
  try {
    if (!EMAIL.test(fixture.email) || fixture.displayName !== "Иванова Мария")
      throw new Error();
    const slot = stageSlot(contour.academyBaseUrl);
    return snapshot(
      await (slot
        ? stageRead(contour.academyBaseUrl, slot, fixture, effects)
        : localRead(contour, fixture)),
    );
  } catch {
    throw new Error(FAILURE);
  }
}
