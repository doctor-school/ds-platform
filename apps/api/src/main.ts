import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { initSentry } from './observability/instrument.js';

async function bootstrap(): Promise<void> {
  // Error monitoring (GlitchTip, DSO-125) — initialised BEFORE the app so the
  // SDK's global handlers register first. No-op when SENTRY_DSN is unset.
  initSentry();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // Enable shutdown hooks so OnModuleDestroy fires on SIGTERM/SIGINT — the
  // Unleash SDK poll timer (FeatureFlagsService) and the delivery-reconcile
  // subscription are cleaned up on a graceful stop (#185).
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

void bootstrap();
