import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { DrizzleHandle } from "@ds/db";
import { chooseEventClassification } from "../admin/event-classification.js";
import { openEventLive } from "../admin/events.js";
import { seedStorefrontSession } from "./storefront-session-seed.js";
import {
  eventCountBackgrounds,
  type CountBackground,
  type CountResource,
} from "./event-count-report.js";

export const countRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const apiRequire = createRequire(resolve(countRoot, "apps/api/package.json"));
const load = (name: string) =>
  import(pathToFileURL(resolve(countRoot, "apps/api/dist", `${name}.js`)).href);
type Row = Record<string, unknown>;
const sha = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF");
export function countDirectory(): string {
  const directory = process.env.E2E_EVENT_COUNT_DIR;
  if (!directory)
    throw new Error(
      "E2E_EVENT_COUNT_DIR must name a fresh private attempt directory",
    );
  mkdirSync(directory, { recursive: true });
  return directory;
}
export function countOperation(command: string, facts: Row = {}) {
  const row =
    JSON.stringify({
      at: new Date().toISOString(),
      phase: "pre",
      command,
      ...facts,
    }) + "\n";
  appendFileSync(resolve(countDirectory(), "ops.jsonl"), row);
  if (process.env.E2E_EVENT_COUNT_OPS_LOG)
    appendFileSync(process.env.E2E_EVENT_COUNT_OPS_LOG, row);
}
function capture(name: string, value: unknown) {
  writeFileSync(
    resolve(countDirectory(), name),
    JSON.stringify(value, null, 2),
  );
}
interface App {
  listen(options: { port: number; host: string }): Promise<void>;
  get<T>(token: unknown): T;
  getUrl(): Promise<string>;
  close(): Promise<void>;
}
interface Admin {
  startLogin(
    email: string,
    password: string,
    fingerprint: string,
  ): Promise<{ status: string; cookie: string }>;
  upgradePending(
    ref: string,
    fingerprint: string,
  ): Promise<
    | {
        principal: { sub: string; roles: string[]; sid: string };
        cookies: string[];
      }
    | undefined
  >;
  forceLogout(sub: string): Promise<void>;
}
interface Idp {
  createUser(input: {
    email: string;
    password: string;
  }): Promise<{ sub: string; alreadyExisted: boolean }>;
  markEmailVerified(sub: string): Promise<boolean>;
  grantProjectRole(sub: string, role: string): Promise<void>;
}
interface Storage {
  getBytes(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
interface Sessions {
  getBySid(sid: string): Promise<{ sub: string; roles: string[] } | undefined>;
  logout(sid: string): Promise<unknown>;
}
function digestTree(directory: string): string {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return sha(
    entries
      .map(
        (entry) =>
          `${entry.name}:${entry.isDirectory() ? digestTree(resolve(directory, entry.name)) : sha(readFileSync(resolve(directory, entry.name)))}`,
      )
      .join("\n"),
  );
}

export async function bootEventCountApi() {
  const databaseUrl = process.env.E2E_EVENT_COUNT_DATABASE_URL;
  if (
    !databaseUrl ||
    !/^\/ds_(dev|probe)_4035$/.test(new URL(databaseUrl).pathname)
  )
    throw new Error("4035 requires its exact owned database");
  const previous = new Map<string, string | undefined>();
  const set = (key: string, value: string) => {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  };
  set("DATABASE_URL", databaseUrl);
  set("RECONCILE_SWEEP_INTERVAL_MS", "0");
  for (const key of [
    "AUDIT_IDENTIFIER_PEPPER",
    "LIFECYCLE_IMPACT_TOKEN_SECRET",
  ])
    if (!process.env[key]) set(key, randomBytes(32).toString("hex"));
  countOperation(
    "git HEAD and clean shipping source binding before native boot",
  );
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: countRoot,
    encoding: "utf8",
  }).trim();
  expect(
    execFileSync(
      "git",
      [
        "diff",
        "HEAD",
        "--",
        "apps/api/src",
        "packages/schemas/src",
        "packages/db/src",
      ],
      { cwd: countRoot, encoding: "utf8" },
    ),
  ).toBe("");
  const sourcePaths = execFileSync(
    "git",
    ["ls-files", "apps/api/src", "packages/schemas/src", "packages/db/src"],
    { cwd: countRoot, encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/);
  const sourceHashes = Object.fromEntries(
    sourcePaths.map((path) => [
      path,
      sha(readFileSync(resolve(countRoot, path))),
    ]),
  );
  apiRequire("reflect-metadata");
  const { createApiApplication } = await load("api-application");
  countOperation(
    "START compiled shipping createApiApplication on OS-allocated free loopback port",
    {
      pid: process.pid,
      root: countRoot,
      head,
      database: new URL(databaseUrl).pathname,
    },
  );
  const app = (await createApiApplication({
    logger: ["error", "warn"],
  })) as App;
  try {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const url = await app.getUrl();
    set("INTERNAL_API_URL", url);
    const { DRIZZLE_POOL } = await load("database/database.tokens");
    const pool = app.get<DrizzleHandle["pool"]>(DRIZZLE_POOL);
    const query = async (sql: string, parameters: unknown[] = []) => {
      countOperation("SQL on owning native API pool", { sql });
      return pool.query(sql, parameters);
    };
    const binding = (
      await query(
        "SELECT current_database() AS database, pg_backend_pid() AS backend_pid, (SELECT oid FROM pg_database WHERE datname=current_database()) AS database_oid",
      )
    ).rows[0] as Row;
    expect(`/${binding.database}`).toBe(new URL(databaseUrl).pathname);
    const { IDP_CLIENT } = await load("auth/idp/idp.types");
    const { AdminSessionService } = await load(
      "auth/admin-session/admin-session.service",
    );
    const { SessionService } = await load("auth/session/session.service");
    const { OBJECT_STORAGE } = await load("storage/storage.types");
    const { computeFingerprint } = await load("auth/session/session.cookie");
    const provenance = {
      head,
      pid: process.pid,
      root: countRoot,
      url,
      ...binding,
      compiledApi: digestTree(resolve(countRoot, "apps/api/dist")),
      sourceHashes,
      adminAssets: digestTree(resolve(countRoot, "apps/admin/.next/static")),
    };
    capture("provenance.json", provenance);
    countOperation("native listener/database/source binding", {
      ...binding,
      pid: process.pid,
      url,
      head,
      compiledApi: provenance.compiledApi,
    });
    return {
      app,
      url,
      head,
      database: String(binding.database),
      query,
      idp: app.get<Idp>(IDP_CLIENT),
      admin: app.get<Admin>(AdminSessionService),
      sessions: app.get<Sessions>(SessionService),
      storage: app.get<Storage>(OBJECT_STORAGE),
      computeFingerprint,
      async close() {
        countOperation(
          "CLOSE exact owned compiled API and restore worker environment",
          { pid: process.pid, url },
        );
        await app.close();
        for (const [key, value] of previous) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      },
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}
export type CountApi = Awaited<ReturnType<typeof bootEventCountApi>>;

export class EventCountWorld {
  readonly adminRoles: string[] = [];
  readonly doctorRoles: string[] = [];
  readonly events = new Map<string, { msk: string; ref: string }>();
  readonly subjects: string[] = [];
  readonly backgrounds: CountBackground[] = [];
  readonly ua = "EventCount4035/1.0";
  readonly language = "ru-RU";
  adminSub = "";
  doctorSub = "";
  doctorCookie = "";
  pendingMsk = "";
  backgroundId = "";
  eventId = "";
  observedCount: number | null = null;
  persisted = false;
  reopened = false;
  constructor(
    readonly api: CountApi,
    readonly page: Page,
    readonly title: string,
    readonly ordinal: number,
  ) {}
  async initialize(context: BrowserContext) {
    const adminOrigin = new URL(process.env.E2E_ADMIN_URL!).origin;
    const target = new URL(this.api.url);
    target.hostname = new URL(adminOrigin).hostname;
    await context.route(
      (url) => url.origin === adminOrigin && url.pathname.startsWith("/v1/"),
      async (route) => {
        const request = route.request();
        const source = new URL(request.url());
        const destination = target.origin + source.pathname + source.search;
        countOperation(
          "URL-only browser transport; method/body/headers/session unchanged",
          {
            method: request.method(),
            source: source.origin + source.pathname,
            target: target.origin + source.pathname,
            queryHash: sha(source.search),
            bodyHash: sha(request.postDataBuffer() ?? Buffer.alloc(0)),
            database: this.api.database,
          },
        );
        await route.continue({ url: destination });
      },
    );
    const create = async (role: "platform_admin" | "doctor_guest") => {
      const email = `count4035-${this.ordinal}-${role}-${randomUUID()}@ds.test`,
        password = `Aa1!${randomUUID()}`;
      countOperation("create unique exact owned IdP fixture account", { role });
      const created = await this.api.idp.createUser({ email, password });
      expect(created.alreadyExisted).toBe(false);
      expect(created.sub).toBeTruthy();
      this.subjects.push(created.sub);
      appendFileSync(
        resolve(countDirectory(), "dynamic-secrets.private.jsonl"),
        JSON.stringify({ email, password, sub: created.sub }) + "\n",
      );
      countOperation("native fixture email verification and project role", {
        sub: created.sub,
        role,
      });
      await this.api.idp.markEmailVerified(created.sub);
      await this.api.idp.grantProjectRole(created.sub, role);
      return { email, password, sub: created.sub };
    };
    const operator = await create("platform_admin");
    this.adminSub = operator.sub;
    const fingerprint = this.api.computeFingerprint({
      userAgent: this.ua,
      acceptLanguage: this.language,
      ip: "127.0.0.1",
    });
    let pending: Awaited<ReturnType<Admin["startLogin"]>>;
    countOperation(
      "standard native AdminSessionService fixture startLogin/upgradePending; no factor acceptance",
      { sub: this.adminSub },
    );
    await expect
      .poll(
        async () => {
          pending = await this.api.admin.startLogin(
            operator.email,
            operator.password,
            fingerprint,
          );
          return pending.status;
        },
        { timeout: 20_000, intervals: [1000, 2000] },
      )
      .toBe("pending");
    const ref = pending!.cookie.split(";")[0]!.split("=")[1]!;
    const upgraded = await this.api.admin.upgradePending(ref, fingerprint);
    expect(upgraded).toBeDefined();
    this.adminRoles.push(...upgraded!.principal.roles);
    expect(this.adminRoles).toContain("platform_admin");
    expect(upgraded!.principal.sub).toBe(this.adminSub);
    appendFileSync(
      resolve(countDirectory(), "dynamic-secrets.private.jsonl"),
      JSON.stringify({ cookies: upgraded!.cookies }) + "\n",
    );
    await context.addCookies(
      upgraded!.cookies.map((cookie) => {
        const [name, value] = cookie.split(";")[0]!.split("=");
        return {
          name: name!,
          value: value!,
          domain: new URL(adminOrigin).hostname,
          path: "/",
          secure: true,
          httpOnly: name!.endsWith("_session"),
          sameSite: "Strict" as const,
        };
      }),
    );
    const doctor = await create("doctor_guest");
    this.doctorSub = doctor.sub;
    countOperation(
      "actual storefront session-seed fixture through native OIDC transaction/redeem",
      { sub: this.doctorSub },
    );
    const cookie = await seedStorefrontSession({
      email: doctor.email,
      password: doctor.password,
      client: "doctor",
      fingerprint: { userAgent: this.ua, acceptLanguage: this.language },
    });
    this.doctorCookie = `${cookie.name}=${cookie.value}`;
    countOperation("own native doctor session identity/roles read", {
      sub: this.doctorSub,
    });
    const session = await this.api.sessions.getBySid(cookie.value);
    expect(session).toBeDefined();
    expect(session!.sub).toBe(this.doctorSub);
    expect(session!.roles).toEqual(["doctor_guest"]);
    this.doctorRoles.push(...session!.roles);
    appendFileSync(
      resolve(countDirectory(), "dynamic-secrets.private.jsonl"),
      JSON.stringify({ doctorCookie: this.doctorCookie }) + "\n",
    );
    await this.page.goto("/events/create");
    await expect(this.page.getByTestId("event-form")).toBeVisible();
    this.backgroundId = await this.createEvent("Background", true);
    await openEventLive(this.page);
    expect(
      (await this.doctor("POST", this.backgroundId, "registration")).body
        .registered,
    ).toBe(true);
    expect(
      (await this.doctor("POST", this.backgroundId, "heartbeat")).body
        .presenceCount,
    ).toBeNull();
  }
  async createEvent(name: string, publish: boolean): Promise<string> {
    await this.fillCreateForm(name);
    const id = await this.saveNewEvent(name);
    if (publish) await this.publish(id);
    return id;
  }
  async fillCreateForm(name: string) {
    countOperation("actual Admin create form; count defaults untouched", {
      title: this.title,
      purpose: name,
    });
    await this.page.goto("/events/create");
    await expect(this.page.getByTestId("event-form")).toBeVisible();
    await expect(this.page.getByTestId("hide-sign-up-count")).toBeChecked();
    await expect(
      this.page.getByTestId("show-presence-count"),
    ).not.toBeChecked();
    const msk = new Date(Date.now() + 60_000 + 3 * 3600_000)
      .toISOString()
      .slice(0, 16);
    this.pendingMsk = msk;
    await this.page.locator("#title").fill(`4035 ${name} ${randomUUID()}`);
    await this.page.locator("#school").fill("Кардиология");
    await this.page.locator("#startsAtMsk").fill(msk);
    await this.page.locator("#durationMin").fill("90");
    await this.page
      .getByTestId("program-pdf")
      .setInputFiles({
        name: "program.pdf",
        mimeType: "application/pdf",
        buffer: PDF,
      });
    await chooseEventClassification(this.page, { audience: "experts" });
  }
  async saveNewEvent(name: string): Promise<string> {
    countOperation("actual operator saves untouched create form", {
      title: this.title,
      purpose: name,
    });
    const msk = this.pendingMsk;
    await this.page.getByTestId("submit-event").click();
    await this.page.waitForURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    const id = this.page.url().split("/").pop()!;
    const row = (
      await this.api.query(
        "SELECT program_pdf_ref,starts_at,state,hide_sign_up_count,show_presence_count,origin FROM events WHERE id=$1",
        [id],
      )
    ).rows[0] as Row;
    expect(row.state).toBe("draft");
    expect(row.origin).toBe("platform");
    expect(row.hide_sign_up_count).toBe(true);
    expect(row.show_presence_count).toBe(false);
    expect((row.starts_at as Date).toISOString()).toBe(
      new Date(`${msk}:00+03:00`).toISOString(),
    );
    this.events.set(id, { msk, ref: String(row.program_pdf_ref) });
    countOperation(
      "reserved actual API-created case/Background event and PDF",
      { title: this.title, purpose: name, id, ref: row.program_pdf_ref },
    );
    return id;
  }
  async publish(id: string) {
    countOperation(
      "supporting public eligibility: browser publish same event",
      { id },
    );
    await this.page.goto(`/events/${id}`);
    await this.page.getByTestId("action-publish").click();
    await expect(this.page.getByTestId("state-published")).toBeVisible();
  }
  async detail(id: string): Promise<Row> {
    const read = await this.page.evaluate(async (eventId) => {
      const response = await fetch(`/v1/admin/events/${eventId}`);
      return { status: response.status, body: await response.json() };
    }, id);
    expect(read.status).toBe(200);
    return read.body as Row;
  }
  async doctor(
    method: "GET" | "POST",
    id: string,
    action: string,
  ): Promise<{ status: number; body: Row }> {
    countOperation("actual non-staff registered-doctor HTTP", {
      method,
      id,
      action,
      sub: this.doctorSub,
    });
    const response = await fetch(`${this.api.url}/v1/events/${id}/${action}`, {
      method,
      headers: {
        "user-agent": this.ua,
        "accept-language": this.language,
        cookie: this.doctorCookie,
      },
    });
    const body = (await response.json()) as Row;
    appendFileSync(
      resolve(countDirectory(), "http-responses.private.jsonl"),
      JSON.stringify({
        title: this.title,
        method,
        id,
        action,
        status: response.status,
        body,
      }) + "\n",
    );
    expect(response.status, `native ${action}`).toBe(200);
    return { status: response.status, body };
  }
  async publicRead(id: string) {
    countOperation("public page and listing owning reads", { id });
    const page = await fetch(`${this.api.url}/v1/public/events/${id}`);
    const pageBody = (await page.json()) as Row;
    const list = await fetch(
      `${this.api.url}/v1/public/events?timeframe=upcoming`,
    );
    const listBody = (await list.json()) as { data: Row[] };
    expect(page.status).toBe(200);
    expect(list.status).toBe(200);
    const card = listBody.data.find((row) => row.id === id);
    expect(card).toBeDefined();
    return {
      pageStatus: page.status,
      pageBody,
      listStatus: list.status,
      card: card!,
    };
  }
  receipt(clause: (typeof eventCountBackgrounds)[number], evidence: Row) {
    const row: CountBackground = {
      title: this.title,
      clause,
      order: this.backgrounds.length,
      head: this.api.head,
      database: this.api.database,
      eventId: this.backgroundId,
      adminSub: this.adminSub,
      doctorSub: this.doctorSub,
      evidence,
    };
    expect(eventCountBackgrounds[row.order]).toBe(clause);
    this.backgrounds.push(row);
    appendFileSync(
      resolve(countDirectory(), "backgrounds.jsonl"),
      JSON.stringify(row) + "\n",
    );
  }
  async background(clause: (typeof eventCountBackgrounds)[number]) {
    if (clause === "admin") {
      const read = await this.page.evaluate(async () => {
        const r = await fetch("/v1/admin/auth/me");
        return { status: r.status, body: await r.json() };
      });
      expect(read.status).toBe(200);
      await expect(this.page.getByTestId("event-form")).toBeVisible();
      this.receipt(clause, {
        status: read.status,
        roles: this.adminRoles,
        origin: new URL(this.page.url()).origin,
      });
    }
    if (clause === "pdf") {
      const ref = this.events.get(this.backgroundId)!.ref;
      countOperation(
        "GET exact actual browser-uploaded PDF through native storage adapter",
        { id: this.backgroundId, ref },
      );
      const bytes = await this.api.storage.getBytes(ref);
      expect(bytes).toEqual(PDF);
      this.receipt(clause, {
        status: 200,
        bytes: bytes!.length,
        sha256: sha(bytes!),
      });
    }
    if (clause === "lifecycles") {
      const rows = (
        await this.api.query(
          "SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname='event_lifecycle_state' ORDER BY e.enumsortorder",
        )
      ).rows as { enumlabel: string }[];
      const { EventLifecycleStateSchema, validTransitions } = apiRequire(
        "@ds/schemas",
      ) as {
        EventLifecycleStateSchema: { options: string[] };
        validTransitions(state: string, origin: string): string[];
      };
      const states = EventLifecycleStateSchema.options;
      expect(new Set(rows.map((row) => row.enumlabel))).toEqual(
        new Set(states),
      );
      const edges = (origin: string) =>
        states.flatMap((state) =>
          validTransitions(state, origin).map((target) => `${state}>${target}`),
        );
      this.receipt(clause, {
        enum: states,
        platform: edges("platform"),
        legacy: edges("legacy"),
      });
    }
    if (clause === "msk") {
      const row = (
        await this.api.query("SELECT starts_at FROM events WHERE id=$1", [
          this.backgroundId,
        ])
      ).rows[0] as { starts_at: Date };
      this.receipt(clause, {
        msk: this.events.get(this.backgroundId)!.msk,
        instant: row.starts_at.toISOString(),
      });
    }
    if (clause === "consumers") {
      const publicRead = await this.publicRead(this.backgroundId),
        registered = await this.doctor(
          "GET",
          this.backgroundId,
          "registration",
        ),
        room = await this.doctor("GET", this.backgroundId, "room");
      this.receipt(clause, {
        publicStatus: publicRead.pageStatus,
        pageState: publicRead.pageBody.state,
        listingState: publicRead.card.state,
        registrationStatus: registered.status,
        registered: registered.body.registered,
        roomStatus: room.status,
        roomEventId: room.body.eventId,
        roomPresence: room.body.presenceCount,
      });
    }
  }
  async toggleAndSave(testId: string) {
    countOperation("tested operator checkbox change and actual save", {
      title: this.title,
      eventId: this.eventId,
      testId,
    });
    await this.page
      .getByTestId(testId)
      .locator("xpath=ancestor::label[1]")
      .click();
    await this.page.getByTestId("submit-event").click();
    await expect(this.page.getByTestId("edit-ok")).toBeVisible();
  }
  async persistedOption(
    column: "hide_sign_up_count" | "show_presence_count",
    expected: boolean,
  ) {
    const rows = (
      await this.api.query(
        `SELECT ${column} AS value FROM events WHERE id=$1`,
        [this.eventId],
      )
    ).rows;
    expect(rows[0]?.value).toBe(expected);
    this.persisted = expected;
  }
  async reopen(testId: string, checked: boolean) {
    await this.page.goto(`/events/${this.eventId}`);
    await expect(this.page.getByTestId("event-form")).toBeVisible();
    await expect(this.page.getByTestId(testId)).toBeChecked({ checked });
    this.reopened = checked;
  }
  async cleanup() {
    let objectsDeleted = 0;
    try {
      for (const [id, { ref }] of this.events) {
        countOperation(
          "retire exact owned event through actual browser transitions; preserve all rows",
          { id },
        );
        await this.page.goto(`/events/${id}`);
        let detail = await this.detail(id);
        if (detail.state === "draft") {
          await this.publish(id);
          detail = await this.detail(id);
        }
        if (detail.state === "published") {
          await openEventLive(this.page);
          detail = await this.detail(id);
        }
        if (detail.state === "live") {
          await this.page.getByTestId("action-close").click();
          await expect(this.page.getByTestId("state-ended")).toBeVisible();
        }
        await this.page.getByTestId("action-hide").click();
        await expect(this.page.getByTestId("state-hidden")).toBeVisible();
        expect((await this.detail(id)).state).toBe("hidden");
        const witness = (
          await this.api.query(
            "SELECT row_to_json(e) AS event, (SELECT json_agg(r) FROM registrations r WHERE r.event_id=e.id) AS registrations, (SELECT json_agg(b) FROM presence_beats b WHERE b.event_id=e.id) AS beats FROM events e WHERE e.id=$1",
            [id],
          )
        ).rows;
        capture(`retained-${id}.private.json`, witness);
        countOperation(
          "delete exact owned PDF only after retained row witness",
          { id, ref },
        );
        await this.api.storage.delete(ref);
        expect(await this.api.storage.exists(ref)).toBe(false);
        objectsDeleted++;
      }
      if (this.backgrounds.length === 5 && this.eventId) {
        const history = (
          await this.api.query(
            "SELECT (SELECT count(*)::int FROM registrations WHERE event_id=$1) AS registrations,(SELECT count(*)::int FROM presence_beats WHERE event_id=$1) AS beats",
            [this.backgroundId],
          )
        ).rows[0] as { registrations: number; beats: number };
        expect(history.registrations).toBe(1);
        expect(history.beats).toBe(1);
        const resource: CountResource = {
          title: this.title,
          head: this.api.head,
          database: this.api.database,
          eventId: this.eventId,
          backgroundId: this.backgroundId,
          adminSub: this.adminSub,
          doctorSub: this.doctorSub,
          adminRoles: this.adminRoles,
          doctorRoles: this.doctorRoles,
          expectedCount: this.ordinal === 0 ? null : 1,
          observedCount: this.observedCount,
          persisted: this.persisted,
          reopened: this.reopened,
          defaultHidden: true,
          defaultPresence: false,
          registrationCount: history.registrations,
          presenceCount: history.beats,
          cleanup: {
            eventState: "hidden",
            backgroundState: "hidden",
            objectsDeleted,
            registrationsRetained: true,
            beatsRetained: true,
          },
        };
        appendFileSync(
          resolve(countDirectory(), "resources.jsonl"),
          JSON.stringify(resource) + "\n",
        );
      }
    } finally {
      if (this.doctorCookie) {
        countOperation("native logout exact own doctor session");
        await this.api.sessions.logout(this.doctorCookie.split("=")[1]!);
      }
      for (const sub of this.subjects) {
        countOperation(
          "native forceLogout own subject, delete exact owned IdP account",
          { sub },
        );
        await this.api.admin.forceLogout(sub);
        const result = await fetch(
          `${process.env.IDP_ISSUER}/v2/users/${sub}`,
          {
            method: "DELETE",
            headers: {
              authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN}`,
            },
          },
        );
        expect(result.ok).toBe(true);
        const absent = await fetch(
          `${process.env.IDP_ISSUER}/v2/users/${sub}`,
          {
            headers: {
              authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN}`,
            },
          },
        );
        expect([404, 410]).toContain(absent.status);
      }
    }
  }
}
