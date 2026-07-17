import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Observable, type Subscription } from "rxjs";
import type { AuditContext, AuditSource } from "@ds/db";
import { auditContextStore } from "./audit-context.js";

// 010 — Universal edit audit, EARS-3/EARS-5 (Issue #1088). Global interceptor
// (APP_INTERCEPTOR, sibling of TimingEqualizationInterceptor) that runs every
// request handler inside an AsyncLocalStorage scope carrying the acting
// principal + the write door, so `withRequestAuditContext` (the repo-layer tx
// wrapper) can attribute the capture-trigger rows without per-callsite code.

/**
 * Derive the closed-set `app.source` for a request from its route. Admin-app
 * routes (`/v1/admin/**`) are the `admin-ui` door; every other authenticated
 * API route is `portal-api`. A genuinely context-less write (background job,
 * psql, migration) never reaches this interceptor and degrades to `db-direct`.
 */
export function deriveSource(url: string): AuditSource {
  return url.includes("/admin/") ? "admin-ui" : "portal-api";
}

@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Non-HTTP execution contexts (were any added) carry no request/actor —
    // pass through untouched so the write degrades to db-direct (EARS-4).
    if (context.getType() !== "http") return next.handle();

    const req = context.switchToHttp().getRequest<{
      user?: { sub?: string };
      url?: string;
    }>();
    const ctx: AuditContext = {
      actorSub: req.user?.sub ?? null,
      source: deriveSource(req.url ?? ""),
    };

    // Run the handler (and every service/repository await beneath it) inside the
    // ALS scope. Subscribing to `next.handle()` synchronously within
    // `store.run(...)` is what makes the downstream async chain inherit the
    // context — the same mechanism nestjs-cls uses; `run` (not `enterWith`)
    // means no cross-request leakage.
    return new Observable((subscriber) => {
      let inner: Subscription | undefined;
      auditContextStore.run(ctx, () => {
        inner = next.handle().subscribe(subscriber);
      });
      return () => inner?.unsubscribe();
    });
  }
}
