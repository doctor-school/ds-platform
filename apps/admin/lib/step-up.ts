/**
 * 047 EARS-8 — the console half of the step-up (ADR-0001 §10, 047-design
 * «Fresh second factor»).
 *
 * A `stepUp` route refuses a session whose second factor is older than 30
 * minutes with `401 STEP_UP_REQUIRED` and the `stepUpUrl` of the admin code
 * screen. That refusal is not a lost session (`authProvider.onError` leaves it
 * alone): the screen that sent the request saves it here — method, path, body
 * and the display context the form needs to restore itself — sends the operator
 * to the code screen in re-verify mode, and on the way back reads the saved
 * request once and sends it again. Neither body carries a secret (the temporary
 * password exists only in a grant RESPONSE), so `sessionStorage` is a fit place.
 *
 * Storage is optional: blocked or cleared, nothing is saved, the screen opens as
 * usual on return and the administrator repeats the action — inside the fresh
 * 30-minute window, so it asks for no code.
 */

/** The one key the pending request lives under. */
export const STEP_UP_STORAGE_KEY = "ds-admin:step-up-request";

/** The `Storage` subset this module touches — `window.sessionStorage` fits it. */
export interface StepUpStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedStepUpRequest {
  method: "POST";
  /** The API path the request was sent to — the key it is read back by. */
  path: string;
  body: unknown;
  /** What the screen needs to restore the form beside the body (labels, …). */
  context: Record<string, unknown>;
}

/** Where a re-verification lands when no valid return path came with it. */
const FALLBACK_RETURN = "/events";

/** A `401 STEP_UP_REQUIRED` refusal carrying the code screen to go to. */
export function isStepUpRequired(error: unknown): error is {
  statusCode: 401;
  errorCode: "STEP_UP_REQUIRED";
  stepUpUrl: string;
} {
  if (typeof error !== "object" || error === null) return false;
  const { statusCode, errorCode, stepUpUrl } = error as {
    statusCode?: unknown;
    errorCode?: unknown;
    stepUpUrl?: unknown;
  };
  return (
    statusCode === 401 &&
    errorCode === "STEP_UP_REQUIRED" &&
    typeof stepUpUrl === "string" &&
    stepUpUrl.length > 0
  );
}

/** A fixed base the candidate paths are resolved against — never a real origin. */
const ADMIN_BASE_ORIGIN = "http://admin.invalid";

/** ASCII control characters (incl. tab/LF/CR, which URL parsers strip) or a backslash. */
function hasUnsafePathChars(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || char === "\\") return true;
  }
  return false;
}

/**
 * The normalised same-origin admin path of `raw` — `pathname + search + hash`
 * of the PARSED URL, never the raw string — or `null`.
 *
 * A prefix check on the raw string is not enough: the WHATWG parser strips
 * tab/LF/CR, so `/\t/evil.com` reads as `//evil.com`, a host. So the candidate
 * is refused outright when it (or its percent-decoded form) carries a control
 * character or a backslash, then resolved against a fixed base and accepted
 * only when it stays on that origin and its path does not begin with `//`.
 */
export function adminPathOf(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  if (hasUnsafePathChars(raw)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (hasUnsafePathChars(decoded) || decoded.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(raw, ADMIN_BASE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== ADMIN_BASE_ORIGIN) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  return path.startsWith("/") && !path.startsWith("//") ? path : null;
}

/**
 * The code screen to send the operator to: the server's `stepUpUrl` plus the
 * page to return to and the refused endpoint the re-verification names (the API
 * records it on the `auth.step_up.*` row and accepts only a `stepUp` route).
 * `null` when either the `stepUpUrl` or the return path is not a same-origin
 * admin path — never followed off-origin.
 */
export function stepUpChallengeHref(
  stepUpUrl: string,
  returnTo: string,
  endpoint: string,
): string | null {
  const challenge = adminPathOf(stepUpUrl);
  const back = adminPathOf(returnTo);
  if (challenge === null || back === null) return null;
  const url = new URL(challenge, ADMIN_BASE_ORIGIN);
  url.searchParams.set("returnTo", back);
  url.searchParams.set("endpoint", endpoint);
  return `${url.pathname}${url.search}`;
}

/** The re-verify screen's `returnTo`, normalised, accepted only as an admin path. */
export function reverifyReturnTo(raw: string | null): string {
  return adminPathOf(raw) ?? FALLBACK_RETURN;
}

/** Save the refused request; `false` when there is no usable storage. */
export function saveStepUpRequest(
  storage: StepUpStorage | null,
  request: SavedStepUpRequest,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STEP_UP_STORAGE_KEY, JSON.stringify(request));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the saved request for `path` and remove it, so it is sent again once.
 * A request saved for another path stays for its own screen.
 */
export function takeStepUpRequest(
  storage: StepUpStorage | null,
  path: string,
): SavedStepUpRequest | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STEP_UP_STORAGE_KEY);
    if (raw === null) return null;
    let saved: unknown;
    try {
      saved = JSON.parse(raw);
    } catch {
      storage.removeItem(STEP_UP_STORAGE_KEY);
      return null;
    }
    if (
      typeof saved !== "object" ||
      saved === null ||
      (saved as { method?: unknown }).method !== "POST" ||
      typeof (saved as { path?: unknown }).path !== "string"
    ) {
      storage.removeItem(STEP_UP_STORAGE_KEY);
      return null;
    }
    if ((saved as SavedStepUpRequest).path !== path) return null;
    storage.removeItem(STEP_UP_STORAGE_KEY);
    const request = saved as SavedStepUpRequest;
    return { ...request, context: request.context ?? {} };
  } catch {
    return null;
  }
}

/** `window.sessionStorage` when the browser allows it, else `null`. */
export function browserStepUpStorage(): StepUpStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
