import { createDrizzle, type DrizzleHandle } from "@ds/db";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";

export interface OwnedAuthContour {
  academyBaseUrl: string;
  apiBaseUrl: string;
  databaseUrl: string;
  expectedDatabase: string;
  expectedDatabaseHost: string;
  expectedDatabasePort: number;
}
export interface OwnedAuthFixture {
  email: string;
  subject?: string | undefined;
  profileId?: string | undefined;
}
export interface OwnedPhoneFixture {
  email: string;
  phones: readonly string[];
}
export interface OwnedConsentSnapshot {
  profileId: string;
  emailMatches: boolean;
  subjectMatches: boolean;
  emailVerified: boolean;
  phoneAbsent: boolean;
  phoneVerified: boolean;
  displayNameAbsent: boolean;
  consentCount: number;
  consentId: string;
  purpose: "tos";
  version: string;
  capturedAt: string;
  origin: null;
}

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const OWNED_EMAIL =
  /^(consent-2856|phone-control-2857)-([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})@example\.test$/;
const FAILURE = "Owned auth observation failed";
const CONSENT_SELECT =
  "SELECT u.id AS profile_id, u.email = $1 AS email_matches, u.zitadel_sub = $2 AS subject_matches, u.email_verified, u.phone IS NULL AS phone_absent, u.phone_verified, u.display_name IS NULL AS display_name_absent, c.id AS consent_id, c.purpose, c.version, c.captured_at::text AS captured_at, c.origin FROM users u JOIN consent_records c ON c.user_id = u.id WHERE u.email = $1 AND u.zitadel_sub = $2 AND ($3::uuid IS NULL OR u.id = $3::uuid) ORDER BY c.id";

interface StageConsentEffects {
  capture: (script: string) => Promise<string>;
}

function stageSlot(base: string): string | undefined {
  try {
    const url = new URL(base);
    const match = /^academy-(main|pr-[1-9][0-9]{0,9})\.[a-z0-9.-]+$/.exec(
      url.hostname,
    );
    if (
      !match ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.origin !== base.replace(/\/$/, "")
    )
      return undefined;
    return match[1];
  } catch {
    return undefined;
  }
}

function recordStageOperation(
  slot: string,
  operation: string,
  status: string,
  nativeExit: number | null,
): void {
  const log =
    process.env.E2E_STAND_COMMAND_LOG ||
    join(tmpdir(), "ds-e2e-stand-ops", "owned-auth-observation.jsonl");
  const fromTemp = relative(tmpdir(), log);
  if (!isAbsolute(log) || fromTemp.startsWith("..") || isAbsolute(fromTemp))
    throw new Error();
  mkdirSync(dirname(log), { recursive: true });
  appendFileSync(
    log,
    `${JSON.stringify({ at: new Date().toISOString(), operation, slot, readOnly: true, status, nativeExit })}\n`,
    "utf8",
  );
}

async function observeStageAuth(
  base: string,
  slot: string,
  fixture: OwnedAuthFixture,
  effects?: StageConsentEffects,
  phones?: readonly string[],
): Promise<unknown[]> {
  const owned = { ...fixture };
  validateFixture(owned, phones === undefined);
  try {
    // Reuse the same public stage transport as consent-refusal.ts, keeping its caller contract intact.
    const staging = await import(
      new URL("../../../tools/staging/slot.mjs", import.meta.url).href
    );
    const capture = async (
      operation: string,
      script: string,
    ): Promise<string> => {
      recordStageOperation(slot, operation, "started", null);
      let output: string;
      try {
        if (effects) output = await effects.capture(script);
        else {
          const remote = await import(
            new URL("../../../tools/deploy/lib/remote.mjs", import.meta.url)
              .href
          );
          output = await remote.sshCapture(staging.STAGE_1, script, {
            sshOptions: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"],
            signal: AbortSignal.timeout(15_000),
            stderr: "pipe",
          });
        }
      } catch {
        recordStageOperation(slot, operation, "failed", null);
        throw new Error();
      }
      // sshCapture resolves only when its native child exits 0; injected unit captures have no native exit.
      recordStageOperation(slot, operation, "completed", effects ? null : 0);
      return output;
    };
    const env = staging.parseEnvFile(
      await capture(
        "owned-stage-topology-read",
        staging.quoteCommand(["sudo", "cat", staging.STAGE_ENV_FILE]),
      ),
    );
    const configuredHost = staging.slotHostnames(
      slot,
      staging.requiredBaseDomain(env),
    ).academy;
    if (new URL(base).hostname !== configuredHost) throw new Error();
    const database: string = staging.slotDatabaseName(slot);
    if (!/^ds_(main|pr_[1-9][0-9]{0,9})$/.test(database)) throw new Error();
    const bound =
      phones === undefined
        ? CONSENT_SELECT.replaceAll("$1", `'${owned.email}'`)
            .replaceAll("$2", `'${owned.subject}'`)
            .replaceAll(
              "$3",
              owned.profileId === undefined ? "NULL" : `'${owned.profileId}'`,
            )
        : `SELECT count(*)::text AS count FROM users WHERE phone IN (${phones.map((phone) => `'${phone}'`).join(", ")})`;
    const sql = `BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SET LOCAL timezone = 'UTC'; SELECT json_build_object('database', current_database(), 'readOnly', current_setting('transaction_read_only') = 'on', 'rows', CASE WHEN current_database() = '${database}' AND current_setting('transaction_read_only') = 'on' THEN (SELECT coalesce(json_agg(row_to_json(binding)), '[]'::json) FROM (${bound}) binding) ELSE NULL END); ROLLBACK;`;
    const output = await capture(
      phones === undefined
        ? "owned-stage-consent-read"
        : "owned-stage-phone-account-count",
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
    const result = exactRow(JSON.parse(output), [
      "database",
      "readOnly",
      "rows",
    ]);
    if (
      result.database !== database ||
      result.readOnly !== true ||
      !Array.isArray(result.rows)
    )
      throw new Error();
    return result.rows;
  } catch {
    throw new Error(FAILURE);
  }
}

function validateTarget(contour: OwnedAuthContour): void {
  try {
    const academy = new URL(contour.academyBaseUrl);
    const api = new URL(contour.apiBaseUrl);
    const database = new URL(contour.databaseUrl);
    for (const [origin, supplied] of [
      [academy, contour.academyBaseUrl],
      [api, contour.apiBaseUrl],
    ] as const) {
      if (
        !["http:", "https:"].includes(origin.protocol) ||
        !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
        origin.origin !== supplied.replace(/\/$/, "") ||
        origin.username ||
        origin.password ||
        !origin.port ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash
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
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      database.hostname !== contour.expectedDatabaseHost ||
      database.port !== String(contour.expectedDatabasePort) ||
      database.pathname !== `/${contour.expectedDatabase}` ||
      database.search ||
      database.hash
    )
      throw new Error();
  } catch {
    throw new Error("Invalid owned auth observation target");
  }
}

function validateFixture(fixture: OwnedAuthFixture, consent: boolean): void {
  if (
    !OWNED_EMAIL.test(fixture.email) ||
    (fixture.profileId !== undefined && !UUID.test(fixture.profileId)) ||
    (fixture.subject !== undefined &&
      !/^[1-9][0-9]{0,39}$/.test(fixture.subject)) ||
    (consent &&
      (!fixture.email.startsWith("consent-2856-") || !fixture.subject))
  ) {
    throw new Error("Invalid owned auth observation fixture");
  }
}

function exactRow(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    throw new Error();
  return value as Record<string, unknown>;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?\+00$/.exec(
      value,
    );
  if (
    !match ||
    +match[1]!.slice(0, 4) === 0 ||
    +match[2]! > 23 ||
    +match[3]! > 59 ||
    +match[4]! > 59
  )
    return false;
  const date = new Date(`${match[1]}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === match[1]
  );
}

async function observe(
  contour: OwnedAuthContour,
  fixture: OwnedAuthFixture,
  consent: boolean,
  phones?: readonly string[],
): Promise<unknown[]> {
  validateTarget(contour);
  validateFixture(fixture, consent);
  const commandLog = process.env.E2E_STAND_COMMAND_LOG;
  if (commandLog && !isAbsolute(commandLog))
    throw new Error("Invalid owned auth observation target");
  const connect = (ownedPool: DrizzleHandle["pool"]) => ownedPool.connect();
  let pool: DrizzleHandle["pool"] | undefined;
  let client: Awaited<ReturnType<typeof connect>> | undefined;
  let rows: unknown[] = [];
  let failed = false;
  try {
    pool = createDrizzle(contour.databaseUrl, {
      max: 1,
      statement_timeout: 5_000,
    }).pool;
    // Factory diagnostics may contain connection details; this observer returns only a safe error.
    pool.removeAllListeners("error");
    pool.on("error", () => {
      failed = true;
    });
    client = await connect(pool);
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL timezone = 'UTC'");
    const current = await client.query("SELECT current_database() AS database");
    if (
      current.rows.length !== 1 ||
      exactRow(current.rows[0], ["database"]).database !==
        contour.expectedDatabase
    )
      throw new Error();
    const result = consent
      ? await client.query(CONSENT_SELECT, [
          fixture.email,
          fixture.subject,
          fixture.profileId ?? null,
        ])
      : phones === undefined
        ? await client.query("SELECT count(*)::text AS count FROM users")
        : await client.query(
            "SELECT count(*)::text AS count FROM users WHERE phone = ANY($1::text[])",
            [phones],
          );
    if (!Array.isArray(result.rows)) throw new Error();
    rows = result.rows;
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
  }
  if (commandLog) {
    try {
      appendFileSync(
        commandLog,
        `${JSON.stringify({ at: new Date().toISOString(), operation: consent ? "owned-consent-read" : phones === undefined ? "owned-users-count" : "owned-phone-account-count", database: contour.expectedDatabase, readOnly: true, nativeExit: null, ok: !failed })}\n`,
        "utf8",
      );
    } catch {
      throw new Error(FAILURE);
    }
  }
  if (failed) throw new Error(FAILURE);
  return rows;
}

export async function readOwnedUserCount(
  contour: OwnedAuthContour,
  fixture: OwnedAuthFixture,
): Promise<number> {
  const rows = await observe(contour, fixture, false);
  return parseCount(rows);
}

function parseCount(rows: unknown[]): number {
  try {
    if (rows.length !== 1) throw new Error();
    const row = exactRow(rows[0], ["count"]);
    if (typeof row.count !== "string" || !/^(0|[1-9][0-9]*)$/.test(row.count))
      throw new Error();
    const count = Number(row.count);
    if (!Number.isSafeInteger(count)) throw new Error();
    return count;
  } catch {
    throw new Error(FAILURE);
  }
}

export async function readOwnedPhoneAccountCount(
  contour: OwnedAuthContour,
  fixture: OwnedPhoneFixture,
  effects?: StageConsentEffects,
): Promise<number> {
  if (
    typeof fixture.email !== "string" ||
    !OWNED_EMAIL.test(fixture.email) ||
    !fixture.email.startsWith("phone-control-2857-") ||
    !Array.isArray(fixture.phones) ||
    fixture.phones.length !== 2 ||
    new Set(fixture.phones).size !== 2 ||
    fixture.phones.some(
      (phone) => typeof phone !== "string" || !/^\+1999[0-9]{8}$/.test(phone),
    )
  )
    throw new Error("Invalid owned phone observation fixture");
  const slot = stageSlot(contour.academyBaseUrl);
  const rows = slot
    ? await observeStageAuth(contour.academyBaseUrl, slot, fixture, effects, [
        ...fixture.phones,
      ])
    : await observe(contour, fixture, false, [...fixture.phones]);
  return parseCount(rows);
}

export async function readOwnedConsentSnapshot(
  contour: OwnedAuthContour,
  fixture: OwnedAuthFixture,
  effects?: StageConsentEffects,
): Promise<OwnedConsentSnapshot> {
  const slot = stageSlot(contour.academyBaseUrl);
  const rows = slot
    ? await observeStageAuth(contour.academyBaseUrl, slot, fixture, effects)
    : await observe(contour, fixture, true);
  try {
    if (rows.length !== 1) throw new Error();
    const row = exactRow(rows[0], [
      "profile_id",
      "email_matches",
      "subject_matches",
      "email_verified",
      "phone_absent",
      "phone_verified",
      "display_name_absent",
      "consent_id",
      "purpose",
      "version",
      "captured_at",
      "origin",
    ]);
    if (
      typeof row.profile_id !== "string" ||
      !UUID.test(row.profile_id) ||
      (fixture.profileId !== undefined &&
        row.profile_id !== fixture.profileId) ||
      typeof row.consent_id !== "string" ||
      !UUID.test(row.consent_id) ||
      row.email_matches !== true ||
      row.subject_matches !== true ||
      ![
        "email_verified",
        "phone_absent",
        "phone_verified",
        "display_name_absent",
      ].every((key) => typeof row[key] === "boolean") ||
      row.purpose !== "tos" ||
      row.version !== "2026-01" ||
      !validTimestamp(row.captured_at) ||
      row.origin !== null
    )
      throw new Error();
    return {
      profileId: row.profile_id,
      emailMatches: true,
      subjectMatches: true,
      emailVerified: row.email_verified as boolean,
      phoneAbsent: row.phone_absent as boolean,
      phoneVerified: row.phone_verified as boolean,
      displayNameAbsent: row.display_name_absent as boolean,
      consentCount: 1,
      consentId: row.consent_id,
      purpose: "tos",
      version: row.version,
      capturedAt: row.captured_at,
      origin: null,
    };
  } catch {
    throw new Error(FAILURE);
  }
}
