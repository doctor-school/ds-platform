import * as Sentry from "@sentry/node";

/**
 * Error monitoring init — self-hosted GlitchTip (DSO-125). GlitchTip is the
 * RF-zone, 152-ФЗ-compliant replacement for Sentry SaaS (ADR-0004 §15 /
 * ADR-0005 §10); the api reports over the private VPC to data-prod.
 *
 * Gated on SENTRY_DSN: unset on the dev-stand / CI ⇒ this is a no-op (mirrors the
 * IdP / Redis / Unleash fakes — the app boots identically without the dependency),
 * set only in the prod deployment (`/etc/ds-platform/api.env`). Call FIRST in
 * `bootstrap()` (before `NestFactory.create`) so the SDK's global error handlers
 * register ahead of any application code.
 *
 * PII discipline (ADR-0011): `sendDefaultPii` is off, breadcrumbs are disabled,
 * and `beforeSend` strips the request (headers / cookies / query / body), the user
 * context, and the server name — an event carries the exception + stack trace
 * ONLY, never a doctor's identifier, phone, or email.
 *
 * @returns `true` when the SDK was initialised, `false` when disabled (no DSN).
 */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? "production",
    // Error monitoring only — no performance tracing by default (minimal
    // footprint); opt in per-deployment via SENTRY_TRACES_SAMPLE_RATE.
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    sendDefaultPii: false,
    // Disable breadcrumbs entirely — they can accumulate URLs / query strings /
    // payloads, and we keep the event surface to the exception + stack only.
    maxBreadcrumbs: 0,
    beforeSend(event) {
      // Strip every PII-bearing surface before the event leaves the process.
      delete event.request;
      delete event.user;
      delete event.server_name;
      return event;
    },
  });
  return true;
}
