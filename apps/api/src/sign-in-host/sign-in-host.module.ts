import { randomBytes } from "node:crypto";
import {
  Logger,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { Redis } from "ioredis";
import { AuthModule } from "../auth/auth.module.js";
import { SessionModule } from "../auth/session/session.module.js";
import { StorefrontModule } from "../storefront/storefront.module.js";
import { loadEnv } from "../config/env.schema.js";
import {
  resolveSignInHostSettings,
  type SignInHostSettings,
} from "./sign-in-host.config.js";
import { BackChannelLogoutController } from "./back-channel-logout.controller.js";
import { SignInHostController } from "./sign-in-host.controller.js";
import { FakeSignInHostIdp } from "./sign-in-host.idp.fake.js";
import {
  SIGN_IN_HOST_IDP,
  ZitadelSignInHostIdp,
  type SignInHostIdp,
} from "./sign-in-host.idp.js";
import { SignInHostRecordPurge } from "./sign-in-host-record.purge.js";
import { SignInHostRecordStore } from "./sign-in-host-record.store.js";
import { SignInHostService } from "./sign-in-host.service.js";
import { SignInHostSubjectRevocation } from "./sign-in-host-subject-revocation.js";
import {
  INTERNAL_API_TOKEN,
  InternalApiMiddleware,
} from "./internal-api.middleware.js";
import { StorefrontOidcController } from "./storefront-oidc.controller.js";
import { FakeStorefrontOidc } from "./storefront-oidc.idp.fake.js";
import {
  STOREFRONT_OIDC_IDP,
  ZitadelStorefrontOidc,
  type StorefrontOidcIdp,
} from "./storefront-oidc.idp.js";
import { parseClientKey, type ClientKey } from "./storefront-oidc.jwt.js";
import { StorefrontOidcService } from "./storefront-oidc.service.js";
import {
  InMemorySignInHostStateStore,
  RedisSignInHostStateStore,
  SIGN_IN_HOST_STATE_STORE,
  type SignInHostStateStore,
  type StateRedisLike,
} from "./sign-in-host-state.store.js";
import {
  SIGN_IN_HOST_CLOCK,
  SIGN_IN_HOST_RECORD_KEY,
  SIGN_IN_HOST_SETTINGS,
  type SignInHostClock,
} from "./sign-in-host.tokens.js";

/**
 * 003 EARS-5 (amended) / 60 / 64 / 66 / 67 / 68 / 69 / 70 / 71 — the sign-in
 * host's API. Always mounted (so the OpenAPI contract and the generated client
 * carry it), and inert until `resolveSignInHostSettings` finds the whole
 * configuration block: every route then answers 404 and the purge never runs.
 *
 * Bindings follow the auth module's: the real Zitadel adapter when an issuer
 * and service token are configured, the in-memory fake otherwise; Redis for
 * the form state and intents when `REDIS_URL` is set, memory otherwise.
 */
@Module({
  // SessionModule: the one subject-revocation hook the records join;
  // StorefrontModule: the doctor storefront's register / verify command the
  // host's doctor registration door runs (003 EARS-24 amended).
  imports: [AuthModule, SessionModule, StorefrontModule],
  controllers: [
    SignInHostController,
    StorefrontOidcController,
    BackChannelLogoutController,
  ],
  providers: [
    {
      // 003 EARS-62 / EARS-71 — the internal credential; unset, every
      // `/v1/internal/*` route answers 404.
      provide: INTERNAL_API_TOKEN,
      useFactory: (): string | null => loadEnv().INTERNAL_API_TOKEN ?? null,
    },
    {
      // 003 EARS-62 — the storefront clients' token endpoint call. The real
      // adapter whenever a Zitadel issuer is configured (a client without its
      // key then fails closed, never falls back to a fake); the fake otherwise.
      provide: STOREFRONT_OIDC_IDP,
      useFactory: (): StorefrontOidcIdp => {
        const env = loadEnv();
        if (!env.IDP_ISSUER)
          return new FakeStorefrontOidc(
            [env.IDP_ACADEMY_CLIENT_ID, env.IDP_DOCTOR_CLIENT_ID].filter(
              (id): id is string => !!id,
            ),
          );
        const keys = new Map<string, ClientKey>();
        for (const [clientId, raw] of [
          [env.IDP_ACADEMY_CLIENT_ID, env.IDP_ACADEMY_CLIENT_KEY],
          [env.IDP_DOCTOR_CLIENT_ID, env.IDP_DOCTOR_CLIENT_KEY],
        ] as const) {
          const key = parseClientKey(raw);
          if (clientId && key && key.clientId === clientId)
            keys.set(clientId, key);
        }
        return new ZitadelStorefrontOidc({ issuer: env.IDP_ISSUER, keys });
      },
    },
    StorefrontOidcService,
    {
      provide: SIGN_IN_HOST_SETTINGS,
      useFactory: (): SignInHostSettings | null => {
        const settings = resolveSignInHostSettings(loadEnv());
        if (!settings) {
          new Logger("SignInHostModule").log(
            "sign-in host disabled (the IDP_ACADEMY/DOCTOR_CLIENT_ID, IDP_SIGN_IN_BASE_URI, SIGN_IN_*_LOGIN_URL, SIGN_IN_RECORD_KEY block is incomplete); its routes answer 404",
          );
        }
        return settings;
      },
    },
    {
      // A disabled module never seals anything; a throw-away key keeps the
      // stores constructible without ever reaching data.
      provide: SIGN_IN_HOST_RECORD_KEY,
      useFactory: (settings: SignInHostSettings | null): Buffer =>
        settings?.recordKey ?? randomBytes(32),
      inject: [SIGN_IN_HOST_SETTINGS],
    },
    {
      provide: SIGN_IN_HOST_IDP,
      useFactory: (): SignInHostIdp => {
        const env = loadEnv();
        if (env.IDP_ISSUER && env.IDP_SERVICE_TOKEN) {
          return new ZitadelSignInHostIdp({
            baseUrl: env.IDP_ISSUER,
            serviceToken: env.IDP_SERVICE_TOKEN,
          });
        }
        return new FakeSignInHostIdp();
      },
    },
    {
      provide: SIGN_IN_HOST_STATE_STORE,
      useFactory: (key: Buffer): SignInHostStateStore => {
        const env = loadEnv();
        if (env.REDIS_URL) {
          const redis = new Redis(env.REDIS_URL, { lazyConnect: true });
          const logger = new Logger("SignInHostStateStore");
          redis.on("error", (e: Error) =>
            logger.error(`redis connection error: ${e.message}`),
          );
          return new RedisSignInHostStateStore(
            redis as unknown as StateRedisLike,
            key,
          );
        }
        return new InMemorySignInHostStateStore(key);
      },
      inject: [SIGN_IN_HOST_RECORD_KEY],
    },
    {
      provide: SIGN_IN_HOST_CLOCK,
      useValue: (() => new Date()) satisfies SignInHostClock,
    },
    SignInHostRecordStore,
    SignInHostService,
    SignInHostRecordPurge,
    SignInHostSubjectRevocation,
  ],
  exports: [SIGN_IN_HOST_STATE_STORE],
})
export class SignInHostModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // ADR-0015 §4 req. 2 — the internal routes exist only for the holder of
    // the internal credential (before any guard, so nothing reveals them).
    consumer.apply(InternalApiMiddleware).forRoutes(StorefrontOidcController);
  }
}
