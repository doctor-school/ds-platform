# `observability` — error monitoring (GlitchTip)

Wires the api into **self-hosted GlitchTip** (Sentry-compatible) error monitoring
(DSO-125). GlitchTip is the 152-ФЗ-compliant, RF-zone replacement for Sentry SaaS
(ADR-0004 §15 / ADR-0005 §10): the prod api reports over the private VPC to a
GlitchTip collector on data-prod. The whole module is **inert unless `SENTRY_DSN`
is set** — unset on the dev-stand / CI (a no-op, exactly like the IdP / Redis /
Unleash fakes), set only in the prod deployment (`/etc/ds-platform/api.env`).

## The two pieces

| Piece                                                  | Role                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initSentry` (`instrument.ts`)                         | Initialises `@sentry/node` from `SENTRY_DSN` (+ `SENTRY_ENVIRONMENT` / `SENTRY_TRACES_SAMPLE_RATE`). Called **first** in `main.ts` `bootstrap()`, before the Nest app is created, so the SDK's global handlers register ahead of app code. Returns `false` (no-op) when no DSN.                                                                    |
| `SentryExceptionFilter` (`sentry-exception.filter.ts`) | Global exception filter (bound via `APP_FILTER` in `observability.module.ts`). Reports **5xx / non-`HttpException`** errors to GlitchTip, then defers to Nest's `BaseExceptionFilter` so client-facing responses are unchanged. 4xx client errors (validation / auth / not-found) are NOT reported — expected control flow, not monitoring signal. |

## PII discipline (ADR-0011)

`initSentry` sets `sendDefaultPii: false`, disables breadcrumbs (`maxBreadcrumbs: 0`),
and a `beforeSend` strips the request (headers / cookies / query / body), the user
context, and the server name — an event carries the **exception + stack trace only**,
never a doctor's identifier, phone, or email. This is unit-asserted in
`instrument.spec.ts`; the filter's reporting policy in `sentry-exception.filter.spec.ts`.

## Exports

- `initSentry(env?)` — idempotent init guard; returns whether the SDK was enabled.
- `SentryExceptionFilter` — the global reporting filter.
- `ObservabilityModule` — binds the filter as `APP_FILTER`; imported by `AppModule`.

## Deploy

The GlitchTip collector, its DB/role, the DSN, and the SSH-tunnel access recipe live
in [`infra/deploy/README.md` → GlitchTip error monitoring](../../../../infra/deploy/README.md).
