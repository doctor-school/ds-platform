/**
 * Boot-and-scan entrypoint for the completeness gate (spec §6.1).
 *
 * This module owns the Nest bootstrapping so the root-level CLI
 * (tools/lint/endpoint-authz-lint.ts) needs no @nestjs/* dependency of its own —
 * NestJS resolves from apps/api/node_modules here. It is intentionally NOT
 * re-exported from authz/index.ts: importing it pulls AppModule, which would
 * create an import cycle with the very controllers that depend on @Authz.
 */
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { DiscoveryModule, NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { collectAuthzRows, type AuthzScanResult } from "./authz.discovery.js";

// DiscoveryService needs DiscoveryModule in the graph; wrapping the real
// AppModule makes the gate observe exactly the route set that serves traffic
// (spec §2.1 — not a static AST parse, not the OpenAPI document).
@Module({ imports: [AppModule, DiscoveryModule] })
class AuthzGateModule {}

/** Boot a Nest application context (no network listen), scan every registered route, then tear down. */
export async function scanRealRouteSet(): Promise<AuthzScanResult> {
  // AppModule → DatabaseModule validates DATABASE_URL. The pg Pool connects
  // lazily (route discovery issues no query), so a placeholder suffices — the
  // gate never touches the database.
  process.env.DATABASE_URL ??=
    "postgres://authz-lint@127.0.0.1:5432/authz_lint";

  const app = await NestFactory.createApplicationContext(AuthzGateModule, {
    logger: false,
  });
  try {
    return collectAuthzRows(app);
  } finally {
    await app.close();
  }
}
