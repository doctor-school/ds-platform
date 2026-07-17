import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditContext } from "@ds/db";

// 010 — Universal edit audit, EARS-3/EARS-5 (Issue #1088): the request-scoped
// audit context. `AuditContextInterceptor` populates this store once per HTTP
// request (actor sub + source door); `withRequestAuditContext` reads it inside
// the mutating transaction and sets the `SET LOCAL` GUCs the capture trigger
// reads. AsyncLocalStorage carries the context down the async call stack WITHOUT
// threading it through every service/repository signature — so a NEW mutating
// endpoint is attributed automatically, never "only if the author remembered
// the wrapper" (the app-layer-capture failure mode 010-design §6 rejects).

/** The per-request audit context store. Empty outside an HTTP request (jobs, migrations, psql). */
export const auditContextStore = new AsyncLocalStorage<AuditContext>();

/** The current request's audit context, or `undefined` for a context-less write (→ EARS-4 db-direct). */
export function getAuditContext(): AuditContext | undefined {
  return auditContextStore.getStore();
}
