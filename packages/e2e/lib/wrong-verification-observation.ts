import { createDrizzle, type DrizzleHandle } from "@ds/db";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { OwnedAuthContour } from "./owned-auth-observation.js";

const OWNED =
  /^wrong-2928-(verified|unverified|unknown)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}@example\.test$/;
const FAILURE = "Owned wrong-verification observation failed";
export interface WrongVerificationSnapshot {
  users: number;
  verified: boolean;
  consents: number;
  userDigest: string;
  consentDigest: string;
}
interface ReadEffects {
  capture(script: string): Promise<string>;
}

function log(
  operation: string,
  status: string,
  id: string,
  ok?: boolean,
  nativeExit: number | null = null,
): void {
  const path =
    process.env.E2E_STAND_COMMAND_LOG ||
    join(tmpdir(), "ds-e2e-stand-ops", "wrong-verification-2928.jsonl");
  const part = relative(tmpdir(), path);
  if (!isAbsolute(path) || part.startsWith("..") || isAbsolute(part))
    throw new Error(FAILURE);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(
    path,
    `${JSON.stringify({ at: new Date().toISOString(), id, operation, status, readOnly: true, ...(status === "completed" ? { nativeExit, ok, stdout: ok ? "read-only observation completed" : "", stderr: ok ? "" : FAILURE } : {}) })}\n`,
    "utf8",
  );
}

function localTarget(contour: OwnedAuthContour): void {
  const academy = new URL(contour.academyBaseUrl);
  const api = new URL(contour.apiBaseUrl);
  const database = new URL(contour.databaseUrl);
  for (const [url, supplied] of [
    [academy, contour.academyBaseUrl],
    [api, contour.apiBaseUrl],
  ] as const) {
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.origin !== supplied.replace(/\/$/, "") ||
      url.username ||
      url.password ||
      !url.port
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
}

function stageSlot(base: string): string | undefined {
  const url = new URL(base);
  const match = /^academy-(main|pr-[1-9][0-9]{0,9})\.[a-z0-9.-]+$/.exec(
    url.hostname,
  );
  return match &&
    url.protocol === "https:" &&
    !url.port &&
    !url.username &&
    !url.password &&
    url.origin === base.replace(/\/$/, "")
    ? match[1]
    : undefined;
}

const SELECT = `SELECT
  (SELECT count(*)::int FROM users WHERE email = $1) AS users,
  (SELECT coalesce(bool_and(email_verified), false) FROM users WHERE email = $1) AS verified,
  (SELECT count(*)::int FROM consent_records c JOIN users u ON u.id = c.user_id WHERE u.email = $1) AS consents,
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(u) ORDER BY u.id)::text, '[]')) FROM users u WHERE u.email = $1) AS user_digest,
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text, '[]')) FROM consent_records c JOIN users u ON u.id = c.user_id WHERE u.email = $1) AS consent_digest`;

function snapshot(rows: unknown): WrongVerificationSnapshot {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error();
  const row = rows[0] as Record<string, unknown>;
  if (
    !row ||
    Object.keys(row).length !== 5 ||
    !Number.isSafeInteger(row.users) ||
    ![0, 1].includes(row.users as number) ||
    typeof row.verified !== "boolean" ||
    !Number.isSafeInteger(row.consents) ||
    (row.consents as number) < 0 ||
    ![row.user_digest, row.consent_digest].every(
      (v) => typeof v === "string" && /^[a-f0-9]{32}$/.test(v),
    )
  )
    throw new Error();
  return {
    users: row.users as number,
    verified: row.verified,
    consents: row.consents as number,
    userDigest: row.user_digest as string,
    consentDigest: row.consent_digest as string,
  };
}

/** 003 EARS-41: hash full owned rows so refusal cannot hide a profile/consent write. */
export async function readWrongVerificationSnapshot(
  contour: OwnedAuthContour,
  email: string,
  effects?: ReadEffects,
): Promise<WrongVerificationSnapshot> {
  let pool: DrizzleHandle["pool"] | undefined;
  const connect = (ownedPool: DrizzleHandle["pool"]) => ownedPool.connect();
  let client: Awaited<ReturnType<typeof connect>> | undefined;
  const id = randomUUID();
  let started = false;
  let result: WrongVerificationSnapshot | undefined;
  let failed = false;
  try {
    if (!OWNED.test(email)) throw new Error();
    const slot = stageSlot(contour.academyBaseUrl);
    if (!slot) localTarget(contour);
    log("wrong-verification-state-read", "started", id);
    started = true;
    if (slot) {
      const staging = await import(
        new URL("../../../tools/staging/slot.mjs", import.meta.url).href
      );
      const capture = async (script: string): Promise<string> => {
        const operationId = randomUUID();
        log("wrong-verification-stage-read", "started", operationId);
        try {
          const remote = effects
            ? undefined
            : await import(
                new URL("../../../tools/deploy/lib/remote.mjs", import.meta.url)
                  .href
              );
          const output = effects
            ? await effects.capture(script)
            : await remote!.sshCapture(staging.STAGE_1, script, {
                sshOptions: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"],
                signal: AbortSignal.timeout(15_000),
                stderr: "pipe",
              });
          log(
            "wrong-verification-stage-read",
            "completed",
            operationId,
            true,
            effects ? null : 0,
          );
          return output;
        } catch {
          log("wrong-verification-stage-read", "completed", operationId, false);
          throw new Error();
        }
      };
      const env = staging.parseEnvFile(
        await capture(
          staging.quoteCommand(["sudo", "cat", staging.STAGE_ENV_FILE]),
        ),
      );
      if (
        new URL(contour.academyBaseUrl).hostname !==
        staging.slotHostnames(slot, staging.requiredBaseDomain(env)).academy
      )
        throw new Error();
      const database: string = staging.slotDatabaseName(slot);
      if (!/^ds_(main|pr_[1-9][0-9]{0,9})$/.test(database)) throw new Error();
      const query = SELECT.replaceAll("$1", `'${email}'`);
      const sql = `BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SELECT json_build_object('database', current_database(), 'readOnly', current_setting('transaction_read_only') = 'on', 'rows', CASE WHEN current_database() = '${database}' AND current_setting('transaction_read_only') = 'on' THEN (SELECT json_agg(row_to_json(binding)) FROM (${query}) binding) ELSE NULL END); ROLLBACK;`;
      const envelope = JSON.parse(
        await capture(
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
        ),
      );
      if (
        Object.keys(envelope).length !== 3 ||
        envelope.database !== database ||
        envelope.readOnly !== true
      )
        throw new Error();
      result = snapshot(envelope.rows);
    } else {
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
      const guard = await client.query(
        "SELECT current_database() AS database, current_setting('transaction_read_only') = 'on' AS read_only",
      );
      if (
        guard.rows.length !== 1 ||
        guard.rows[0].database !== contour.expectedDatabase ||
        guard.rows[0].read_only !== true
      )
        throw new Error();
      result = snapshot((await client.query(SELECT, [email])).rows);
    }
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
    if (started) log("wrong-verification-state-read", "completed", id, !failed);
  }
  if (failed || !result) throw new Error(FAILURE);
  return result;
}
