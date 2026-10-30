import { HOSTS } from "@ds/e2e/hosts";
import { defineAccountAuthPathTests } from "@ds/e2e/account-auth-paths";
import { requireLiveStandEnv } from "./support/live-stand-env";

/**
 * #3151 — the doctor-storefront binding of the shared `/account` auth-path body
 * (`packages/e2e/lib/account-auth-paths.ts`): an expired session bounces to
 * login carrying `returnTo=/account` and returns; «Сменить пароль» hands off to
 * `/reset?returnTo=%2Faccount` and the completed reset returns to `/account`.
 * The values below are this host's auth-flow config
 * (`lib/auth-flow.host-config.ts`); the spec body is not repeated here.
 *
 * Rides the live tier `playwright.register-live.config.ts`: ENV
 * `E2E_DOCTOR_URL`, `MAILPIT_URL`; doctor server bound to IPv4.
 */
requireLiveStandEnv(["E2E_DOCTOR_URL", "MAILPIT_URL"]);

defineAccountAuthPathTests({
  host: HOSTS.doctor,
  resetPath: "/reset",
});
