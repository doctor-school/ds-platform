import { parseSameOriginReturnTarget } from "@ds/schemas";

import type { AuthFlowRoutes } from "./host-config";

/**
 * Rule S3 (#2027) — decorate a footer link with the arrival context.
 *
 * The value carried onward is the same-origin guard's own RECONSTRUCTION, never
 * the visitor's raw string, so a hostile target is dropped here and cannot be
 * propagated into `/register` or `/reset` by the door that received it.
 *
 * Shared by BOTH doors (#2331): the sign-in door carries the context onto
 * «Создать аккаунт» / «Забыли пароль», the registration door onto «Уже есть
 * аккаунт? Войти» and onto the confirmation step of a host that serves one as a
 * route of its own. One rule, one place.
 */
export function withReturnTarget(
  path: string,
  rawReturnTo: string | null | undefined,
): string {
  const safe = parseSameOriginReturnTarget(rawReturnTo ?? null);
  if (!safe) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}returnTo=${encodeURIComponent(safe)}`;
}

/**
 * #2487 — the auth doors of a host: the routes whose shell header sign-in link
 * carries NO return target, because a visitor standing on a door must never be
 * sent back to it after signing in. Derived from the host's own route table, so
 * a host that serves a door elsewhere gets it excluded by configuration.
 */
export function authDoorPaths(
  routes: Pick<AuthFlowRoutes, "login" | "register" | "verify" | "reset">,
): readonly string[] {
  return [routes.login, routes.register, routes.verify, routes.reset];
}
