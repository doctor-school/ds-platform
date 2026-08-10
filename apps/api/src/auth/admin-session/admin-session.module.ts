import { Logger, Module } from "@nestjs/common";
import { Redis } from "ioredis";
import { loadEnv } from "../../config/env.schema.js";
import { IdpModule } from "../idp/idp.module.js";
import { SessionModule } from "../session/session.module.js";
import {
  ADMIN_SESSION_STORE,
  PENDING_AUTH_STORE,
  type AdminSessionStore,
  type PendingAuthStore,
} from "./admin-session.types.js";
import {
  InMemoryAdminSessionStore,
  InMemoryPendingAuthStore,
} from "./admin-session-store.fake.js";
import {
  RedisAdminSessionStore,
  RedisPendingAuthStore,
} from "./admin-session-store.redis.js";
import { AdminSessionService } from "./admin-session.service.js";
import { AdminSessionAuthHook } from "./admin-session-auth.hook.js";
import { AdminAuthController } from "./admin-auth.controller.js";

/**
 * Wires the 011 admin session tier (EARS-1, EARS-2, EARS-3, EARS-10).
 *
 * - binds both admin-tier stores to their Redis adapters when `REDIS_URL` is
 *   configured (the production binding, ADR-0001 §6 / EARS-10), else the
 *   in-memory fakes — the single place the backend is chosen, mirroring
 *   {@link SessionModule};
 * - provides {@link AdminSessionService}, the one place primary auth is turned
 *   into a pending authentication and a satisfied factor into the dedicated
 *   cookie;
 * - registers {@link AdminSessionAuthHook}, the admin-tier request hook that is
 *   disjoint from the 003 portal hook by route namespace (EARS-2);
 * - reuses {@link SessionModule}'s exported `AUTH_AUDIT` binding rather than
 *   creating a second sink, so every 011 row lands in the same durable ledger
 *   through the same single mapper (EARS-9, design §8a).
 *
 * One Redis connection is created here rather than shared with `SessionModule`
 * because each module owns its own binding decision; both are `lazyConnect` with
 * an attached error listener, so a connection blip never surfaces as an
 * unhandled 'error' event.
 */
@Module({
  imports: [IdpModule, SessionModule],
  controllers: [AdminAuthController],
  providers: [
    {
      provide: ADMIN_SESSION_STORE,
      useFactory: (): AdminSessionStore => {
        const env = loadEnv();
        if (!env.REDIS_URL) return new InMemoryAdminSessionStore();
        return new RedisAdminSessionStore(adminRedis(env.REDIS_URL));
      },
    },
    {
      provide: PENDING_AUTH_STORE,
      useFactory: (): PendingAuthStore => {
        const env = loadEnv();
        if (!env.REDIS_URL) return new InMemoryPendingAuthStore();
        return new RedisPendingAuthStore(adminRedis(env.REDIS_URL));
      },
    },
    AdminSessionService,
    AdminSessionAuthHook,
  ],
  exports: [AdminSessionService],
})
export class AdminSessionModule {}

/** A lazily-connecting Redis client with the shared error-logging discipline. */
function adminRedis(url: string): Redis {
  const redis = new Redis(url, { lazyConnect: true });
  const logger = new Logger("AdminSessionStore");
  redis.on("error", (e: Error) =>
    logger.error(`redis connection error: ${e.message}`),
  );
  return redis;
}
