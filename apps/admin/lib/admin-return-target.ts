/**
 * #2782 — the page a signed-out admin is returned to once the sign-in completes.
 *
 * The target rides as a URL parameter across `/login` → `/mfa/challenge` or
 * `/mfa/enroll` → landing. It is named `to` because that is the parameter
 * Refine's `<Authenticated>` already appends when it bounces an unauthenticated
 * page to `/login` (`appendCurrentPathToQuery`); the 401 path in the auth
 * provider writes the same parameter, so both entrances arrive in one shape.
 *
 * Because anyone can write that parameter into a link, it is validated at every
 * read and every re-carry, never trusted: only a same-origin, path-absolute
 * admin page survives. The rules follow the storefront return-target canon
 * (`@ds/auth-flow` `return-context-href.ts`) — no scheme, no protocol-relative
 * `//`, no backslash, no control characters — but the admin keeps its own copy:
 * the storefront validators admit only their host's account/room/эфир
 * vocabulary from the storefront host config, which is not the admin's route
 * set and must not become an admin dependency.
 *
 * The sign-in screens themselves are never a destination (a `/login` → `/login`
 * loop), nor are non-page paths served by the same origin (the `/v1` API proxy,
 * Next internals). Anything refused falls back to {@link ADMIN_LANDING}.
 */

/** The landing after sign-in when no valid target was carried. */
export const ADMIN_LANDING = "/events";

/** The carried-target search parameter — Refine `<Authenticated>`'s own. */
export const RETURN_TARGET_PARAM = "to";

/** Path roots that are never a return destination (segment-bounded). */
const REFUSED_ROOTS = ["/login", "/mfa", "/v1", "/api", "/_next"] as const;

/** A throwaway base: only same-origin resolution is being tested against it. */
const PROBE_ORIGIN = "https://admin.invalid";

/** C0 controls and DEL — the characters the URL parser silently strips. */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** The validated admin target for `raw`, or `null` when it may not be carried. */
export function resolveAdminReturnTarget(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // A backslash (raw or percent-encoded) is read as `/` by browsers, which turns
  // `/\evil.example` into a protocol-relative URL; control characters are
  // stripped by the URL parser and can smuggle the same shape.
  if (raw.includes("\\") || /%5c/i.test(raw) || hasControlCharacter(raw)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;

  const { pathname } = url;
  if (pathname === "/") return null;
  const refused = REFUSED_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
  if (refused) return null;

  return `${pathname}${url.search}${url.hash}`;
}

/** Where a completed sign-in lands: the valid target, else {@link ADMIN_LANDING}. */
export function adminLandingFor(raw: string | null | undefined): string {
  return resolveAdminReturnTarget(raw) ?? ADMIN_LANDING;
}

/** `path` with the target appended as `?to=` — only when the target is valid. */
export function withAdminReturnTarget(
  path: string,
  raw: string | null | undefined,
): string {
  const target = resolveAdminReturnTarget(raw);
  if (!target) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${RETURN_TARGET_PARAM}=${encodeURIComponent(target)}`;
}

/** The validated target carried in a `location.search` string, or `null`. */
export function returnTargetFromSearch(search: string): string | null {
  return resolveAdminReturnTarget(
    new URLSearchParams(search).get(RETURN_TARGET_PARAM),
  );
}

/** The validated target carried in the current browser URL, or `null`. */
export function currentReturnTarget(): string | null {
  if (typeof window === "undefined") return null;
  return returnTargetFromSearch(window.location.search);
}

/** The page the browser is on now, as a carry-able target, or `null`. */
export function currentPageAsReturnTarget(): string | null {
  if (typeof window === "undefined") return null;
  const { pathname, search, hash } = window.location;
  return resolveAdminReturnTarget(`${pathname}${search}${hash}`);
}
