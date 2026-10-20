import { resolveAuthFlowCopy } from "@ds/auth-flow/copy";
import { withReturnContext } from "@ds/auth-flow/server";

import type { AccountHostConfig } from "../host-config";
import type { AccountCabinetProps } from "./account-cabinet";

/**
 * The host config projected onto the client cabinet's props — plain data that
 * crosses the server→client boundary. Every carried target is built here by
 * the shared `withReturnContext` out of the host's own route values (gate D3,
 * rule S3 of the auth-flow standard), never spelled as a literal.
 */
export function accountCabinetProps(
  config: AccountHostConfig,
): AccountCabinetProps {
  const { authFlow } = config;
  const { login, reset, account } = authFlow.routes;
  return {
    api: authFlow.api,
    // 014 EARS-6 — the expired-session bounce carries the cabinet (row 5).
    expiredHref: withReturnContext(authFlow, login, account),
    // 003 EARS-11/12 — the password handoff carries the cabinet (row 12).
    passwordHref: withReturnContext(authFlow, reset, account),
    eventsHref: config.eventsHref,
    congressPath: config.congress?.path ?? null,
    saveErrors: resolveAuthFlowCopy(authFlow).errors,
  };
}
