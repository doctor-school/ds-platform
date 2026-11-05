import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, request, type Server } from "node:http";
import { createRequire } from "node:module";
import { createServer as portServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
type Log = (event: Record<string, unknown>) => void;
type Read = { path: string; status: number; injected: boolean };
type Pool = {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};

export function ownedMaterialDatabase(value: string): string {
  if (!/^\/ds_(dev|probe)_3702$/.test(new URL(value).pathname))
    throw new Error(
      "Material browser originals require the dedicated #3702 database",
    );
  return value;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((ok, fail) =>
    server.close((error) => (error ? fail(error) : ok())),
  );
}

/** 048 EARS-12: only the transport fails; every successful byte comes from the API. */
export async function startMaterialTransport(upstream: string, log: Log) {
  let failPath: string | undefined;
  const reads: Read[] = [];
  const server = createServer((incoming, outgoing) => {
    const path = incoming.url ?? "/";
    if (path === failPath) {
      failPath = undefined;
      reads.push({ path, status: 503, injected: true });
      log({
        command: "inject one SSR material transport failure",
        path,
        status: 503,
      });
      outgoing.writeHead(503).end();
      return;
    }
    const target = new URL(path, upstream);
    const forwarded = request(
      target,
      {
        method: incoming.method,
        headers: { ...incoming.headers, host: target.host },
      },
      (response) => {
        const status = response.statusCode ?? 502;
        reads.push({ path, status, injected: false });
        log({ command: "forward real API response", path, status });
        outgoing.writeHead(status, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on("error", () => outgoing.writeHead(502).end());
    incoming.pipe(forwarded);
  });
  log({ command: "bind owned material transport", host: "127.0.0.1", port: 0 });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const { port } = server.address() as { port: number };
  log({
    command: "owned material transport listening",
    pid: process.pid,
    port,
  });
  return {
    url: `http://127.0.0.1:${port}`,
    reads,
    failOnce(slug: string) {
      if (failPath) throw new Error("A material failure is already armed");
      failPath = `/v1/public/materials/${encodeURIComponent(slug)}`;
    },
    async stop() {
      log({
        command: "close owned material transport",
        pid: process.pid,
        port,
      });
      await close(server);
    },
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Missing owned material-pages prerequisite: ${name}; see packages/e2e/material-pages/README.md`,
    );
  return value;
}

async function freePort(log: Log): Promise<number> {
  log({ command: "bind and release owned loopback port", port: 0 });
  const server = portServer();
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const { port } = server.address() as { port: number };
  await new Promise<void>((ok, fail) =>
    server.close((e) => (e ? fail(e) : ok())),
  );
  return port;
}

function verifyListener(pid: number, port: number, log: Log) {
  log({
    command: "verify owned listener PID",
    pid,
    port,
    platform: process.platform,
  });
  if (process.platform === "win32") {
    const lines = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (
      lines.split(/\r?\n/).some((line) => {
        const cells = line.trim().split(/\s+/);
        return (
          cells[1]?.endsWith(`:${port}`) &&
          cells[3] === "LISTENING" &&
          cells[4] === String(pid)
        );
      })
    )
      return;
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
    if (
      readFileSync("/proc/net/tcp", "utf8")
        .split("\n")
        .some((line) => {
          const cells = line.trim().split(/\s+/);
          return (
            cells[1]?.split(":")[1] ===
              port.toString(16).toUpperCase().padStart(4, "0") &&
            cells[3] === "0A" &&
            sockets.has(`socket:[${cells[9]}]`)
          );
        })
    )
      return;
  }
  throw new Error(`Port ${port} is not proven to belong to owned child ${pid}`);
}

export async function startMaterialPages() {
  const database = ownedMaterialDatabase(required("E2E_MATERIAL_DATABASE_URL"));
  const dir = required("E2E_MATERIAL_ARTIFACT_DIR");
  mkdirSync(dir, { recursive: true });
  const token = randomUUID();
  const log: Log = (event) =>
    appendFileSync(
      resolve(dir, "stand-ops-3702.log"),
      JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
    );
  const { Pool } = apiRequire("pg") as {
    Pool: new (options: { connectionString: string }) => Pool;
  };
  const pool = new Pool({ connectionString: database });
  const query = async (sql: string, values?: unknown[]) => {
    log({ command: "SQL", database: new URL(database).pathname, sql });
    return pool.query(sql, values);
  };
  const children: {
    child: ChildProcess;
    port: number;
    name: string;
    output: string;
  }[] = [];
  const expertIds: string[] = [];
  const materialIds: string[] = [];
  let transport: Awaited<ReturnType<typeof startMaterialTransport>> | undefined;
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

  async function boot(
    name: string,
    entry: string,
    args: string[],
    extra: NodeJS.ProcessEnv,
    readyPath: string,
    reservedPort?: number,
  ) {
    if (!existsSync(entry))
      throw new Error(`Missing committed-source build: ${entry}`);
    const port = reservedPort ?? (await freePort(log));
    log({
      command: "start owned production-build process",
      name,
      entry,
      cwd: resolve(root, "apps", name),
      port,
      ...(name !== "api"
        ? {
            buildId: readFileSync(
              resolve(root, "apps", name, ".next/BUILD_ID"),
              "utf8",
            ),
          }
        : {}),
      entrySha256: createHash("sha256")
        .update(readFileSync(entry))
        .digest("hex"),
    });
    const child = spawn(
      process.execPath,
      [entry, ...args.map((arg) => (arg === "<port>" ? String(port) : arg))],
      {
        cwd: resolve(root, "apps", name === "api" ? "api" : name),
        env: { ...env, ...extra, PORT: String(port), HOSTNAME: "127.0.0.1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const record = { child, port, name, output: "" };
    children.push(record);
    child.stdout!.on("data", (data) => {
      record.output += String(data);
    });
    child.stderr!.on("data", (data) => {
      record.output += String(data);
    });
    child.on("error", (error) => {
      record.output += error.message;
    });
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Owned ${name} exited; see ${name}-${child.pid}.log`);
      let status = 0;
      try {
        status = (
          await fetch(url + readyPath, {
            signal: AbortSignal.timeout(1000),
          })
        ).status;
      } catch {
        /* Wait for this child, never reuse an existing listener. */
      }
      if (status === (name === "api" ? 200 : 404)) {
        verifyListener(child.pid!, port, log);
        log({
          command: "owned process listening",
          name,
          pid: child.pid,
          port,
          status,
        });
        return url;
      }
      await delay(100);
    }
    throw new Error(
      `Owned ${name} did not listen; see ${name}-${child.pid}.log`,
    );
  }

  async function stop() {
    const errors: unknown[] = [];
    for (const { child, name, port, output } of [...children].reverse()) {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          log({
            command: "terminate exact owned process",
            name,
            pid: child.pid,
            port,
          });
          child.kill();
          await new Promise<void>((ok, fail) => {
            const timer = setTimeout(
              () => fail(new Error(`Owned PID ${child.pid} did not exit`)),
              15000,
            );
            child.once("exit", () => {
              clearTimeout(timer);
              ok();
            });
          });
        }
        const check = portServer();
        log({
          command: "verify owned process port released",
          name,
          pid: child.pid,
          port,
        });
        await new Promise<void>((ok, fail) => {
          check.once("error", fail);
          check.listen(port, "127.0.0.1", ok);
        });
        await new Promise<void>((ok, fail) =>
          check.close((e) => (e ? fail(e) : ok())),
        );
      } catch (error) {
        errors.push(error);
      }
      let redacted = output.replaceAll(database, "<owned-database>");
      for (const [key, value] of Object.entries(process.env))
        if (
          /SECRET|PASSWORD|TOKEN|ACCESS_KEY/.test(key) &&
          value &&
          value.length > 3
        )
          redacted = redacted.replaceAll(value, `<${key}>`);
      writeFileSync(resolve(dir, `${name}-${child.pid}.log`), redacted);
    }
    if (transport)
      try {
        await transport.stop();
      } catch (error) {
        errors.push(error);
      }
    try {
      if (materialIds.length) {
        await query(
          "DELETE FROM feed_entries WHERE material_id = ANY($1::uuid[])",
          [materialIds],
        );
        await query("DELETE FROM materials WHERE id = ANY($1::uuid[])", [
          materialIds,
        ]);
      }
      if (expertIds.length)
        await query("DELETE FROM experts WHERE id = ANY($1::uuid[])", [
          expertIds,
        ]);
    } catch (error) {
      errors.push(error);
    }
    await pool.end();
    log({
      command: "owned material runtime cleanup complete",
      errors: errors.length,
      materialIds,
      expertIds,
    });
    if (errors.length)
      throw new AggregateError(errors, "Material runtime cleanup failed");
  }

  try {
    const facts = (
      await query(
        "SELECT current_database() AS name, to_regclass('public.materials')::text AS materials, to_regtype('vector')::text AS vector",
      )
    ).rows[0]!;
    if (
      `/${facts.name}` !== new URL(database).pathname ||
      facts.materials !== "materials" ||
      facts.vector !== "vector"
    )
      throw new Error("Owned material DB is not fully migrated");
    const api = await boot(
      "api",
      resolve(root, "apps/api/dist/main.js"),
      [],
      {
        NODE_ENV: "development",
        SENTRY_ENVIRONMENT: "test",
        DATABASE_URL: database,
        RECONCILE_SWEEP_INTERVAL_MS: "0",
        AUDIT_IDENTIFIER_PEPPER: randomUUID(),
        LIFECYCLE_IMPACT_TOKEN_SECRET: randomUUID(),
      },
      "/v1/health",
    );
    transport = await startMaterialTransport(api, log);
    const next = createRequire(
      resolve(root, "apps/portal/package.json"),
    ).resolve("next/dist/bin/next");
    const portalPort = await freePort(log);
    const doctorPort = await freePort(log);
    const origins = {
      ACADEMY_PUBLIC_ORIGIN: `http://127.0.0.1:${portalPort}`,
      DOCTOR_PUBLIC_ORIGIN: `http://127.0.0.1:${doctorPort}`,
    };
    const portal = await boot(
      "portal",
      next,
      ["start", "--hostname", "127.0.0.1", "--port", "<port>"],
      { NODE_ENV: "production", API_PROXY_TARGET: transport.url, ...origins },
      `/missing-material-${token}`,
      portalPort,
    );
    const doctor = await boot(
      "doctor",
      next,
      ["start", "--hostname", "127.0.0.1", "--port", "<port>"],
      { NODE_ENV: "production", API_PROXY_TARGET: api, ...origins },
      `/missing-material-${token}`,
      doctorPort,
    );
    return {
      api,
      portal,
      doctor,
      transport,
      token,
      stop,
      async expert(fullName: string) {
        if (fullName !== "Страхов Михаил Андреевич")
          throw new Error("Unexpected canonical expert fixture");
        const rows = await query(
          "INSERT INTO experts (slug,family_name,given_name,patronymic,status,first_published_at) VALUES ($1,'Страхов','Михаил','Андреевич','published',now()) RETURNING id",
          [`material-expert-${token}`],
        );
        expertIds.push(String(rows.rows[0]!.id));
        const retained = await query(
          "SELECT family_name || ' ' || given_name || ' ' || patronymic AS name FROM experts WHERE id=$1 AND status='published'",
          [expertIds[0]],
        );
        if (retained.rows[0]?.name !== fullName)
          throw new Error("Published expert fixture mismatch");
      },
      async material(title: string, slug: string, published: boolean) {
        const body = {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: `Текст: ${title}` }],
            },
          ],
        };
        const inserted = await query(
          "INSERT INTO materials (slug,kind,title,body,status,first_published_at) VALUES ($1,'news',$2,$3::jsonb,$4::material_status,CASE WHEN $4::text='published' THEN now() END) RETURNING id",
          [
            slug,
            title,
            JSON.stringify(body),
            published ? "published" : "draft",
          ],
        );
        const id = String(inserted.rows[0]!.id);
        materialIds.push(id);
        if (published)
          await query(
            "INSERT INTO feed_entries (source_platform,source_ref,material_id,kind,title,source_name,href,published_at) VALUES ('academy',$1::uuid::text,$1::uuid,'news',$2,'Академия',$3,now())",
            [id, title, `/materials/${slug}`],
          );
        const response = await fetch(`${api}/v1/public/materials/${slug}`);
        log({
          command: "verify real material API precondition",
          slug,
          status: response.status,
          published,
        });
        if (response.status !== (published ? 200 : 404))
          throw new Error("Real API material precondition mismatch");
        if (
          published &&
          ((await response.json()) as { title: string }).title !== title
        )
          throw new Error("Real API material title mismatch");
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

export type MaterialPages = Awaited<ReturnType<typeof startMaterialPages>>;
