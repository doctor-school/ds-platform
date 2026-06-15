import { z } from "zod";

import { SMARTCAPTCHA_VALIDATE_URL } from "../bot-protection/smart-captcha.provider.js";

export const ApiEnvSchema = z.looseObject({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5_000),

  // Bot protection (Yandex SmartCaptcha — design §10.1, ADR-0001 open-q #7).
  // Disabled by default so the dev-stand runs without a Yandex account; the
  // guard and widget stay wired, only the server-to-server validation is
  // skipped. Enable in any environment that holds a real SmartCaptcha keypair.
  BOT_PROTECTION_ENABLED: z
    .stringbool({ truthy: ["true", "1"], falsy: ["false", "0", ""] })
    .default(false),
  SMARTCAPTCHA_SERVER_KEY: z.string().optional(),
  SMARTCAPTCHA_VALIDATE_URL: z.url().default(SMARTCAPTCHA_VALIDATE_URL),

  // Identity provider (Zitadel — design §1/§2). The BFF binds the real Zitadel
  // adapter only when a service token is present; with no token (the dev-stand
  // default — `IDP_CLIENT_SECRET` is empty) it falls back to the in-memory fake
  // so the F1 flows run end-to-end against a real Postgres without a live IdP.
  IDP_ISSUER: z.string().optional(),
  IDP_SERVICE_TOKEN: z.string().optional(),
  // OIDC application config (design §3, §11) — the `ds-platform-dev` app created
  // in the Zitadel console (per-recipe follow-up, `infra/dev-stand/idp/bootstrap.md`).
  // Required for the session→token exchange (EARS-8) and refresh rotation
  // (EARS-9); absent ⇒ those two adapter paths fail closed. The dev-stand ships
  // `IDP_CLIENT_SECRET=CHANGE_ME` until the app is provisioned.
  IDP_CLIENT_ID: z.string().optional(),
  IDP_CLIENT_SECRET: z.string().optional(),
  // OIDC redirect URI registered on the application; the token exchange echoes it.
  IDP_REDIRECT_URI: z.url().optional(),
  // Space-separated OIDC scopes; the project-roles claim needs its scope, so the
  // adapter's default includes `urn:zitadel:iam:org:project:roles` when unset.
  IDP_SCOPES: z.string().optional(),
  // #157: the Zitadel project that owns the `doctor_guest` role — the `PROJECT_ID`
  // emitted by `infra/dev-stand/idp/provision.sh`. Required to grant the project
  // role per user on register / webhook / reconcile (the OIDC token's project-roles
  // claim, asserted only for granted roles, is the authz source the guard reads;
  // the `users.role` mirror is a downstream projection). Absent ⇒ `grantProjectRole`
  // fails closed, like the other OIDC-config-gated adapter paths.
  IDP_PROJECT_ID: z.string().optional(),
  // #203: the Zitadel **organization** that owns the registered users + the
  // project-role grant. The current resource API `CreateUser` (`POST /v2/users/new`)
  // and `CreateAuthorization` both REQUIRE an explicit `organizationId` in the
  // request body — the deprecated `AddHumanUser`/management-v1 grant inferred it
  // from the service token's own org, the resource API does not. Optional: when
  // unset the adapter resolves it once at runtime from the service account's own
  // org (`GET /management/v1/orgs/me`) and caches it, so the dev-stand needs no new
  // env; pin it explicitly in any multi-org deployment.
  IDP_ORG_ID: z.string().optional(),
  // Shared secret authenticating the Zitadel Action webhook (EARS-19). The
  // webhook fails closed when this is unset — an unauthenticated mirror-write
  // surface is never opened by default.
  IDP_WEBHOOK_SECRET: z.string().optional(),

  // Server-side BFF session store (design §3, ADR-0001 §6: refresh stored
  // server-side in Redis). Bound to the Redis adapter when set; with no
  // REDIS_URL (the shared CI / dev-stand-without-redis default) the in-memory
  // session store is used, so the F2 flows run without a live Redis — mirroring
  // the IdP fake/real split.
  REDIS_URL: z.url().optional(),

  // Runtime feature flags (Unleash — #185). The api reads dev-stand runtime flags
  // (`bot-protection`, `email-delivery-real`, `sms-delivery-real`) from Unleash so
  // an operator toggles them in the admin UI without editing `.env.local` and
  // restarting. The SDK is bound ONLY when both URL + token are set (the dev-stand
  // recipe); with either unset (shared CI / Unleash-less default) every flag read
  // falls back to the env bootstrap default below — fail-closed for the security
  // flag (design of record §4). UNLEASH_URL carries the `/api` suffix the SDK
  // consumes (the bare origin is the admin UI). UNLEASH_API_TOKEN is the seeded
  // backend/client token (`UNLEASH_INIT_CLIENT_API_TOKEN` in `.env.local`).
  UNLEASH_URL: z.url().optional(),
  UNLEASH_API_TOKEN: z.string().optional(),
  // App name + environment the SDK reports to Unleash (the seeded tokens are
  // scoped to the `development` environment, #184). Defaulted so the dev-stand
  // recipe sets only URL + token.
  UNLEASH_APP_NAME: z.string().default("ds-api"),
  UNLEASH_ENVIRONMENT: z.string().default("development"),
  // SDK poll interval (ms) — short on the dev-stand so a UI toggle lands within
  // seconds (the per-request captcha read and the delivery `changed` reconcile
  // both ride this poll).
  UNLEASH_REFRESH_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5_000),

  // Delivery boot mode (#185) — the SINGLE source of truth for which Zitadel
  // notification provider is active at boot. provision.sh reads these and
  // activates the matching provider on boot; the api uses `mode === "real"` as its
  // Unleash-unreachable fallback for the `email-delivery-real` / `sms-delivery-real`
  // flags (the reconcile reacts to a flag change and `_activate`s the matching
  // pre-configured Zitadel provider — it holds NO SMTP/SMS secrets, only flips
  // which provider is active). `mailpit`/`sink` (the defaults) = intercept via
  // Mailpit/sms-sink; `real` = the real provider. One knob, no parallel boolean.
  EMAIL_DELIVERY_MODE: z.enum(["mailpit", "real"]).default("mailpit"),
  SMS_DELIVERY_MODE: z.enum(["sink", "real"]).default("sink"),

  // BFF transactional-email channel (003 EARS-23, design §4) — the account-exists
  // notice on duplicate registration, DISTINCT from Zitadel's identity-credential
  // emails (verification / OTP / reset codes). Config-gated: with no
  // MAILER_SMTP_HOST the SmtpMailer degrades to a logged no-op (infra-gated, like
  // the IdP / Redis fakes), so the dev-stand / CI boot without an SMTP host. On
  // the dev-stand these point at Mailpit (`truenas.local:1025`, no auth); in prod
  // at a real SMTP relay (the same creds class as IDP_SMTP_REAL_*). The notice
  // carries no secret, so this is a separate config block from the IdP's SMTP.
  MAILER_SMTP_HOST: z.string().optional(),
  MAILER_SMTP_PORT: z.coerce.number().int().positive().optional(),
  MAILER_SMTP_USER: z.string().optional(),
  MAILER_SMTP_PASSWORD: z.string().optional(),
  MAILER_SMTP_FROM: z.string().optional(),
  // Portal origin the notice's sign-in / reset links point at (`/login`,
  // `/reset`). Optional — defaults to the local portal in the adapter.
  MAILER_PORTAL_BASE_URL: z.url().optional(),

  // Keyed HMAC pepper for ledger identifier masking (ADR-0001 §7, ADR-0003 §6).
  // The `audit_ledger` records an `identifier_hash`, never raw PD; a bare digest
  // over a low-entropy identifier space is a reproducible existence oracle (a
  // rainbow table over a phone range), so the mask is HMAC-SHA256 keyed by this
  // server-side secret. Optional at the schema level only so the dev-stand / test
  // runtime boot without a configured secret; the audit writer fails closed when
  // it is unset in a non-test runtime (a deterministic test pepper is used under
  // VITEST so the e2e suite runs without provisioning one).
  AUDIT_IDENTIFIER_PEPPER: z.string().optional(),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return ApiEnvSchema.parse(source);
}
