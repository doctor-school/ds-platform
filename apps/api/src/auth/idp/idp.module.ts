import { Global, Logger, Module } from "@nestjs/common";
import { Redis } from "ioredis";
import { loadEnv } from "../../config/env.schema.js";
import { DEFAULT_PORTAL_BASE_URL } from "../../mailer/mailer.module.js";
import { FakeIdpClient } from "./idp.fake.js";
import { IDP_CLIENT, type IdpClient } from "./idp.types.js";
import { InMemoryOtpChallengeStore } from "./otp-challenge-store.fake.js";
import { RedisOtpChallengeStore } from "./otp-challenge-store.redis.js";
import {
  OTP_CHALLENGE_STORE,
  type OtpChallengeStore,
} from "./otp-challenge-store.types.js";
import { ZitadelIdpClient } from "./zitadel.idp.js";

/**
 * Binds the {@link IDP_CLIENT} port (design §2). The single place the concrete
 * IdP adapter is chosen: a real {@link ZitadelIdpClient} when both an issuer and
 * a service token are configured, otherwise the in-memory {@link FakeIdpClient}
 * (the dev-stand default — `IDP_CLIENT_SECRET` is empty, so no live IdP is
 * required to boot or to exercise the F1 cascade against a real Postgres).
 *
 * `@Global` so feature modules (003 F1/F2/F3/F5) inject the port without
 * re-importing — mirrors `BotProtectionModule`.
 */
@Global()
@Module({
  providers: [
    {
      // #410: the cross-request OTP-challenge bridge (request*Otp →
      // loginWith*Otp are two distinct HTTP requests). Redis-backed when
      // `REDIS_URL` is configured so the two hops may land on DIFFERENT api
      // instances (scale-out); else the in-memory fake — the same single-place
      // backend choice (and the same lazyConnect + error-listener discipline)
      // as SESSION_STORE in SessionModule.
      provide: OTP_CHALLENGE_STORE,
      useFactory: (): OtpChallengeStore => {
        const env = loadEnv();
        if (env.REDIS_URL) {
          // lazyConnect so the BFF boots even if Redis is briefly unreachable
          // (it connects on the first challenge write); the error listener
          // keeps a connection blip from surfacing as an unhandled 'error'.
          const redis = new Redis(env.REDIS_URL, { lazyConnect: true });
          const logger = new Logger("RedisOtpChallengeStore");
          redis.on("error", (e: Error) =>
            logger.error(`redis connection error: ${e.message}`),
          );
          return new RedisOtpChallengeStore(redis);
        }
        return new InMemoryOtpChallengeStore();
      },
    },
    {
      provide: IDP_CLIENT,
      useFactory: (otpChallengeStore: OtpChallengeStore): IdpClient => {
        const env = loadEnv();
        if (env.IDP_ISSUER && env.IDP_SERVICE_TOKEN) {
          return new ZitadelIdpClient(
            {
              baseUrl: env.IDP_ISSUER,
              serviceToken: env.IDP_SERVICE_TOKEN,
              // OIDC application config (design §3, §11) for the session→token
              // exchange (EARS-8) and refresh rotation (EARS-9). Optional — absent
              // ⇒ those two paths fail closed; the rest of the adapter still works.
              clientId: env.IDP_CLIENT_ID,
              clientSecret: env.IDP_CLIENT_SECRET,
              redirectUri: env.IDP_REDIRECT_URI,
              scopes: env.IDP_SCOPES?.split(/\s+/).filter(Boolean),
              // #157: the project owning `doctor_guest`, for the per-user role
              // grant on register/webhook/reconcile. Absent ⇒ grantProjectRole
              // fails closed.
              projectId: env.IDP_PROJECT_ID,
              // #203: the org the resource-API `CreateUser` / `CreateAuthorization`
              // require in the request body. Absent ⇒ the adapter resolves it once
              // from the service account's own org and caches it.
              orgId: env.IDP_ORG_ID,
              // #869: the portal origin whose bare `/verify` URL replaces Zitadel's
              // default hosted-login link in the code-only verification email. The
              // SAME portal-origin source the mailer channel uses — never a
              // hardcoded host (recipe-specific).
              portalBaseUrl:
                env.MAILER_PORTAL_BASE_URL ?? DEFAULT_PORTAL_BASE_URL,
            },
            // #410: the shared cross-request OTP-challenge store — Redis-backed
            // under scale-out, so the login hop finds the challenge whichever
            // instance armed it.
            otpChallengeStore,
          );
        }
        return new FakeIdpClient();
      },
      inject: [OTP_CHALLENGE_STORE],
    },
  ],
  exports: [IDP_CLIENT],
})
export class IdpModule {}
