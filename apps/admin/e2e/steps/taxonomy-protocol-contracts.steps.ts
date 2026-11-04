import { createHash, createHmac, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { Pool, type QueryResultRow } from "pg";

import {
  Before,
  Given,
  Then,
  When,
  test,
  type AdminWorld,
} from "../support/fixtures";

type Answer = {
  status: number;
  body: Record<string, unknown>;
  etag: string | null;
  location: string | null;
  contentType: string | null;
};
type Command = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: Record<string, unknown>;
  key?: string;
  etag?: string;
  files?: string[];
};
type State = {
  prefix: string;
  email?: string;
  id?: string;
  commands?: Command[];
  answers?: Answer[];
  original?: Answer;
  replay?: Answer;
  before?: Awaited<ReturnType<typeof snapshot>>;
  recordBefore?: unknown[];
  record?: Record<string, unknown>;
  winner?: number;
  refusal?: {
    commands: Command[];
    prefixes: string[];
    before?: Awaited<ReturnType<typeof refusalSnapshot>>;
    eventId?: string;
    expertIds?: string[];
    retiredId?: string;
  };
};
const states = new WeakMap<AdminWorld, State>();
function state(world: AdminWorld): State {
  let current = states.get(world);
  if (!current) {
    current = { prefix: `Protocol T ${randomUUID()}` };
    states.set(world, current);
  }
  return current;
}
function operation(op: string, detail?: unknown): void {
  const file =
    process.env.E2E_TAXONOMY_PROTOCOL_LOG ??
    process.env.E2E_CANONICAL_EXPERT_LOG;
  if (file)
    appendFileSync(
      file,
      JSON.stringify({ at: new Date().toISOString(), op, detail }) + "\n",
    );
}

// Observe the real fixture from its FIRST registration, without recording
// request bodies, credentials, cookies or response payloads. A grant can only
// target an exact email/subject created by this scenario.
const originalFetch = globalThis.fetch;
Before(
  { tags: "@taxonomy-protocol-contracts" },
  async ({ context, page, world }) => {
    const startedAt = Date.now();
    const issuer = process.env.IDP_ISSUER?.replace(/\/$/u, "");
    const project = process.env.IDP_PROJECT_ID;
    if (!issuer || !project || !process.env.IDP_SERVICE_TOKEN)
      throw new Error("The real Admin fixture requires the configured IdP");
    const headers = {
      authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN}`,
      "content-type": "application/json",
    };
    async function observed(
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      operation("Node request", {
        method: init?.method ?? "GET",
        path: url.pathname,
      });
      const response = await originalFetch(input, init);
      operation("Node response", {
        method: init?.method ?? "GET",
        path: url.pathname,
        status: response.status,
      });
      return response;
    }
    const rolesPath = `${issuer}/management/v1/projects/${project}/roles/_search`;
    async function sharedRole() {
      const response = await observed(rolesPath, {
        method: "POST",
        headers,
        body: "{}",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: {
          key: string;
          details: { creationDate: string; changeDate: string };
        }[];
      };
      const role = body.result.find((row) => row.key === "platform_admin");
      expect(role).toBeTruthy();
      expect(Date.parse(role!.details.creationDate)).toBeLessThan(startedAt);
      expect(Date.parse(role!.details.changeDate)).toBeLessThan(startedAt);
      return role;
    }
    const retainedRole = await sharedRole();
    operation("shared role before fixture", retainedRole);
    const emails = new Set<string>();
    const subjects = new Set<string>();
    globalThis.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      const granting = /\/users\/([^/]+)\/grants(?:\/[^/]+)?$/u.exec(
        url.pathname,
      );
      if (granting && ["PUT", "POST"].includes(init?.method ?? "GET")) {
        expect(subjects.has(granting[1])).toBe(true);
        expect(body?.projectId).toBe(project);
        expect(body?.roleKeys).toEqual(["platform_admin"]);
        operation("owned grant target verified", {
          subject: granting[1],
          projectId: body?.projectId,
          roleKeys: body?.roleKeys,
        });
      }
      if (url.pathname === "/v1/auth/register")
        operation("owned account attempt", { email: body?.email });
      const response = await observed(input, init);
      if (url.pathname === "/v1/auth/register") {
        expect(response.ok).toBe(true);
        const email = body?.email as string;
        expect(email).toMatch(/^admin-\d+-[a-z0-9]+@ds\.test$/u);
        emails.add(email);
        state(world).email = email;
        operation("owned account created", {
          email,
          createdAfter: new Date(startedAt).toISOString(),
        });
      }
      if (url.pathname === "/management/v1/users/_search" && response.ok) {
        const result = (await response.clone().json()) as {
          result?: { id: string }[];
        };
        for (const { id } of result.result ?? []) {
          const detail = await observed(`${issuer}/v2/users/${id}`, {
            headers,
          });
          expect(detail.status).toBe(200);
          const { user } = (await detail.json()) as {
            user: {
              userId: string;
              human: { email: { email: string } };
              details: { creationDate: string };
            };
          };
          expect(user.userId).toBe(id);
          expect(emails.has(user.human.email.email)).toBe(true);
          expect(Date.parse(user.details.creationDate)).toBeGreaterThanOrEqual(
            startedAt,
          );
          subjects.add(id);
          operation("owned account verified before grant", {
            subject: id,
            email: user.human.email.email,
            createdAt: user.details.creationDate,
          });
        }
      }
      if (
        url.pathname === `/management/v1/projects/${project}/roles` &&
        init?.method === "POST"
      ) {
        // The canonical fixture's ensure must observe an existing shared role.
        expect(response.status).toBe(409);
        expect(await sharedRole()).toEqual(retainedRole);
        operation("shared role unchanged after ensure", retainedRole);
      }
      return response;
    };
    function observePage(target: Page) {
      target.on("request", (request) =>
        operation("browser request", {
          method: request.method(),
          path: new URL(request.url()).pathname,
        }),
      );
      target.on("response", (response) =>
        operation("browser response", {
          method: response.request().method(),
          path: new URL(response.url()).pathname,
          status: response.status(),
        }),
      );
    }
    observePage(page);
    context.on("page", observePage);
  },
);
const { After } = createBdd(test);
After({ tags: "@taxonomy-protocol-contracts" }, async () => {
  globalThis.fetch = originalFetch;
});

async function rows<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  const connection = process.env.DATABASE_URL;
  if (!connection)
    throw new Error("DATABASE_URL must select the Admin database under test");
  const database = decodeURIComponent(new URL(connection).pathname.slice(1));
  if (!["ds_admin_e2e", "ds_dev_3641"].includes(database))
    throw new Error("Protocol fixture requires its exact disposable database");
  operation("SELECT protocol fixture", { sql, values, database });
  const pool = new Pool({ connectionString: connection, max: 1 });
  try {
    expect(
      (await pool.query("SELECT current_database() AS name")).rows[0].name,
    ).toBe(database);
    return (await pool.query<T>(sql, values)).rows;
  } finally {
    await pool.end();
  }
}
function key(): string {
  const value = randomUUID();
  expect(value).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  operation("owned idempotency key", { key: value });
  return value;
}
async function commands(page: Page, inputs: Command[]): Promise<Answer[]> {
  for (const input of inputs)
    operation("protocol request", {
      method: input.method,
      path: input.path,
      key: input.key,
      ifMatch: input.etag ?? null,
    });
  const answers = await page.evaluate(async (inputs) => {
    const csrf = /(?:^|; )__Host-ds_admin_csrf=([^;]*)/u.exec(
      document.cookie,
    )?.[1];
    if (!csrf) throw new Error("No verified Admin CSRF cookie available");
    return Promise.all(
      inputs.map(async (input) => {
        const form = input.files ? new FormData() : undefined;
        if (form) {
          form.append("payload", JSON.stringify(input.body ?? {}));
          // A real, decodable PNG. The successful setup upload also verifies it
          // crosses the normalizer and reaches the configured object store.
          const bytes = Uint8Array.from(
            atob(
              "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWN4ZhTwzCiAAUIBACnGBaFaU04qAAAAAElFTkSuQmCC",
            ),
            (value) => value.charCodeAt(0),
          );
          for (const part of input.files!)
            form.append(
              part,
              new Blob([bytes], { type: "image/png" }),
              "fixture.png",
            );
        }
        const response = await fetch(input.path, {
          method: input.method,
          credentials: "include",
          headers: {
            ...(!form ? { "content-type": "application/json" } : {}),
            "x-ds-admin-csrf": decodeURIComponent(csrf),
            ...(input.key !== undefined
              ? { "idempotency-key": input.key }
              : {}),
            ...(input.etag ? { "if-match": input.etag } : {}),
          },
          ...(form
            ? { body: form }
            : input.body
              ? { body: JSON.stringify(input.body) }
              : {}),
        });
        return {
          status: response.status,
          body: (await response.json()) as Record<string, unknown>,
          etag: response.headers.get("etag"),
          location: response.headers.get("location"),
          contentType: response.headers.get("content-type"),
        };
      }),
    );
  }, inputs);
  for (let index = 0; index < answers.length; index++)
    operation("protocol response", {
      method: inputs[index].method,
      path: inputs[index].path,
      status: answers[index].status,
    });
  return answers;
}
async function create(
  page: Page,
  world: AdminWorld,
  suffix: string,
): Promise<Answer> {
  const [answer] = await commands(page, [
    {
      method: "POST",
      path: "/v1/admin/directions",
      body: { title: `${state(world).prefix} ${suffix}` },
      key: key(),
    },
  ]);
  expect(answer.status).toBe(201);
  expect(answer.body).toMatchObject({ status: "draft", version: 1 });
  expect(answer.etag).toBe('W/"1"');
  operation("owned direction", { id: answer.body.id });
  return answer;
}
async function snapshot(id: string) {
  return {
    domain: await rows(
      "SELECT to_jsonb(d) AS row FROM directions d WHERE id=$1",
      [id],
    ),
    audit: await rows<{ row: Record<string, unknown> }>(
      "SELECT to_jsonb(a) AS row FROM audit_ledger a WHERE metadata->'pk'->>'id'=$1 AND event_type LIKE 'data.directions.%' ORDER BY created_at,id",
      [id],
    ),
  };
}
async function advance(
  page: Page,
  id: string,
  etag: string,
  title: string,
): Promise<Answer> {
  const [answer] = await commands(page, [
    {
      method: "PATCH",
      path: `/v1/admin/directions/${id}`,
      body: { title },
      key: key(),
      etag,
    },
  ]);
  expect(answer.status).toBe(200);
  return answer;
}
async function idempotencyRecord(request: Command) {
  return rows<{ row: Record<string, unknown> }>(
    "SELECT to_jsonb(k) AS row FROM idempotency_keys k WHERE key=$1",
    [request.key],
  );
}

Given(
  "a valid entity create and a valid relationship create each have a new canonical UUID Idempotency-Key",
  async ({ page, world }) => {
    const parent = await create(page, world, "relationship parent");
    const specialties = await rows<{ id: string }>(
      "SELECT id FROM specialties_minzdrav WHERE is_other=false ORDER BY code LIMIT 1",
    );
    expect(specialties).toHaveLength(1);
    state(world).commands = [
      {
        method: "POST",
        path: "/v1/admin/directions",
        body: { title: `${state(world).prefix} entity` },
        key: key(),
      },
      {
        method: "POST",
        path: "/v1/admin/direction-specialties",
        body: {
          directionId: parent.body.id,
          specialtyMinzdravId: specialties[0].id,
        },
        key: key(),
      },
    ];
    expect(state(world).commands!.map((command) => command.etag)).toEqual([
      undefined,
      undefined,
    ]);
    expect(
      new Set(state(world).commands!.map((command) => command.key)).size,
    ).toBe(2);
    for (const command of state(world).commands!)
      expect(await idempotencyRecord(command)).toEqual([]);
  },
);
When("each POST is sent without If-Match", async ({ page, world }) => {
  state(world).answers = await commands(page, state(world).commands!);
});
Then(
  "each create may succeed and returns its representation ETag and Location when applicable",
  async ({ page, world }) => {
    const current = state(world);
    expect(current.answers).toHaveLength(2);
    for (let index = 0; index < current.answers!.length; index++) {
      const answer = current.answers![index];
      const command = current.commands![index];
      expect(answer.status).toBe(201);
      expect(answer.body).toMatchObject({ id: expect.any(String), version: 1 });
      expect(answer.etag).toBe('W/"1"');
      expect(answer.location).toBe(`${command.path}/${answer.body.id}`);
      const [read] = await commands(page, [
        { method: "GET", path: answer.location! },
      ]);
      expect(read.status).toBe(200);
      expect(read.body).toEqual(answer.body);
      expect(read.etag).toBe(answer.etag);
      const records = await idempotencyRecord(command);
      expect(records).toHaveLength(1);
      expect(records[0].row).toMatchObject({
        status: "active",
        execution_state: "completed",
        response_status: 201,
        response_body: answer.body,
        response_etag: answer.etag,
        response_location: answer.location,
      });
    }
    const [entity, relationship] = current.answers!;
    expect(entity.body.title).toBe(current.commands![0].body!.title);
    expect(relationship.body).toMatchObject({
      ...current.commands![1].body,
      status: "active",
    });
    const retained = await rows<{ row: Record<string, unknown> }>(
      "SELECT to_jsonb(r) AS row FROM direction_specialties r WHERE id=$1 AND direction_id=$2 AND specialty_minzdrav_id=$3",
      [
        relationship.body.id,
        relationship.body.directionId,
        relationship.body.specialtyMinzdravId,
      ],
    );
    expect(retained).toHaveLength(1);
    expect(retained[0].row).toMatchObject({ status: "active", version: 1 });
  },
);

Given(
  "an active completed Idempotency-Key whose response stored status, body, ETag and Location",
  async ({ page, world }) => {
    const current = state(world);
    current.commands = [
      {
        method: "POST",
        path: "/v1/admin/directions",
        body: { title: `${current.prefix} replay original` },
        key: key(),
      },
    ];
    [current.original] = await commands(page, current.commands);
    expect(current.original.status).toBe(201);
    current.id = current.original.body.id as string;
    operation("owned direction", { id: current.id });
    const records = await idempotencyRecord(current.commands[0]);
    expect(records).toHaveLength(1);
    current.record = records[0].row;
    expect(current.record).toMatchObject({
      status: "active",
      execution_state: "completed",
      response_status: 201,
      response_body: current.original.body,
      response_etag: current.original.etag,
      response_location: current.original.location,
    });
    expect(current.original.etag).toBe('W/"1"');
    expect(current.original.location).toBe(
      `/v1/admin/directions/${current.id}`,
    );
  },
);
Given(
  "the resource has since advanced beyond that stored ETag",
  async ({ page, world }) => {
    const current = state(world);
    const advanced = await advance(
      page,
      current.id!,
      current.original!.etag!,
      `${current.prefix} advanced`,
    );
    expect(advanced.body.version).toBe(2);
    expect(advanced.etag).toBe('W/"2"');
    expect(advanced.etag).not.toBe(current.original!.etag);
    current.before = await snapshot(current.id!);
    expect(current.before.audit).toHaveLength(2);
    current.recordBefore = await idempotencyRecord(current.commands![0]);
  },
);
When(
  "the same actor repeats the same route and payload with that key",
  async ({ page, world }) => {
    const current = state(world);
    [current.replay] = await commands(page, current.commands!);
  },
);
Then(
  "the original status, body, ETag and Location are replayed without another mutation or audit row",
  async ({ page, world }) => {
    const current = state(world);
    expect(current.replay).toEqual(current.original);
    expect(await snapshot(current.id!)).toEqual(current.before);
    expect(await idempotencyRecord(current.commands![0])).toEqual(
      current.recordBefore,
    );
    const [latest] = await commands(page, [
      { method: "GET", path: current.original!.location! },
    ]);
    expect(latest.status).toBe(200);
    expect(latest.body).toMatchObject({
      id: current.id,
      title: `${current.prefix} advanced`,
      version: 2,
    });
    expect(latest.etag).toBe('W/"2"');
    expect(current.replay!.body.version).toBe(1);
  },
);

Given("another row is at version 3", async ({ page, world }) => {
  const current = state(world);
  const first = await create(page, world, "concurrency original");
  current.id = first.body.id as string;
  const second = await advance(
    page,
    current.id,
    first.etag!,
    `${current.prefix} version two`,
  );
  expect(second.body.version).toBe(2);
  const third = await advance(
    page,
    current.id,
    second.etag!,
    `${current.prefix} version three`,
  );
  expect(third.body.version).toBe(3);
  expect(third.etag).toBe('W/"3"');
  current.before = await snapshot(current.id);
  expect(current.before.audit).toHaveLength(3);
});
When(
  "two different updates both submit If-Match version 3",
  async ({ page, world }) => {
    const current = state(world);
    current.commands = ["first contender", "second contender"].map(
      (suffix) => ({
        method: "PATCH",
        path: `/v1/admin/directions/${current.id}`,
        body: { title: `${current.prefix} ${suffix}` },
        key: key(),
        etag: 'W/"3"',
      }),
    );
    expect(new Set(current.commands.map((command) => command.key)).size).toBe(
      2,
    );
    current.answers = await commands(page, current.commands);
  },
);
Then(
  "exactly one succeeds and increments the row to version 4",
  async ({ page, world }) => {
    const current = state(world);
    expect(current.answers!.map((answer) => answer.status).sort()).toEqual([
      200, 412,
    ]);
    current.winner = current.answers!.findIndex(
      (answer) => answer.status === 200,
    );
    const winner = current.answers![current.winner];
    expect(winner.body).toMatchObject({
      id: current.id,
      title: current.commands![current.winner].body!.title,
      version: 4,
    });
    expect(winner.etag).toBe('W/"4"');
    const [read] = await commands(page, [
      { method: "GET", path: `/v1/admin/directions/${current.id}` },
    ]);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(winner.body);
    expect(read.etag).toBe(winner.etag);
  },
);
Then(
  "the other returns 412 PRECONDITION_FAILED without mutation",
  async ({ world }) => {
    const current = state(world);
    const loser = current.answers![1 - current.winner!];
    expect(loser.status).toBe(412);
    expect(loser.body).toMatchObject({
      errorCode: "PRECONDITION_FAILED",
      traceId: expect.any(String),
    });
    expect(loser.contentType).toContain("application/problem+json");
    const after = await snapshot(current.id!);
    expect(after.domain).toHaveLength(1);
    expect(after.domain[0].row).toMatchObject({
      id: current.id,
      version: 4,
      title: current.commands![current.winner!].body!.title,
    });
    expect(after.domain[0].row.title).not.toBe(
      current.commands![1 - current.winner!].body!.title,
    );
    expect(after.audit.slice(0, -1)).toEqual(current.before!.audit);
    expect(after.audit).toHaveLength(current.before!.audit.length + 1);
  },
);
Then(
  "the successful mutation has one attributed feature-010 audit record",
  async ({ world }) => {
    const current = state(world);
    const after = await snapshot(current.id!);
    const added = after.audit.filter(
      (candidate) =>
        !current.before!.audit.some(
          (previous) => previous.row.id === candidate.row.id,
        ),
    );
    expect(added).toHaveLength(1);
    const actors = await rows<{ zitadel_sub: string }>(
      "SELECT zitadel_sub FROM users WHERE email=$1",
      [world.email],
    );
    expect(actors).toHaveLength(1);
    expect(added[0].row).toMatchObject({
      event_type: "data.directions.update",
      subject_id: actors[0].zitadel_sub,
    });
    const outcome = await idempotencyRecord(current.commands![current.winner!]);
    expect(outcome).toHaveLength(1);
    expect(outcome[0].row).toMatchObject({
      actor_id: actors[0].zitadel_sub,
      response_status: 200,
      response_etag: 'W/"4"',
      response_body: current.answers![current.winner!].body,
    });
  },
);

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for real storage observations`);
  return value;
}

// Read-only SigV4 requests use the same configured S3 service as the API. No
// uploader spy or DB-derived object count substitutes for the provider read.
async function storageRead(method: "GET" | "HEAD", path: string, query = "") {
  const url = new URL(required("S3_ENDPOINT"));
  url.pathname = `/${required("S3_BUCKET_UPLOADS")}/${path}`;
  url.search = query;
  url.searchParams.sort();
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/gu, "");
  const day = date.slice(0, 8);
  const region = process.env.S3_REGION ?? "us-east-1";
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const hmac = (key: string | Buffer, value: string) =>
    createHmac("sha256", key).update(value).digest();
  const digest = hash("");
  const names = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [
    method,
    url.pathname,
    url.search.slice(1),
    `host:${url.host}\nx-amz-content-sha256:${digest}\nx-amz-date:${date}\n`,
    names,
    digest,
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const signing = hmac(
    hmac(hmac(hmac(`AWS4${required("S3_SECRET_KEY")}`, day), region), "s3"),
    "aws4_request",
  );
  const signature = hmac(
    signing,
    `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`,
  ).toString("hex");
  operation("S3 read", { method, path: url.pathname, query: url.search });
  const response = await originalFetch(url, {
    method,
    headers: {
      "x-amz-date": date,
      "x-amz-content-sha256": digest,
      authorization: `AWS4-HMAC-SHA256 Credential=${required("S3_ACCESS_KEY")}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
    },
  });
  operation("S3 response", {
    method,
    path: url.pathname,
    status: response.status,
  });
  expect(response.status).toBe(200);
  return response;
}

async function objectInventory(prefixes: string[]) {
  const inventory: { key: string; metadata: Record<string, string> }[] = [];
  for (const prefix of prefixes) {
    let continuation: string | undefined;
    do {
      const query = new URLSearchParams({ "list-type": "2", prefix });
      if (continuation) query.set("continuation-token", continuation);
      const xml = await (await storageRead("GET", "", query.toString())).text();
      const decode = (value: string) =>
        value
          .replace(/&amp;/gu, "&")
          .replace(/&lt;/gu, "<")
          .replace(/&gt;/gu, ">")
          .replace(/&quot;/gu, '"')
          .replace(/&apos;/gu, "'");
      for (const match of xml.matchAll(/<Key>(.*?)<\/Key>/gu)) {
        const key = decode(match[1]);
        expect(key.startsWith(prefix)).toBe(true);
        const head = await storageRead(
          "HEAD",
          key.split("/").map(encodeURIComponent).join("/"),
        );
        const metadata = Object.fromEntries(
          [...head.headers].filter(
            ([name]) =>
              [
                "content-length",
                "content-type",
                "etag",
                "last-modified",
                "x-amz-version-id",
              ].includes(name) || name.startsWith("x-amz-meta-"),
          ),
        );
        inventory.push({ key, metadata });
      }
      continuation =
        /<NextContinuationToken>(.*?)<\/NextContinuationToken>/u.exec(xml)?.[1];
      if (continuation) continuation = decode(continuation);
      expect(xml.includes("<IsTruncated>true</IsTruncated>")).toBe(
        !!continuation,
      );
    } while (continuation);
  }
  inventory.sort((a, b) => a.key.localeCompare(b.key));
  operation("complete applicable S3 inventory and metadata", {
    prefixes,
    inventory,
  });
  return inventory;
}

async function refusalSnapshot(prefixes: string[]) {
  return {
    // The database is disposable and task-owned. Complete applicable tables
    // also detect an unexpected create whose id was never returned to us.
    projects: await rows(
      "SELECT to_jsonb(t) AS row FROM projects t ORDER BY id",
    ),
    experts: await rows("SELECT to_jsonb(t) AS row FROM experts t ORDER BY id"),
    partners: await rows(
      "SELECT to_jsonb(t) AS row FROM organisations t ORDER BY id",
    ),
    events: await rows("SELECT to_jsonb(t) AS row FROM events t ORDER BY id"),
    links: await rows(
      "SELECT to_jsonb(t) AS row FROM event_experts t ORDER BY id",
    ),
    audit: await rows(
      "SELECT to_jsonb(t) AS row FROM audit_ledger t WHERE event_type LIKE 'data.%' ORDER BY id",
    ),
    idempotency: await rows(
      "SELECT to_jsonb(t) AS row FROM idempotency_keys t ORDER BY key",
    ),
    cleanup: await rows(
      "SELECT to_jsonb(t) AS row FROM media_cleanup_jobs t ORDER BY id",
    ),
    objects: await objectInventory(prefixes),
  };
}

const mediaKinds = {
  project: {
    route: "projects",
    part: "cover",
    reference: "coverRef",
    prefix: "taxonomy/projects/covers/",
  },
  expert: {
    route: "experts",
    part: "photo",
    reference: "photoRef",
    prefix: "taxonomy/experts/photos/",
  },
  partner: {
    route: "organisations",
    part: "logo",
    reference: "logoRef",
    prefix: "taxonomy/partners/logos/",
  },
} as const;
async function mediaTarget(
  page: Page,
  world: AdminWorld,
  kind: keyof typeof mediaKinds,
) {
  const shape = mediaKinds[kind];
  const body =
    kind === "expert"
      ? {
          familyName: "Проверкин",
          givenName: "Иван",
          professionalRole: "Кардиолог",
          credentials: "К. м. н.",
          affiliation: "Клиника",
          bio: "Клиническая и образовательная практика.",
        }
      : {
          title: `${state(world).prefix} ${kind}`,
          ...(kind === "project"
            ? {
                defaultAudience: "doctors",
                kind: "program",
                description: "Образовательная программа.",
              }
            : {}),
        };
  const [created] = await commands(page, [
    { method: "POST", path: `/v1/admin/${shape.route}`, key: key(), body },
  ]);
  expect(created.status).toBe(201);
  operation(`owned ${kind}`, { id: created.body.id });
  const uploadKey = key();
  const path = `/v1/admin/${shape.route}/${created.body.id}`;
  const [uploaded] = await commands(page, [
    {
      method: "PATCH",
      path,
      key: uploadKey,
      etag: created.etag!,
      files: [shape.part],
      body: {},
    },
  ]);
  expect(uploaded.status).toBe(200);
  expect(uploaded.body.version).toBe(2);
  expect(uploaded.etag).toBe('W/"2"');
  const [stored] = await rows<{ ref: string }>(
    `SELECT ${shape.part}_ref AS ref FROM ${shape.route} WHERE id=$1`,
    [created.body.id],
  );
  expect(stored.ref).toMatch(
    new RegExp(`^${shape.prefix}${uploadKey}-[0-9a-f]{32}\\.webp$`, "u"),
  );
  operation("owned normalized object", {
    key: stored.ref,
    entityId: created.body.id,
  });
  const inventory = await objectInventory([shape.prefix]);
  const actual = inventory.find((object) => object.key === stored.ref);
  expect(actual).toBeTruthy();
  expect(actual!.metadata["content-type"]).toBe("image/webp");
  expect(Number(actual!.metadata["content-length"])).toBeGreaterThan(0);
  return {
    ...shape,
    path,
    etag: uploaded.etag!,
    id: created.body.id as string,
  };
}

Given(
  /^a media-capable entity request uses (.+)$/u,
  async ({ page, world }, invalid: string) => {
    const current = state(world);
    const targets = [];
    for (const kind of invalid ===
    "a client-supplied coverRef photoRef or logoRef"
      ? (["project", "expert", "partner"] as const)
      : (["project"] as const))
      targets.push(await mediaTarget(page, world, kind));
    const requests: Command[] = [];
    for (const target of targets) {
      const base: Command = {
        method: "PATCH",
        path: target.path,
        etag: target.etag,
        body: {},
        key: key(),
      };
      if (invalid === "multipart/form-data without a file")
        requests.push({ ...base, files: [] });
      else if (invalid === "a file together with mediaAction clear")
        requests.push({
          ...base,
          files: [target.part],
          body: { mediaAction: "clear" },
        });
      else if (invalid === "multiple or wrong kind-specific file parts") {
        requests.push({ ...base, files: [target.part, target.part] });
        requests.push({ ...base, key: key(), files: ["photo"] });
      } else if (invalid === "a client-supplied coverRef photoRef or logoRef")
        requests.push({
          ...base,
          body: { [target.reference]: "client-controlled/storage.webp" },
        });
      else throw new Error(`Unrecognized original media example: ${invalid}`);
    }
    current.refusal = {
      commands: requests,
      prefixes: targets.map((target) => target.prefix),
    };
    current.refusal.before = await refusalSnapshot(current.refusal.prefixes);
  },
);
When(
  "the operator submits it with a new Idempotency-Key",
  async ({ page, world }) => {
    const current = state(world);
    for (const request of current.refusal!.commands)
      expect(await idempotencyRecord(request)).toEqual([]);
    current.answers = await commands(page, current.refusal!.commands);
  },
);
Then(
  /^the server returns (\d+) (\S+) Problem Details$/u,
  async ({ world }, status: string, code: string) => {
    const answers = state(world).answers!;
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) {
      expect(answer.status).toBe(Number(status));
      expect(answer.contentType).toContain("application/problem+json");
      expect(answer.body).toMatchObject({
        status: Number(status),
        errorCode: code,
        traceId: expect.any(String),
      });
    }
  },
);
async function unchangedRefusal(world: AdminWorld) {
  const current = state(world).refusal!;
  expect(await refusalSnapshot(current.prefixes)).toEqual(current.before);
  operation(
    "refusal has unchanged storage domain audit idempotency and retained relations",
    {
      requests: current.commands.map(({ method, path }) => ({ method, path })),
    },
  );
}
Then("no object, domain row or domain audit row changes", async ({ world }) =>
  unchangedRefusal(world),
);

Given(
  "an otherwise valid mutating request with current preconditions",
  async ({ page, world }) => {
    const target = await mediaTarget(page, world, "project");
    const current = state(world);
    current.refusal = {
      commands: [
        {
          method: "PATCH",
          path: target.path,
          etag: target.etag,
          body: { title: `${current.prefix} valid replacement` },
          files: [target.part],
        },
      ],
      prefixes: [target.prefix],
    };
    current.refusal.before = await refusalSnapshot(current.refusal.prefixes);
  },
);
When(
  /^its Idempotency-Key header is (.+)$/u,
  async ({ page, world }, header: string) => {
    const request = state(world).refusal!.commands[0];
    if (header === "omitted") delete request.key;
    else if (header === "blank") request.key = "";
    else if (header === "not a UUID") request.key = "not-a-uuid";
    else if (header === "non-canonical UUID text")
    request.key = `${key().slice(0, -1)}A`;
    else throw new Error(`Unrecognized original UUID example: ${header}`);
    state(world).answers = await commands(page, [request]);
  },
);
Then(
  "no upload, idempotency row, domain row or domain audit row is created or changed",
  async ({ world }) => unchangedRefusal(world),
);

Given("an event and a publishable expert exist", async ({ page, world }) => {
  const current = state(world);
  const kinds = await rows<{ id: string }>(
    "SELECT id FROM event_kinds WHERE status='published' AND deleted_at IS NULL AND allowed_formats @> ARRAY['online']::text[] ORDER BY id LIMIT 1",
  );
  expect(kinds).toHaveLength(1);
  const [event] = await commands(page, [
    {
      method: "POST",
      path: "/v1/admin/events",
      body: {
        title: `${current.prefix} event`,
        school: "Школа проверки",
        startsAtMsk: "2030-06-01T12:00",
        durationMin: 60,
        kindId: kinds[0].id,
        participationFormat: "online",
        audience: "doctors",
      },
    },
  ]);
  expect(event.status).toBe(201);
  operation("owned event", { id: event.body.id });
  const experts = [];
  for (let index = 0; index < 2; index++) {
    const expert = await mediaTarget(page, world, "expert");
    const [published] = await commands(page, [
      {
        method: "POST",
        path: `${expert.path}/publish`,
        key: key(),
        etag: expert.etag,
        body: {},
      },
    ]);
    expect(published.status).toBe(200);
    expect(published.body.status).toBe("published");
    experts.push(expert.id);
  }
  const [link] = await commands(page, [
    {
      method: "POST",
      path: "/v1/admin/event-experts",
      key: key(),
      body: {
        eventId: event.body.id,
        expertId: experts[1],
        role: "Спикер",
        position: 0,
      },
    },
  ]);
  expect(link.status).toBe(201);
  operation("owned event expert", { id: link.body.id });
  const [retired] = await commands(page, [
    {
      method: "POST",
      path: `/v1/admin/event-experts/${link.body.id}/retire`,
      key: key(),
      etag: link.etag!,
      body: {},
    },
  ]);
  expect(retired.status).toBe(200);
  expect(retired.body).toMatchObject({ id: link.body.id, status: "retired" });
  current.refusal = {
    commands: [],
    prefixes: [mediaKinds.expert.prefix],
    eventId: event.body.id as string,
    expertIds: experts,
    retiredId: link.body.id as string,
  };
  current.refusal.before = await refusalSnapshot(current.refusal.prefixes);
});
When(
  /^the operator submits an event_experts link with (.+)$/u,
  async ({ page, world }, invalid: string) => {
    const current = state(world).refusal!;
    for (const expertId of current.expertIds!) {
      const body: Record<string, unknown> = {
        eventId: current.eventId,
        expertId,
        role: "Спикер",
        position: 1,
      };
      if (invalid === "a missing role") delete body.role;
      else if (invalid === "a blank role") body.role = "   ";
      else if (invalid === "a negative position") body.position = -1;
      else if (invalid === "a fractional position") body.position = 0.5;
      else
        throw new Error(
          `Unrecognized original expert-link example: ${invalid}`,
        );
      current.commands.push({
        method: "POST",
        path: "/v1/admin/event-experts",
        key: key(),
        body,
      });
    }
    state(world).answers = await commands(page, current.commands);
  },
);
Then("the request is refused with 400 Problem Details", async ({ world }) => {
  expect(state(world).answers).toHaveLength(2);
  for (const answer of state(world).answers!) {
    expect(answer.status).toBe(400);
    expect(answer.contentType).toContain("application/problem+json");
    expect(answer.body).toMatchObject({
      status: 400,
      errorCode: "VALIDATION_FAILED",
      traceId: expect.any(String),
    });
  }
});
Then("no event_experts row is created or restored", async ({ world }) => {
  await unchangedRefusal(world);
  const current = state(world).refusal!;
  const links = await rows<{
    id: string;
    expert_id: string;
    status: string;
    deleted_at: Date | null;
  }>(
    "SELECT id,expert_id,status,deleted_at FROM event_experts WHERE event_id=$1 ORDER BY id",
    [current.eventId],
  );
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({
    id: current.retiredId,
    expert_id: current.expertIds![1],
    status: "retired",
  });
  expect(links[0].deleted_at).not.toBeNull();
});
