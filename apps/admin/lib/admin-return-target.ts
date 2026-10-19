/**
 * #2782 — the page a signed-out admin is returned to once the sign-in completes:
 * 011 requires the login screen to «return the operator to their intended
 * route» (`specs/features/011-*` requirements, SameSite cost).
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

/**
 * A backslash, whitespace, or a C0 control / DEL — the characters the WHATWG
 * parser rewrites or silently strips.
 */
function hasUnsafeCharacter(value: string): boolean {
  if (value.includes("\\") || /\s/.test(value)) return true;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** `path` after one decode pass is free of unsafe characters and not `//`-led. */
function decodedPathIsSafe(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  return !hasUnsafeCharacter(decoded) && !decoded.startsWith("//");
}

/** The validated admin target for `raw`, or `null` when it may not be carried. */
export function resolveAdminReturnTarget(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Parser differential: browsers read `\` as `/` and the WHATWG parser strips
  // tab/newline, so `/\evil` or `/\t/evil` become protocol-relative there while
  // looking path-absolute here. Refuse them raw…
  if (hasUnsafeCharacter(raw) || /%5c/i.test(raw)) return null;
  // …and after one decode pass of the path, where `%2F%2F`, `%09`, `%5C` can
  // re-form the same shape in a consumer that decodes before routing. The query
  // and fragment are data (`?x=//a` is fine) and are not decoded here.
  if (!decodedPathIsSafe(raw.split(/[?#]/, 1)[0] ?? "")) return null;

  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;

  const { pathname } = url;
  if (pathname === "/" || pathname.startsWith("//")) return null;
  // Dot-segment normalisation can itself produce such a shape
  // (`/%2e%2e/%2fevil` → `/%2fevil`, which decodes to `//evil`), so the
  // normalised path passes the same check: the output is then a fixed point —
  // re-validating a returned target returns it unchanged.
  if (!decodedPathIsSafe(pathname)) return null;
  const refused = REFUSED_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
  if (refused) return null;

  return readableNonAscii(`${pathname}${url.search}${url.hash}`);
}

/**
 * #2998 — the parsed URL reports a Cyrillic path as `%D1%82…`. Carried like
 * that, the `?to=` hop encodes it a second time (`%25D1%2582…`). The target is
 * therefore returned with its non-ASCII escapes decoded — the readable path the
 * browser shows — so that hop encodes it exactly once.
 *
 * Only runs of escaped non-ASCII bytes (`%80`–`%FF`) are decoded, after every
 * check above has passed on the encoded form: such a character can be neither a
 * delimiter nor `%`, and the URL parser re-encodes it to the same bytes, so the
 * result stays a fixed point. A run that is not valid UTF-8 stays escaped, and
 * so does each decoded character the validator refuses raw (a no-break space).
 */
function readableNonAscii(target: string): string {
  return target.replace(/(?:%[89a-f][0-9a-f])+/gi, (run) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(run);
    } catch {
      return run;
    }
    return Array.from(decoded, (ch) =>
      hasUnsafeCharacter(ch) ? encodeURIComponent(ch) : ch,
    ).join("");
  });
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
