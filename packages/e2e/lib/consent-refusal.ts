import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 003 EARS-20: this query is restricted to this journey's generated address. */
export function ownedMirrorQuery(email: string): string {
  if (
    !/^register-2704-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}@example\.test$/.test(
      email,
    )
  ) {
    throw new Error(
      "Expected this consent-refusal journey's unique synthetic address",
    );
  }
  return `BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SELECT count(*) FROM users WHERE email = '${email}'; ROLLBACK;`;
}

export function parseMirrorCount(output: string): number {
  const text = output.trim();
  const count = Number(text);
  if (!/^(0|[1-9][0-9]*)$/.test(text) || !Number.isSafeInteger(count)) {
    throw new Error("Invalid owned mirror count");
  }
  return count;
}

type MirrorQuery = (slot: string, sql: string, base: string) => Promise<string>;

async function nativeMirrorQuery(
  slot: string,
  sql: string,
  base: string,
): Promise<string> {
  const staging = await import(
    new URL("../../../tools/staging/slot.mjs", import.meta.url).href
  );
  const remote = await import(
    new URL("../../../tools/deploy/lib/remote.mjs", import.meta.url).href
  );
  const scratch = new URL("../../../.scratch/", import.meta.url);
  mkdirSync(scratch, { recursive: true });
  const log = fileURLToPath(new URL("stand-ops-2704.log", scratch));
  const options = {
    sshOptions: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"],
    signal: AbortSignal.timeout(15_000),
    stderr: "pipe",
  };
  const readEnv = staging.quoteCommand(["sudo", "cat", staging.STAGE_ENV_FILE]);
  appendFileSync(log, `sshCapture(${staging.STAGE_1}, ${readEnv})\n`, "utf8");
  const boxEnv = staging.parseEnvFile(
    await remote.sshCapture(staging.STAGE_1, readEnv, options),
  );
  if (
    new URL(base).hostname !==
    staging.slotHostnames(slot, staging.requiredBaseDomain(boxEnv)).academy
  ) {
    throw new Error("Browser origin does not match the staging slot");
  }
  const command = staging.quoteCommand([
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
    staging.slotDatabaseName(slot),
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
  appendFileSync(log, `sshCapture(${staging.STAGE_1}, ${command})\n`, "utf8");
  return remote.sshCapture(staging.STAGE_1, command, {
    ...options,
    signal: AbortSignal.timeout(15_000),
  });
}

/** Exact slot, read-only count, and sanitized failure; never mirror/credential data. */
export async function ownedMirrorCount(
  base: string,
  email: string,
  query: MirrorQuery = nativeMirrorQuery,
): Promise<number> {
  let slot: string;
  try {
    const url = new URL(base);
    const match = /^academy-(main|pr-[1-9][0-9]{0,9})\.[a-z0-9.-]+$/.exec(
      url.hostname,
    );
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !match
    )
      throw new Error();
    slot = match[1]!;
  } catch {
    throw new Error("Expected an Academy staging slot origin");
  }
  const sql = ownedMirrorQuery(email);
  let output: string;
  try {
    output = await query(slot, sql, base);
  } catch {
    throw new Error("Owned mirror read failed");
  }
  return parseMirrorCount(output);
}
