import { randomUUID } from "node:crypto";
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
        operation("owned grant target verified", { subject: granting[1] });
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
  if (!["ds_admin_e2e", "ds_dev_3631"].includes(database))
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
        const response = await fetch(input.path, {
          method: input.method,
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-ds-admin-csrf": decodeURIComponent(csrf),
            ...(input.key ? { "idempotency-key": input.key } : {}),
            ...(input.etag ? { "if-match": input.etag } : {}),
          },
          ...(input.body ? { body: JSON.stringify(input.body) } : {}),
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
