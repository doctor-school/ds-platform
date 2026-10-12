import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { ModulesContainer } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReadinessResponseSchema } from "@ds/schemas";
import { AppModule } from "../src/app.module.js";

// The readiness probes hit a real Postgres + pgvector — provided locally by the
// dev-stand and on CI by the `api-e2e` job's pgvector service container (#66).
describe("Readiness (e2e)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
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

  it("EARS-1: GET /v1/ready returns 200 with status=ok and every check ok when Postgres + pgvector + object storage are healthy", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/ready" });

    expect(res.statusCode).toBe(200);
    const body = ReadinessResponseSchema.parse(res.json());
    expect(body.status).toBe("ok");
    expect(body.checks.postgres).toBe("ok");
    expect(body.checks.pgvector).toBe("ok");
    expect(body.checks.objectStorage).toBe("ok");
  });

  // The readiness monitor needs a SchedulerRegistry. Each
  // `ScheduleModule.forRoot()` call is a distinct dynamic module, so a second
  // import installs a second cron explorer and every @Cron job runs twice
  // (#2828 review). Exactly one instance may exist in the booted app.
  it("EARS-3: the booted app holds exactly one ScheduleModule, so the readiness monitor doubles no @Cron job", () => {
    const modules = [...app.get(ModulesContainer).values()];
    expect(
      modules.filter((m) => m.metatype === ScheduleModule),
    ).toHaveLength(1);
  });
});
