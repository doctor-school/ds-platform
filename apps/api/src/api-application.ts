import { VersioningType, type NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import multipart from "@fastify/multipart";
import { AppModule } from "./app.module.js";

export async function createApiApplication(
  options?: NestApplicationOptions,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    options,
  );
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  return app;
}
