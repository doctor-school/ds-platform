import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReadinessResponseSchema } from "@ds/schemas";
import { AppModule } from "../src/app.module.js";

describe("Readiness (e2e)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-1: GET /v1/ready returns 200 with status=ok and both checks ok when Postgres + pgvector are healthy", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/ready" });

    expect(res.statusCode).toBe(200);
    const body = ReadinessResponseSchema.parse(res.json());
    expect(body.status).toBe("ok");
    expect(body.checks.postgres).toBe("ok");
    expect(body.checks.pgvector).toBe("ok");
  });
});
