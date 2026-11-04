import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export type PgLog = (event: Record<string, unknown>) => void;
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export function nativeCommand(args: string[]) {
  const container = process.env.E2E_API_PROBE_PG_CONTAINER;
  if (!container || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(container))
    throw new Error("An explicit native PostgreSQL container is required");
  const docker = ["exec", "-i", container, ...args];
  const host = process.env.E2E_API_PROBE_PG_SSH_HOST;
  if (!host) return { executable: "docker", args: docker };
  if (!/^[a-zA-Z0-9_.@-]+$/.test(host))
    throw new Error("Invalid native PG SSH host");
  return {
    executable: "ssh",
    args: [
      host,
      `${/^(1|true|yes)$/i.test(process.env.E2E_API_PROBE_PG_SUDO ?? "") ? "sudo " : ""}docker ${docker.map(quote).join(" ")}`,
    ],
  };
}

export function nativePg(args: string[], log: PgLog, input?: Buffer): Buffer {
  log({ command: "native PostgreSQL", args });
  const cmd = nativeCommand(args);
  const result = spawnSync(cmd.executable, cmd.args, {
    input,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    log({
      command: "native PostgreSQL denied/failed",
      status: result.status,
      error: result.error?.message ?? result.stderr.toString("utf8"),
    });
    throw new Error(
      `Native PostgreSQL failed (${result.status}): ${result.error?.message ?? result.stderr.toString("utf8")}`,
    );
  }
  return result.stdout;
}

export function nativePsql(database: string, log: PgLog) {
  if (!/^ds_(dev_3688|admin_e2e)$/.test(database))
    throw new Error("Native audit session requires its explicitly owned DB");
  const args = [
    "psql",
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "ds",
    "-d",
    database,
  ];
  log({ command: "open native psql session", database, args });
  const cmd = nativeCommand(args);
  const child = spawn(cmd.executable, cmd.args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "",
    errors = "";
  let pending:
    | {
        marker: string;
        resolve: (value: string) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  child.stdout.on("data", (data) => {
    buffer += String(data);
    if (pending && buffer.includes(pending.marker)) {
      const request = pending;
      pending = undefined;
      const [output, rest] = buffer.split(request.marker);
      buffer = rest?.replace(/^\r?\n/, "") ?? "";
      clearTimeout(request.timer);
      request.resolve(output!.trim());
    }
  });
  child.stderr.on("data", (data) => {
    errors += String(data);
  });
  child.on("error", (error) => pending?.reject(error));
  child.on("exit", (code) => {
    log({
      command: "native psql session exited",
      database,
      pid: child.pid,
      code,
      error: errors,
    });
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Native psql exited ${code}: ${errors}`));
      pending = undefined;
    }
  });
  return {
    async query(sql: string): Promise<string> {
      if (pending) throw new Error("Native psql statements must be serialized");
      log({ command: "native psql SQL", database, sql });
      return new Promise((resolve, reject) => {
        const marker = `done_${randomUUID().replaceAll("-", "")}`;
        const timer = setTimeout(() => {
          pending = undefined;
          reject(new Error("Native psql statement timed out"));
        }, 30_000);
        pending = { marker, resolve, reject, timer };
        child.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        await this.query("ROLLBACK;");
        log({
          command: "close owned native psql session",
          database,
          pid: child.pid,
        });
        child.stdin.end("\\q\n");
        await new Promise<void>((resolve, reject) => {
          child.once("exit", (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`Native psql exit ${code}: ${errors}`)),
          );
        });
      }
    },
  };
}
