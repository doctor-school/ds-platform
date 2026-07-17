import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditContextInterceptor } from "./audit-context.interceptor.js";

/**
 * 010 — Universal edit audit, EARS-3/EARS-5 (Issue #1088). Registers the global
 * {@link AuditContextInterceptor} so every request runs inside the audit-context
 * AsyncLocalStorage scope; the repo-layer `withRequestAuditContext` reads it and
 * sets the per-transaction GUCs the capture trigger (#1087) attributes rows
 * from. `@Global` mirrors {@link TimingEqualizationModule} — one registration,
 * every mutating endpoint covered, no per-controller wiring.
 */
@Global()
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor }],
})
export class AuditModule {}
