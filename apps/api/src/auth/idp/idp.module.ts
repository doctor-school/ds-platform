import { Global, Module } from "@nestjs/common";
import { loadEnv } from "../../config/env.schema.js";
import { FakeIdpClient } from "./idp.fake.js";
import { IDP_CLIENT, type IdpClient } from "./idp.types.js";
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
      provide: IDP_CLIENT,
      useFactory: (): IdpClient => {
        const env = loadEnv();
        if (env.IDP_ISSUER && env.IDP_SERVICE_TOKEN) {
          return new ZitadelIdpClient({
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
          });
        }
        return new FakeIdpClient();
      },
    },
  ],
  exports: [IDP_CLIENT],
})
export class IdpModule {}
