import { parseSameOriginReturnTarget } from "@ds/schemas";

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
