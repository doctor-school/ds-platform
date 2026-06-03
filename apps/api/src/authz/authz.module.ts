import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthzGuard } from "./authz.guard.js";

/**
 * Registers the global runtime mirror (spec §2). `AuthzGuard` runs on every
 * route and fails closed on any handler that lacks `@Authz` metadata, so an
 * unclassified endpoint is denied at runtime — not just flagged by CI.
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: AuthzGuard }],
})
export class AuthzModule {}
