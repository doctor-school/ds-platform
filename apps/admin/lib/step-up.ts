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
export function isStepUpRequired(
  error: unknown,
): error is {
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

/** A same-origin admin path: one leading `/`, never `//` or `/\` (a host). */
function isAdminPath(value: string): boolean {
  return /^\/(?![/\\])/.test(value);
}

/**
 * The code screen to send the operator to: the server's `stepUpUrl` plus the
 * page to return to and the refused endpoint the re-verification names (the API
 * records it on the `auth.step_up.*` row and accepts only a `stepUp` route).
 * `null` for a `stepUpUrl` that is not an admin path — never followed off-origin.
 */
export function stepUpChallengeHref(
  stepUpUrl: string,
  returnTo: string,
  endpoint: string,
): string | null {
  if (!isAdminPath(stepUpUrl)) return null;
  const url = new URL(stepUpUrl, "http://admin.invalid");
  if (url.origin !== "http://admin.invalid") return null;
  url.searchParams.set("returnTo", returnTo);
  url.searchParams.set("endpoint", endpoint);
  return `${url.pathname}${url.search}`;
}

/** The re-verify screen's `returnTo`, accepted only as an admin path. */
export function reverifyReturnTo(raw: string | null): string {
  return raw !== null && isAdminPath(raw) ? raw : FALLBACK_RETURN;
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
