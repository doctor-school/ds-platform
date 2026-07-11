import { Logger, Module } from "@nestjs/common";
import { Redis } from "ioredis";
import { loadEnv } from "../../config/env.schema.js";
import { MirrorSelfHealService } from "../mirror-self-heal.service.js";
import { UserMirrorService } from "../user-mirror.service.js";
import { SESSION_STORE, type SessionStore } from "./session.types.js";
import { InMemorySessionStore } from "./session-store.fake.js";
import { RedisSessionStore } from "./session-store.redis.js";
import { AUTH_AUDIT } from "./auth-audit.types.js";
import { DrizzleAuthAuditLog } from "./auth-audit.ledger.js";
import { SessionService } from "./session.service.js";
import { SessionAuthHook } from "./session-auth.hook.js";

/**
 * Wires BFF session establishment (design §3, EARS-8):
 *
 * - binds the {@link SESSION_STORE} port to the Redis adapter when `REDIS_URL`
 *   is configured (the production binding, ADR-0001 §6), else the in-memory fake
 *   — the single place the store backend is chosen, mirroring `IdpModule`;
 * - provides {@link SessionService} (the OIDC-exchange → cookie + record step),
 *   exported for the login orchestration in `AuthService`;
 * - registers {@link SessionAuthHook}, which populates the request subject the
 *   global `AuthzGuard` reads — and, via {@link MirrorSelfHealService}
 *   (EARS-26, #709), lazily re-materializes a missing `users` mirror row for
 *   that subject before the handler runs (the read-path third sync layer next
 *   to the webhook + sweep). {@link UserMirrorService} is therefore provided
 *   (and exported) HERE — the auth hook is its earliest consumer in the request
 *   lifecycle — and `AuthModule` (which imports this module) resolves the same
 *   single instance for the register cascade, webhook, and sweep;
 * - binds the {@link AUTH_AUDIT} sink to the durable `audit_ledger` writer
 *   (EARS-18, F6 #90) — the app always has a DB handle; the in-memory fake stays
 *   the unit-spec double (constructed directly, not through this token).
 */
@Module({
  providers: [
    { provide: AUTH_AUDIT, useClass: DrizzleAuthAuditLog },
    {
      provide: SESSION_STORE,
      useFactory: (): SessionStore => {
        const env = loadEnv();
        if (env.REDIS_URL) {
          // lazyConnect so the BFF boots even if Redis is briefly unreachable
          // (it connects on the first session write); an attached error listener
          // keeps a connection blip from surfacing as an unhandled 'error' event.
          const redis = new Redis(env.REDIS_URL, { lazyConnect: true });
          const logger = new Logger("RedisSessionStore");
          redis.on("error", (e: Error) =>
            logger.error(`redis connection error: ${e.message}`),
          );
          return new RedisSessionStore(redis);
        }
        return new InMemorySessionStore();
      },
    },
    SessionService,
    SessionAuthHook,
    UserMirrorService,
    MirrorSelfHealService,
  ],
  // AUTH_AUDIT is exported so AuthService (AuthModule) shares the one durable
  // ledger binding the session layer already uses (EARS-18) — not a second sink.
  // UserMirrorService is exported for the same single-instance reason (EARS-26):
  // AuthService / ReconcileService reuse the binding the auth hook heals through.
  exports: [SessionService, AUTH_AUDIT, UserMirrorService],
})
export class SessionModule {}
