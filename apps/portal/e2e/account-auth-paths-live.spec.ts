import { HOSTS } from "@ds/e2e/hosts";
import { defineAccountAuthPathTests } from "@ds/e2e/account-auth-paths";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * #3151 — the Academy binding of the shared `/account` auth-path body
 * (`packages/e2e/lib/account-auth-paths.ts`): an expired session bounces to
 * login carrying `returnTo=/account` and returns; «Сменить пароль» hands off to
 * `/reset?returnTo=%2Faccount` and the completed reset returns to `/account`.
 * The values below are this host's auth-flow config
 * (`lib/auth-flow.host-config.ts`); the spec body is not repeated here.
 *
 * Runs on the live tier `playwright.account-live.config.ts` (no webServer, no
 * bddgen): ENV `E2E_PORTAL_URL`, `MAILPIT_URL`; Academy bound to IPv4.
 */
defineAccountAuthPathTests({
  host: HOSTS.academy,
  gate: { requireLiveStandEnv },
  registerPath: "/v1/auth/register",
  verifyPath: "/v1/auth/verify",
  registration: { consent: [{ purpose: "tos", version: "2026-01" }] },
  resetPath: "/reset",
});
