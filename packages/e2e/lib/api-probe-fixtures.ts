import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDrizzle } from "@ds/db";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// Resolve the production adapter's SDK/schema versions without a second dependency set.
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
interface StorageSdk {
  S3Client: new (config: Record<string, unknown>) => {
    send(command: unknown): Promise<{ KeyCount?: number }>;
    destroy(): void;
  };
  ListObjectsV2Command: new (input: Record<string, unknown>) => unknown;
}
export function parseProbeSchema(
  name: "HealthResponseSchema" | "ReadinessResponseSchema",
  body: unknown,
): void {
  // Other BDD journeys need no compiled API/schema output merely to generate.
  const schemas = apiRequire("@ds/schemas") as Record<
    string,
    { parse(value: unknown): unknown }
  >;
  schemas[name]!.parse(body);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing owned probe fixture: ${name}`);
  return value;
}

function databaseUrl(missingVector = false): string {
  const value = required(
    missingVector
      ? "E2E_API_PROBE_NOVECTOR_DATABASE_URL"
      : "E2E_API_PROBE_DATABASE_URL",
  );
  const expected = missingVector
    ? /^\/ds_(dev|probe)_3688_novector$/
    : /^\/ds_(dev|probe)_3688$/;
  if (!expected.test(new URL(value).pathname))
    throw new Error("API probes require the dedicated #3688 database");
  return value;
}

export function probeLog(event: Record<string, unknown>): void {
  const dir = required("E2E_API_PROBE_ARTIFACT_DIR");
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    resolve(dir, "stand-ops-3688.log"),
    JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
  );
  if (process.env.E2E_API_PROBE_OPS_LOG)
    appendFileSync(
      process.env.E2E_API_PROBE_OPS_LOG,
      JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
    );
}

export async function databaseFacts(missingVector = false) {
  const url = databaseUrl(missingVector);
  probeLog({
    command:
      "SELECT database identity, migration, vector and empty worker queues",
    database: new URL(url).pathname,
  });
  const { pool } = createDrizzle(url);
  try {
    const identity = await pool.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    if (`/${identity.rows[0]?.name}` !== new URL(url).pathname)
      throw new Error("Probe database identity mismatch");
    const facts = await pool.query<{
      connected: number;
      vector: string | null;
      initial: string | null;
      migrations: number;
      cleanup: number;
      uploads: number;
    }>(`SELECT 1 AS connected, to_regtype('vector')::text AS vector,
      to_regclass('public.idempotency_keys')::text AS initial,
      (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations,
      (SELECT count(*)::int FROM media_cleanup_jobs) AS cleanup,
      (SELECT count(*)::int FROM idempotency_keys) AS uploads`);
    const fact = facts.rows[0]!;
    if (fact.cleanup !== 0 || fact.uploads !== 0)
      throw new Error("Owned probe DB contains media/upload work");
    probeLog({
      command: "database facts result",
      database: identity.rows[0]!.name,
      ...fact,
    });
    return fact;
  } finally {
    await pool.end();
  }
}

export interface ApiProbe {
  process: ChildProcess;
  url: string;
  degraded: boolean;
  missingVector: boolean;
  log: string;
  request?: Response;
  body?: Record<string, unknown>;
  storageProbe(): Promise<{
    status: number;
    name: string;
    keys?: number | undefined;
  }>;
  stop(): Promise<void>;
}

function verifyListener(pid: number, port: number): void {
  probeLog({ command: "verify listener ownership", pid, port });
  if (process.platform === "win32") {
    const output = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const owned = output.split(/\r?\n/).some((line) => {
      const cells = line.trim().split(/\s+/);
      return (
        cells[1]?.endsWith(`:${port}`) &&
        cells[3] === "LISTENING" &&
        cells[4] === String(pid)
      );
    });
    if (!owned)
      throw new Error("Probe port is not listening on the owned API PID");
  } else if (process.platform === "linux") {
    const sockets = new Set(
      readdirSync(`/proc/${pid}/fd`).flatMap((fd) => {
        try {
          return [readlinkSync(`/proc/${pid}/fd/${fd}`)];
        } catch {
          return [];
        }
      }),
    );
    const owned = readFileSync("/proc/net/tcp", "utf8")
      .split("\n")
      .some((line) => {
        const cells = line.trim().split(/\s+/);
        return (
          cells[1]?.split(":")[1] ===
            port.toString(16).toUpperCase().padStart(4, "0") &&
          cells[3] === "0A" &&
          sockets.has(`socket:[${cells[9]}]`)
        );
      });
    if (!owned)
      throw new Error("Probe port is not listening on the owned API PID");
  } else
    throw new Error(
      "API probe listener ownership is supported on Windows/Linux",
    );
}

export async function startApiProbe(
  degraded: boolean,
  missingVector = false,
): Promise<ApiProbe> {
  const facts = await databaseFacts(missingVector);
  if (facts.vector !== (missingVector ? null : "vector"))
    throw new Error("Probe database vector precondition mismatch");
  const endpoint = required("E2E_API_PROBE_S3_ENDPOINT");
  const accessKeyId = degraded
    ? `absent-3688-${randomUUID()}`
    : required("E2E_API_PROBE_S3_ACCESS_KEY");
  const secretAccessKey = required("E2E_API_PROBE_S3_SECRET_KEY");
  const bucket = required("E2E_API_PROBE_S3_BUCKET");
  if (bucket !== "ds-api-probes-3688")
    throw new Error("Unexpected probe bucket");
  const server = createServer();
  probeLog({ command: "bind and release free loopback port" });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No free probe port");
  const port = address.port;
  await new Promise<void>((ok, fail) =>
    server.close((err) => (err ? fail(err) : ok())),
  );
  const entry = resolve(root, "apps/api/dist/main.js");
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "Path",
    "SystemRoot",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
  ])
    if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, {
    NODE_ENV: "development",
    SENTRY_ENVIRONMENT: "test",
    DATABASE_URL: databaseUrl(missingVector),
    PORT: String(port),
    RECONCILE_SWEEP_INTERVAL_MS: "0",
    AUDIT_IDENTIFIER_PEPPER: `probe-${randomUUID()}`,
    LIFECYCLE_IMPACT_TOKEN_SECRET: `probe-${randomUUID()}`,
    S3_ENDPOINT: endpoint,
    S3_REGION: "us-east-1",
    S3_BUCKET_UPLOADS: bucket,
    S3_ACCESS_KEY: accessKeyId,
    S3_SECRET_KEY: secretAccessKey,
    S3_FORCE_PATH_STYLE: "true",
  });
  probeLog({
    command: "node apps/api/dist/main.js",
    cwd: root,
    port,
    degraded,
    missingVector,
    entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
    reconcileSweep: 0,
    idpServiceToken: "omitted",
    idpIssuer: "omitted",
  });
  const child = spawn(process.execPath, [entry], {
    cwd: resolve(root, "apps/api"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const fixture: ApiProbe = {
    process: child,
    url: `http://127.0.0.1:${port}`,
    degraded,
    missingVector,
    log: "",
    async storageProbe() {
      probeLog({
        command: "S3 ListObjectsV2 MaxKeys=1",
        endpoint,
        bucket,
        degraded,
      });
      const sdk = apiRequire("@aws-sdk/client-s3") as StorageSdk;
      const client = new sdk.S3Client({
        endpoint,
        region: "us-east-1",
        forcePathStyle: true,
        maxAttempts: 1,
        credentials: { accessKeyId, secretAccessKey },
      });
      try {
        const result = await client.send(
          new sdk.ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }),
        );
        return { status: 200, name: "ok", keys: result.KeyCount };
      } catch (error) {
        const failure = error as {
          name?: string;
          $metadata?: { httpStatusCode?: number };
        };
        return {
          status: failure.$metadata?.httpStatusCode ?? 0,
          name: failure.name ?? "Unknown",
        };
      } finally {
        client.destroy();
      }
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        probeLog({
          command: "terminate owned API child",
          pid: child.pid,
          port,
        });
        child.kill();
        await new Promise<void>((ok, fail) => {
          const timer = setTimeout(
            () => fail(new Error(`Owned API PID ${child.pid} did not exit`)),
            15_000,
          );
          child.once("exit", () => {
            clearTimeout(timer);
            ok();
          });
        });
      }
      probeLog({
        command: "owned API exited",
        pid: child.pid,
        port,
        exitCode: child.exitCode,
        signal: child.signalCode,
      });
      writeFileSync(
        resolve(required("E2E_API_PROBE_ARTIFACT_DIR"), `api-${child.pid}.log`),
        fixture.log
          .replaceAll(accessKeyId, "<access-key>")
          .replaceAll(secretAccessKey, "<secret-key>")
          .replaceAll(databaseUrl(missingVector), "<owned-database-url>"),
      );
      probeLog({
        command: "bind and release exited API port",
        pid: child.pid,
        port,
      });
      const check = createServer();
      await new Promise<void>((ok, fail) => {
        check.once("error", fail);
        check.listen(port, "127.0.0.1", ok);
      });
      await new Promise<void>((ok, fail) =>
        check.close((error) => (error ? fail(error) : ok())),
      );
    },
  };
  child.stdout!.on("data", (data) => {
    fixture.log += String(data);
  });
  child.stderr!.on("data", (data) => {
    fixture.log += String(data);
  });
  child.on("error", (error) => {
    fixture.log += error.message;
  });
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(
          `Owned API exited before listening; see api-${child.pid}.log`,
        );
      try {
        const response = await fetch(`${fixture.url}/v1/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.status === 200) {
          // Keep ownership failures outside the transient HTTP-connect catch.
          break;
        }
      } catch {
        /* Poll the real listen condition, bounded by the boot deadline. */
      }
      await delay(100);
    }
    verifyListener(child.pid!, port);
    const health = await fetch(`${fixture.url}/v1/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (health.status !== 200)
      throw new Error(`Owned API did not listen; see api-${child.pid}.log`);
    probeLog({ command: "owned API listening", pid: child.pid, port });
    return fixture;
  } catch (error) {
    await fixture.stop();
    throw error;
  }
}
