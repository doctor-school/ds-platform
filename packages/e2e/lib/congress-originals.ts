import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { request } from "node:http";
import { dirname, resolve, isAbsolute, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import type { DrizzleHandle } from "@ds/db";
import { congressBackgrounds } from "./congress-originals-report.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
const load = (name: string) =>
  import(pathToFileURL(resolve(root, "apps/api/dist", name)).href);
const assets = resolve(root, "packages/e2e/congress-originals");
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function congressDirectory(): string {
  const dir = process.env.E2E_CONGRESS_DIR;
  if (!dir || !isAbsolute(dir) || relative(tmpdir(), dir).startsWith(".."))
    throw new Error(
      "Congress artifacts require an absolute owned temporary directory",
    );
  mkdirSync(dir, { recursive: true });
  return dir;
}
export function congressOperation(command: string): void {
  appendFileSync(
    resolve(congressDirectory(), "stand-ops.jsonl"),
    JSON.stringify({
      at: new Date().toISOString(),
      ownership: "3974",
      command,
    }) + "\n",
  );
}
const OPENS = "2026-10-01T00:00:00.000+03:00",
  CLOSES = "2027-01-01T00:00:00.000+03:00";
export interface CongressResponse {
  status: number;
  body: Record<string, unknown>;
  retryAfter?: string | undefined;
}

export async function bootCongress(title: string) {
  const dir = resolve(congressDirectory(), randomUUID());
  mkdirSync(dir, { recursive: true });
  mkdirSync(resolve(dir, "temp"));
  mkdirSync(resolve(dir, "logs"));
  const db = process.env.DATABASE_URL,
    expected = process.env.E2E_CONGRESS_DATABASE;
  if (
    !db ||
    !(
      expected === "ds_dev_3974" ||
      (process.env.CI === "true" && expected === "ds_test")
    ) ||
    new URL(db).pathname !== `/${expected}`
  )
    throw new Error(
      "Congress originals require exact owned ds_dev_3974 or disposable CI ds_test",
    );
  const nginxBinary = process.env.E2E_CONGRESS_NGINX;
  if (!nginxBinary || !isAbsolute(nginxBinary))
    throw new Error("An actual task-scoped nginx binary is required");
  const provenance = JSON.parse(
    readFileSync(resolve(assets, "provenance.json"), "utf8"),
  ) as {
    publicationDate: string;
    hashes: Record<string, string>;
    commit: string;
  };
  for (const [name, digest] of Object.entries(provenance.hashes))
    expect(sha(readFileSync(resolve(assets, name)))).toBe(digest);
  const legal = readFileSync(resolve(assets, "privacy-policy.txt"), "utf8");
  const consentVersion = `${provenance.publicationDate}.sha256-${sha(legal)}`;
  const restored = new Map<string, string | undefined>();
  const set = (key: string, value: string | undefined) => {
    restored.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  const restore = () => {
    for (const [key, value] of restored) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const eventId = randomUUID();
  for (const key of [
    "AUDIT_IDENTIFIER_PEPPER",
    "LIFECYCLE_IMPACT_TOKEN_SECRET",
  ])
    if (!process.env[key]) set(key, randomBytes(32).toString("hex"));
  for (const [key, value] of Object.entries({
    REDIS_URL: undefined,
    UNLEASH_URL: undefined,
    BOT_PROTECTION_ENABLED: "false",
    TRUSTED_PROXIES: "127.0.0.1/32",
    CONGRESS_SIGNUP_EVENT_ID: eventId,
    CONGRESS_SIGNUP_CONSENT_VERSION: consentVersion,
    CONGRESS_SIGNUP_WINDOW_OPENS_AT: OPENS,
    CONGRESS_SIGNUP_WINDOW_CLOSES_AT: CLOSES,
    CONGRESS_SIGNUP_EVENT_DAYS: "2027-04-23,2027-04-24",
    CONGRESS_SIGNUP_EVENT_VENUE: "Москва, тестовая площадка",
    CONGRESS_SIGNUP_TIMING_FLOOR_MS: "0",
  }))
    set(key, value);
  apiRequire("reflect-metadata");
  const { Test } = apiRequire("@nestjs/testing"),
    { FastifyAdapter } = apiRequire("@nestjs/platform-fastify"),
    { VersioningType } = apiRequire("@nestjs/common");
  const { AppModule } = await load("app.module.js"),
    { IDP_CLIENT } = await load("auth/idp/idp.types.js"),
    { FakeIdpClient } = await load("auth/idp/idp.fake.js"),
    { MAILER } = await load("mailer/mailer.types.js"),
    { FakeMailer } = await load("mailer/mailer.fake.js"),
    { CONGRESS_SIGN_UP_CLOCK } = await load(
      "congress/congress-signup.tokens.js",
    ),
    { resolveTrustProxy } = await load("config/trust-proxy.js"),
    { DRIZZLE_POOL } = await load("database/database.tokens.js");
  let now = new Date("2026-11-01T10:00:00+03:00");
  const mailer = new FakeMailer(),
    fake = new FakeIdpClient(mailer);
  congressOperation(
    "compile actual AppModule; override external FakeIdpClient/FakeMailer and injected CONGRESS_SIGN_UP_CLOCK only; native memory stores REDIS_URL absent",
  );
  let app;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDP_CLIENT)
      .useValue(fake)
      .overrideProvider(MAILER)
      .useValue(mailer)
      .overrideProvider(CONGRESS_SIGN_UP_CLOCK)
      .useValue(() => now)
      .compile();
    app = module.createNestApplication(
      new FastifyAdapter({ trustProxy: resolveTrustProxy(process.env) }),
      { logger: false },
    );
  } catch (error) {
    restore();
    throw error;
  }
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  const seen: { url: string; ip: string; xff: unknown }[] = [];
  app
    .getHttpAdapter()
    .getInstance()
    .addHook(
      "onRequest",
      async (r: {
        url: string;
        ip: string;
        headers: Record<string, unknown>;
      }) => {
        seen.push({ url: r.url, ip: r.ip, xff: r.headers["x-forwarded-for"] });
      },
    );
  const pool = app.get(DRIZZLE_POOL) as DrizzleHandle["pool"];
  const query = pool.query.bind(pool);
  pool.query = ((...args: Parameters<typeof pool.query>) => {
    congressOperation(
      typeof args[0] === "string" ? args[0] : "PG query (parameters redacted)",
    );
    return query(...args);
  }) as typeof pool.query;
  const manifest: {
    title: string;
    database: string;
    apiPid: number;
    eventId: string;
    actors: unknown[];
    cookies: unknown[];
    forms: unknown[];
    nonces: unknown[];
    rateKeys: string[];
    handoffKeys: string[];
    nginxPid?: number;
    nginxPort?: number;
    apiPort?: number;
    configHash?: string;
  } = {
    title,
    database: expected!,
    apiPid: process.pid,
    eventId,
    actors: [],
    cookies: [],
    forms: [],
    nonces: [],
    rateKeys: [],
    handoffKeys: [],
  };
  const save = () =>
    writeFileSync(
      resolve(dir, "resources.json"),
      JSON.stringify(manifest, null, 2),
    );
  save();
  let nginx: ReturnType<typeof spawn> | undefined;
  try {
    expect(
      (await pool.query("SELECT current_database() AS database")).rows,
    ).toEqual([{ database: expected }]);
    const { SEED_EVENT_KINDS } = await import(
      pathToFileURL(resolve(root, "packages/db/dist/seed/golden/index.js")).href
    );
    await pool.query(
      `INSERT INTO events(id,slug,title,school,starts_at,duration_min,description,specialties,partner_ref,state,venue,kind_id,audience,participation_format) VALUES($1,$2,'Конгресс-2027','Конгресс','2027-04-23T06:00:00Z',480,'Ежегодный конгресс',ARRAY['cardiology'],'sponsor:congress','published','Москва, тестовая площадка',$3,'experts','offline')`,
      [eventId, `congress-3974-${eventId}`, SEED_EVENT_KINDS.vstrechaKluba.id],
    );
    congressOperation("BIND actual API on OS-allocated owned loopback port");
    await app.listen(0, "127.0.0.1");
    const apiPort = app.getHttpAdapter().getInstance().server.address()
      .port as number;
    manifest.apiPort = apiPort;
    congressOperation("bind/release OS-allocated nginx port probe");
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r, j) => probe.close((e) => (e ? j(e) : r())));
    manifest.nginxPort = port;
    mkdirSync(resolve(dir, "privacy"));
    copyFileSync(
      resolve(assets, "privacy.html"),
      resolve(dir, "privacy/index.html"),
    );
    const source = readFileSync(resolve(assets, "owning-nginx.conf"), "utf8");
    const start = source.indexOf("    location = /api/v1/congress/sign-up {");
    const end = source.indexOf("    location = /api/v1/public/specialties {");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = source
      .slice(start, end)
      .replace(
        "https://api.doctor.school/v1/congress/sign-up",
        `http://127.0.0.1:${apiPort}/v1/congress/sign-up`,
      )
      .replace(/^.*proxy_ssl_.*\n/gm, "");
    const posix = dir.replaceAll("\\", "/");
    const config = `daemon off;\nworker_processes 1;\nerror_log ${posix}/error.log;\npid ${posix}/nginx.pid;\nevents {worker_connections 128;}\nhttp {access_log ${posix}/access.log; server {listen 127.0.0.1:${port}; server_name orthobio.ru; root ${posix}; index index.html;\n${block}\nlocation / {try_files $uri $uri/ =404;}\n}}\n`;
    const configPath = resolve(dir, "nginx.conf");
    writeFileSync(configPath, config);
    manifest.configHash = sha(config);
    save();
    writeFileSync(
      resolve(dir, "adaptation.json"),
      JSON.stringify(
        {
          sourceSha256: sha(source),
          configSha256: sha(config),
          changes: [
            "environment server envelope/listen/static root",
            "upstream local HTTP address and removal of upstream-only TLS directives",
          ],
          originalLocation: source.slice(start, end),
          adaptedLocation: block,
        },
        null,
        2,
      ),
    );
    congressOperation(
      "nginx -t using exact owned prefix/config, then START owned nginx",
    );
    execFileSync(nginxBinary, ["-t", "-p", posix + "/", "-c", configPath], {
      windowsHide: true,
      stdio: "pipe",
    });
    nginx = spawn(nginxBinary, ["-p", posix + "/", "-c", configPath], {
      windowsHide: true,
      stdio: "ignore",
    });
    manifest.nginxPid = nginx.pid!;
    save();
    const rate = await load("auth/rate-limit/rate-limit.types.js"),
      { RateLimitService } = await load(
        "auth/rate-limit/rate-limit.service.js",
      );
    const store = app.get(RateLimitService).store,
      consume = store.consume.bind(store);
    store.consume = async (
      windows: { key: string; limit: number; windowMs: number }[],
      ms: number,
    ) => {
      for (const w of windows) {
        if (!manifest.rateKeys.includes(w.key)) manifest.rateKeys.push(w.key);
        if (w.key.startsWith("ip:congress:sign-up")) {
          expect(w.limit).toBe(60);
          expect(w.windowMs).toBe(900000);
        }
      }
      save();
      return consume(windows, ms);
    };
    const clientIp = "127.39.74.3";
    async function http(
      path: string,
      payload?: Record<string, unknown>,
      client = clientIp,
    ): Promise<CongressResponse> {
      congressOperation(
        `${payload ? "POST" : "GET"} actual owned nginx ${path}; owned client ${client}`,
      );
      return new Promise((res, rej) => {
        const r = request(
          {
            hostname: "127.0.0.1",
            port,
            path,
            method: payload ? "POST" : "GET",
            localAddress: client,
            headers: { "content-type": "application/json" },
          },
          (reply) => {
            let body = "";
            reply.on("data", (part) => (body += part));
            reply.on("end", () =>
              res({
                status: reply.statusCode!,
                body: path === "/privacy/" ? { html: body } : JSON.parse(body),
                retryAfter: reply.headers["retry-after"] as string | undefined,
              }),
            );
          },
        );
        r.on("error", rej);
        r.end(payload ? JSON.stringify(payload) : undefined);
      });
    }
    await expect
      .poll(
        async () => {
          try {
            return (await http("/privacy/")).status;
          } catch {
            return 0;
          }
        },
        { timeout: 5000 },
      )
      .toBe(200);
    const handoffs = app.get(
      (await load("auth/login-handoff/login-handoff.store.js"))
        .LOGIN_HANDOFF_STORE,
    );
    const specialty =
      (await pool.query("SELECT id FROM specialties_minzdrav LIMIT 1")).rows[0]
        ?.id ?? randomUUID();
    const payload = (email: string, extra: Record<string, unknown> = {}) => ({
      surname: "Иванова",
      firstName: "Мария",
      patronymic: "Петровна",
      email,
      specialtyId: specialty,
      workplace: "ГКБ №1",
      city: "Москва",
      region: "Москва",
      contactPhone: "+7 (900) 123-45-67",
      personalDataConsent: true,
      ...extra,
    });
    async function post(email: string, extra: Record<string, unknown> = {}) {
      const response = await http(
        "/api/v1/congress/sign-up",
        payload(email, extra),
      );
      manifest.handoffKeys = handoffs.storedKeys();
      manifest.actors = (
        await pool.query(
          "SELECT id,zitadel_sub,email FROM users WHERE email=$1 OR id IN(SELECT user_id FROM registrations WHERE event_id=$2)",
          [email, eventId],
        )
      ).rows;
      save();
      return response;
    }
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          ["users", "registrations", "consent_records"].map(async (table) => [
            table,
            (
              await pool.query(
                `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`,
              )
            ).rows,
          ]),
        ),
      );
    const mails = () =>
      Object.fromEntries(
        Object.entries(mailer)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => [k, (v as unknown[]).length]),
      );
    let before: unknown,
      mailBefore: unknown,
      response: CongressResponse | undefined;
    const unknown = `unknown-3974-${randomUUID()}@example.org`,
      known = `known-3974-${randomUUID()}@example.org`;
    const receipt = (clause: string) =>
      appendFileSync(
        resolve(congressDirectory(), "backgrounds.jsonl"),
        JSON.stringify({ title, clause, eventId, verified: true }) + "\n",
      );
    return {
      pool,
      eventId,
      dir,
      consentVersion,
      async background(index: number) {
        if (index === 0)
          expect(
            (
              await pool.query(
                "SELECT state,participation_format FROM events WHERE id=$1",
                [eventId],
              )
            ).rows,
          ).toEqual([{ state: "published", participation_format: "offline" }]);
        if (index === 1) {
          const r = await http("/api/v1/congress/sign-up", {});
          expect(r.status).toBe(400);
          expect(nginx!.exitCode).toBeNull();
          expect(seen.at(-1)?.url).toBe("/v1/congress/sign-up");
        }
        if (index === 2) {
          expect(resolveTrustProxy(process.env)).toEqual(["127.0.0.1/32"]);
          expect(seen.at(-1)).toMatchObject({ ip: clientIp, xff: clientIp });
        }
        if (index === 3) {
          const { CongressSignUpController } = await load(
            "congress/congress-signup.controller.js",
          );
          const handler = CongressSignUpController.prototype.signUp;
          expect(Reflect.getMetadata("ds:public", handler)).toBe(true);
          expect(Reflect.getMetadata("ds:bot-protected", handler)).toBe(
            "congress-sign-up",
          );
          expect(Reflect.getMetadata(rate.RATE_LIMITED_KEY, handler)).toBe(
            rate.CONGRESS_SIGN_UP_RATE_LIMIT_SCOPE,
          );
          const snap = await snapshot(),
            counts = mails();
          for (let n = 0; n < 61; n++) {
            const r = await http("/api/v1/congress/sign-up", {}, "127.39.74.4");
            expect(r.status).toBe(n < 60 ? 400 : 429);
            if (n === 60) {
              expect(Number(r.retryAfter)).toBeGreaterThan(0);
              expect(Number(r.retryAfter)).toBeLessThanOrEqual(900);
            }
          }
          expect(await snapshot()).toEqual(snap);
          expect(mails()).toEqual(counts);
        }
        if (index === 4) {
          const { resolveCongressSignUpWindow } = await load(
            "congress/congress-signup.config.js",
          );
          expect(
            resolveCongressSignUpWindow(now, {
              opensAt: OPENS,
              closesAt: CLOSES,
            }),
          ).toEqual({ state: "open" });
        }
        if (index === 5) {
          const r = await http("/privacy/");
          expect(r.status).toBe(200);
          const html = String(r.body.html);
          expect(sha(html)).toBe(provenance.hashes["privacy.html"]);
          const text = html
            .replace(/<[^>]*>/g, " ")
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/\s+/g, " ");
          for (const line of legal.split("\n").filter((s) => s.trim()))
            expect(text).toContain(line.trim().replace(/\s+/g, " "));
          expect(consentVersion).toBe(
            `2026-09-23.sha256-${provenance.hashes["privacy-policy.txt"]}`,
          );
        }
        receipt(congressBackgrounds[index]!);
      },
      async window(side: "before" | "after") {
        expect((await post(known)).status).toBe(200);
        now = new Date(
          side === "before"
            ? "2026-09-01T10:00:00+03:00"
            : "2027-02-01T10:00:00+03:00",
        );
        before = await snapshot();
        mailBefore = mails();
      },
      async absent(email: string) {
        expect(
          (await pool.query("SELECT id FROM users WHERE email=$1", [email]))
            .rowCount,
        ).toBe(0);
      },
      async submit() {
        response = await post(unknown);
      },
      async refuse(code: string) {
        expect(response?.status).toBe(422);
        expect(response?.body.code).toBe(code);
        if (code === "not-yet-open") expect(response?.body.opensAt).toBe(OPENS);
      },
      async unchanged() {
        expect(await snapshot()).toEqual(before);
      },
      async noMail() {
        expect(mails()).toEqual(mailBefore);
      },
      async identical() {
        const same = await post(known);
        expect(same.status).toBe(response?.status);
        expect(same.body).toEqual(response?.body);
        await this.unchanged();
        await this.noMail();
      },
      async names(
        email: string,
        surname: string,
        firstName: string,
        patronymic: string,
        workplace: string,
      ) {
        response = await post(email, {
          surname,
          firstName,
          patronymic,
          workplace,
        });
        expect(response.status).toBe(200);
        expect(response.body.status).toBe("accepted");
      },
      async answers() {
        const rows = (
          await pool.query(
            "SELECT r.answers,u.display_name FROM registrations r JOIN users u ON u.id=r.user_id WHERE r.event_id=$1 AND u.email='names@example.org'",
            [eventId],
          )
        ).rows;
        expect(rows).toHaveLength(1);
        return rows[0]!;
      },
      async close() {
        save();
        congressOperation(
          "CAPTURE exact actors/cookies/forms/nonces/native rate and handoff keys BEFORE app close; then quit owned nginx and actual AppModule",
        );
        execFileSync(
          nginxBinary,
          ["-s", "quit", "-p", posix + "/", "-c", configPath],
          { windowsHide: true, stdio: "pipe" },
        );
        await app.close();
        restore();
      },
    };
  } catch (error) {
    save();
    if (nginx) {
      congressOperation("quit failed owned nginx fixture");
      try {
        execFileSync(
          nginxBinary,
          ["-s", "quit", "-p", dir + "/", "-c", resolve(dir, "nginx.conf")],
          { stdio: "pipe", windowsHide: true },
        );
      } catch {
        /* Preserve startup failure. */
      }
    }
    await app.close();
    restore();
    throw error;
  }
}
export type CongressWorld = Awaited<ReturnType<typeof bootCongress>>;
