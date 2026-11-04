import { expect } from "@playwright/test";
import {
  databaseFacts,
  probeLog,
  parseProbeSchema,
  startApiProbe,
  type ApiProbe,
} from "../lib/api-probe-fixtures.js";
import { createBdd, test as base } from "playwright-bdd";

export const test = base.extend<{ apiProbe: ApiProbe }>({
  // eslint-disable-next-line no-empty-pattern -- bddgen detects the custom fixture through this signature
  apiProbe: async ({}, use, testInfo) => {
    const fixture = await startApiProbe(
      testInfo.title ===
        "Readiness endpoint reports down when object storage refuses the credentials",
    );
    try {
      await use(fixture);
    } finally {
      await fixture.stop();
    }
  },
});
const { Given, When, Then } = createBdd(test);

function field(apiProbe: ApiProbe, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      apiProbe.body,
    );
}

Given("the API process is running", async ({ apiProbe }) => {
  expect(apiProbe.process.pid).toBeGreaterThan(0);
  expect(apiProbe.process.exitCode).toBeNull();
  expect((await fetch(`${apiProbe.url}/v1/health`)).status).toBe(200);
});
Given(
  "the Postgres connection pool is initialized from DATABASE_URL",
  async ({ apiProbe }) => {
    const response = await fetch(`${apiProbe.url}/v1/ready`);
    expect((await response.json()).checks.postgres).toBe("ok");
  },
);
Given("the initial Drizzle migration has been applied", async () => {
  const facts = await databaseFacts();
  expect(facts.initial).toBe("idempotency_keys");
  expect(facts.migrations).toBeGreaterThan(0);
});
Given("the object-storage probe has run at startup", async ({ apiProbe }) => {
  expect(apiProbe.log).toMatch(
    /object storage is (ready|down: InvalidAccessKeyId \(HTTP 403\))/,
  );
});
Given("Postgres accepts connections", async () => {
  expect((await databaseFacts()).connected).toBe(1);
});
Given('the "vector" extension is installed in the database', async () => {
  expect((await databaseFacts()).vector).toBe("vector");
});
Given("the last object-storage probe succeeded", async ({ apiProbe }) => {
  expect(apiProbe.log).toContain("object storage is ready");
  expect(await apiProbe.storageProbe()).toEqual({
    status: 200,
    name: "ok",
    keys: 0,
  });
});
Given(
  'the object store answers the probe with "InvalidAccessKeyId" HTTP 403',
  async ({ apiProbe }) => {
    const fixture = apiProbe;
    expect(await fixture.storageProbe()).toEqual({
      status: 403,
      name: "InvalidAccessKeyId",
    });
    expect(fixture.log).toContain(
      "object storage is down: InvalidAccessKeyId (HTTP 403)",
    );
    expect((await fetch(`${fixture.url}/v1/health`)).status).toBe(200);
    expect(fixture.process.exitCode).toBeNull();
    probeLog({
      command: "real degraded provider proof",
      status: 403,
      name: "InvalidAccessKeyId",
      health: 200,
    });
  },
);
When(
  "the client sends a GET request to {string}",
  async ({ apiProbe }, path: string) => {
    expect(["/v1/health", "/v1/ready"]).toContain(path);
    const fixture = apiProbe;
    fixture.request = await fetch(`${fixture.url}${path}`);
    fixture.body = (await fixture.request.json()) as Record<string, unknown>;
    probeLog({
      command: `GET ${path}`,
      pid: fixture.process.pid,
      status: fixture.request.status,
      body: fixture.body,
    });
  },
);
Then("the response status is {int}", async ({ apiProbe }, status: number) => {
  expect(apiProbe.request!.status).toBe(status);
});
Then(
  "the response Content-Type is {string}",
  async ({ apiProbe }, type: string) => {
    expect(apiProbe.request!.headers.get("content-type")?.split(";")[0]).toBe(
      type,
    );
  },
);
Then(
  "the response body has field {string} equal to {string}",
  async ({ apiProbe }, path: string, value: string) => {
    expect(field(apiProbe, path)).toBe(value);
  },
);
Then(
  "the response body has field {string} of type number with value >= 0",
  async ({ apiProbe }, path: string) => {
    const value = field(apiProbe, path);
    expect(typeof value).toBe("number");
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  },
);
Then(
  "the response body has field {string} matching an ISO-8601 datetime",
  async ({ apiProbe }, path: string) => {
    const value = field(apiProbe, path);
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isFinite(Date.parse(String(value)))).toBe(true);
  },
);
Then(
  "the response body matches the HealthResponse schema from {string}",
  async ({ apiProbe }, source: string) => {
    expect(source).toBe("@ds/schemas");
    parseProbeSchema("HealthResponseSchema", apiProbe.body);
  },
);
Then(
  "the response body matches the ReadinessResponse schema from {string}",
  async ({ apiProbe }, source: string) => {
    expect(source).toBe("@ds/schemas");
    parseProbeSchema("ReadinessResponseSchema", apiProbe.body);
  },
);
Then(
  "the response body does not contain {string}",
  async ({ apiProbe }, reason: string) => {
    expect(JSON.stringify(apiProbe.body)).not.toContain(reason);
  },
);
