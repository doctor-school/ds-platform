import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { VersioningType } from '@nestjs/common';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { HealthResponseSchema } from '@ds/schemas';
import { AppModule } from '../src/app.module.js';

describe('GET /v1/health (EARS-1)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('EARS-1: returns 200 with body matching HealthResponseSchema', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health');

    expect(res.status).toBe(200);
    const parsed = HealthResponseSchema.parse(res.body);
    expect(parsed.status).toBe('ok');
    expect(parsed.uptime).toBeGreaterThanOrEqual(0);
    expect(Date.parse(parsed.timestamp)).toBeGreaterThan(0);
  });
});
