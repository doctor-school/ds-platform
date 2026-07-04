import { Catch, HttpException, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import * as Sentry from "@sentry/node";

/**
 * Global exception filter that forwards server-side and unexpected errors to
 * Sentry/GlitchTip (DSO-125), then defers to Nest's default response handling
 * (`BaseExceptionFilter`) so client-facing behaviour is entirely unchanged.
 *
 * Reporting policy — signal, not noise:
 * - a non-`HttpException` (an unexpected fault) is ALWAYS reported;
 * - an `HttpException` with a 5xx status is reported;
 * - a 4xx `HttpException` (validation / auth / not-found — expected control flow)
 *   is NOT reported.
 *
 * When Sentry is disabled (no SENTRY_DSN ⇒ `initSentry` never ran),
 * `Sentry.captureException` is a safe no-op, so this filter is inert off-box.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (SentryExceptionFilter.shouldReport(exception)) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }

  private static shouldReport(exception: unknown): boolean {
    if (exception instanceof HttpException) {
      return exception.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR;
    }
    // Non-HttpException → unexpected → report.
    return true;
  }
}
