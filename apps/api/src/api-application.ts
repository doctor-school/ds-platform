import { VersioningType, type NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import multipart from "@fastify/multipart";
import { AppModule } from "./app.module.js";
import { resolveTrustProxy } from "./config/trust-proxy.js";

export async function createApiApplication(
  options?: NestApplicationOptions,
): Promise<NestFastifyApplication> {
  // #1655: resolve the real client address behind the reverse-proxy chain. Every
  // source-address control (EARS-13 rate-limit windows, login-challenge gate,
  // session fingerprint, bot protection) reads `request.ip`; without this the
  // whole platform presents as the Caddy container address. The trusted set is a
  // predicate over proxy ADDRESSES — not a hop count — because the direct api
  // path and the doctor storefront's `/v1/:path*` rewrite have different chain
  // lengths. See `config/trust-proxy.ts` for the full rationale.
  const trustProxy = resolveTrustProxy(process.env, (rejection) => {
    console.warn(
      `[trust-proxy] ignoring invalid TRUSTED_PROXIES entry "${rejection.value}": ${rejection.reason}`,
    );
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy }),
    options,
  );
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  return app;
}
