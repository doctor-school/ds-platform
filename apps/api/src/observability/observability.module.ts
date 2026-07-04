import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { SentryExceptionFilter } from "./sentry-exception.filter.js";

/**
 * Observability wiring (DSO-125) — registers the global {@link SentryExceptionFilter}
 * that reports 5xx / unexpected errors to Sentry/GlitchTip. The SDK itself is
 * initialised in `main.ts` (`initSentry`, before the app is created); this module
 * only binds the reporting filter into the request pipeline. Inert when Sentry is
 * disabled (no SENTRY_DSN).
 */
@Module({
  providers: [{ provide: APP_FILTER, useClass: SentryExceptionFilter }],
})
export class ObservabilityModule {}
