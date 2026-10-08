import { appendFile, mkdir } from "node:fs/promises";
import {
  verificationRefusalEvidence,
  type OwnedCredentials,
} from "./owned-registration.js";

const EXPIRY_MARGIN_MS = 2000;

export function expiryBudget(raw: string | undefined) {
  const ttlMs = Number(raw);
  if (!raw || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 7200000) {
    throw new Error(
      "A live verification-generator TTL in milliseconds is required (1–7200000)",
    );
  }
  return {
    ttlMs,
    waitMs: ttlMs + EXPIRY_MARGIN_MS,
    timeoutMs: ttlMs + EXPIRY_MARGIN_MS + 180000,
  };
}

export function expiredVerificationEvidence(
  request: string,
  response: string,
  account: OwnedCredentials,
  delivered: string,
  submitted: string,
  ttlMs: number,
  elapsedMs: number,
) {
  const refusal = verificationRefusalEvidence(
    request,
    response,
    account,
    delivered,
    submitted,
  );
  let credentialsMatch = false;
  try {
    const body = JSON.parse(request);
    // 003 EARS-39/41: an expired volatile hold submits the code alone.
    credentialsMatch =
      body?.email === account.email &&
      body?.code === submitted &&
      (body.registration === undefined ||
        body.registration?.password === account.password);
  } catch {
    // Submitted credentials must never enter parser diagnostics.
  }
  return {
    credentialsMatch,
    deliveredCode: /^\d{6}$/.test(delivered) && submitted === delivered,
    expired:
      Number.isSafeInteger(ttlMs) &&
      ttlMs > 0 &&
      Number.isFinite(elapsedMs) &&
      elapsedMs >= ttlMs + EXPIRY_MARGIN_MS,
    refusalMatches: refusal.refusalMatches,
  };
}

export function expiryAuditPlan(
  base: string,
  email: string,
  project: string,
): string {
  const url = new URL(base);
  const match = /^academy-(pr-[1-9][0-9]{0,9})\./.exec(url.hostname);
  if (
    !match ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    project !== `slot-${match[1]}`
  ) {
    throw new Error("Expiry audit requires a per-PR Academy HTTPS slot");
  }
  const identifier = Buffer.from(email, "utf8").toString("base64");
  return `set -eu
sudo -n docker exec -i ${project}-api-1 node --input-type=module <<'EXPIRY_AUDIT'
import pg from 'pg';
import { createHmac } from 'node:crypto';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000 });
try {
  const email = Buffer.from('${identifier}', 'base64').toString('utf8');
  if (!process.env.AUDIT_IDENTIFIER_PEPPER) throw new Error();
  const hash = createHmac('sha256', process.env.AUDIT_IDENTIFIER_PEPPER).update(email.toLowerCase()).digest('hex');
  await client.connect();
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout = '5s'");
  const { rows } = await client.query(
    "SELECT count(*)::int AS failed, coalesce(bool_and(reason = 'invalid' AND subject_id IS NULL AND sid IS NULL AND metadata = jsonb_build_object('identifier_hash', $1::text)), true) AS safe FROM audit_ledger WHERE event_type = 'auth.account.verify_failed' AND metadata->>'identifier_hash' = $1", [hash]);
  const user = await client.query('SELECT email_verified FROM users WHERE email = $1', [email]);
  await client.query('COMMIT');
  console.log(JSON.stringify({ failed: rows[0].failed, safe: rows[0].safe, unverified: user.rows.length === 1 && user.rows[0].email_verified === false }));
} catch {
  console.error('Owned expiry audit read failed');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
EXPIRY_AUDIT`;
}

export interface ExpiryAudit {
  failed: number;
  safe: boolean;
  unverified: boolean;
}

export function parseExpiryAudit(text: string): ExpiryAudit {
  try {
    const parsed = JSON.parse(text) as ExpiryAudit;
    if (
      parsed &&
      Object.keys(parsed).length === 3 &&
      Number.isSafeInteger(parsed.failed) &&
      parsed.failed >= 0 &&
      parsed.safe === true &&
      parsed.unverified === true
    )
      return parsed;
  } catch {
    // JSON parser diagnostics can echo credential-bearing response bytes.
  }
  throw new Error("Invalid owned verification-attempt audit projection");
}

export async function readExpiryAudit(
  base: string,
  email: string,
  execute?: (script: string) => Promise<string>,
): Promise<ExpiryAudit> {
  // Dynamic URLs reuse the existing operator modules without adding package deps.
  const slots = await import(
    new URL("../../../tools/staging/slot.mjs", import.meta.url).href
  );
  const slot = /^academy-(pr-[1-9][0-9]{0,9})\./.exec(
    new URL(base).hostname,
  )?.[1];
  if (!slot)
    throw new Error("Expiry audit requires a per-PR Academy HTTPS slot");
  const script = expiryAuditPlan(base, email, slots.composeProjectName(slot));
  if (execute) return parseExpiryAudit(await execute(script));
  const remote = await import(
    new URL("../../../tools/deploy/lib/remote.mjs", import.meta.url).href
  );
  const scratch = new URL("../../../.scratch/", import.meta.url);
  await mkdir(scratch, { recursive: true });
  await appendFile(
    new URL("stand-ops-2696.log", scratch),
    JSON.stringify({ command: "sshCapture", host: slots.STAGE_1, script }) +
      "\n",
  );
  try {
    return parseExpiryAudit(
      await remote.sshCapture(slots.STAGE_1, script, {
        sshOptions: ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"],
        signal: AbortSignal.timeout(20000),
        stderr: "pipe",
      }),
    );
  } catch {
    throw new Error(
      "Owned expiry audit read failed; inspect the stand command log",
    );
  }
}
