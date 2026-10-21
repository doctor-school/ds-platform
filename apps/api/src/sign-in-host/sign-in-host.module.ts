import { randomBytes } from "node:crypto";
import { Logger, Module } from "@nestjs/common";
import { Redis } from "ioredis";
import { AuthModule } from "../auth/auth.module.js";
import { loadEnv } from "../config/env.schema.js";
import {
  resolveSignInHostSettings,
  type SignInHostSettings,
} from "./sign-in-host.config.js";
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
  imports: [AuthModule],
  controllers: [SignInHostController],
  providers: [
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
  ],
  exports: [SIGN_IN_HOST_STATE_STORE],
})
export class SignInHostModule {}
