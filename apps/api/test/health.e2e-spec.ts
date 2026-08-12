import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { HealthResponseSchema } from "@ds/schemas";
import { AppModule } from "../src/app.module.js";

// Booting AppModule constructs DatabaseModule, which requires DATABASE_URL —
// provided locally by the dev-stand and on CI by the `api-e2e` job's pgvector
// service container (#66).
//
// Requests go through Fastify's in-process `app.inject()` — as every sibling
// e2e spec does — and never over a real TCP socket. supertest opens the Nest
// http server with `app.listen(0)` (no host, so the bound address family is
// the runtime's choice) and then always connects to a hardcoded
// `http://127.0.0.1:<port>`; when the container's loopback does not answer on
// IPv4 the request is refused before it reaches the handler, which is how this
// one spec failed with ECONNREFUSED on the self-hosted pool while the rest of
// the api suite stayed green (#1230). `inject()` has no socket, port or
// address family to get wrong.
describe("GET /v1/health (EARS-1)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-1.1: returns 200 with body matching HealthResponseSchema", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/health" });

    expect(res.statusCode).toBe(200);
    const parsed = HealthResponseSchema.parse(res.json());
    expect(parsed.status).toBe("ok");
    expect(parsed.uptime).toBeGreaterThanOrEqual(0);
    expect(Date.parse(parsed.timestamp)).toBeGreaterThan(0);
  });

  it("EARS-1.2: reports the deployed commit SHA from DEPLOY_SHA (DSO-127)", async () => {
    // No DEPLOY_SHA in the test env → `version` is omitted (optional field).
    const bare = await app.inject({ method: "GET", url: "/v1/health" });
    expect(bare.statusCode).toBe(200);
    expect(bare.json().version).toBeUndefined();

    // With DEPLOY_SHA stamped (as `pnpm deploy:prod` does in prod), the same
    // handler surfaces it so an operator can confirm the live build over HTTP.
    const prev = process.env.DEPLOY_SHA;
    process.env.DEPLOY_SHA = "deadbeefcafe1234";
    try {
      const stamped = await app.inject({ method: "GET", url: "/v1/health" });
      expect(stamped.statusCode).toBe(200);
      const parsed = HealthResponseSchema.parse(stamped.json());
      expect(parsed.version).toBe("deadbeefcafe1234");
    } finally {
      if (prev === undefined) delete process.env.DEPLOY_SHA;
      else process.env.DEPLOY_SHA = prev;
    }
  });
});
