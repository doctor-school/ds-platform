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
 * The replay is bound and bounded, because a privileged action sent on its own
 * must be the one this administrator just confirmed with a code:
 * - **bound to the admin session** — the saved request carries the session's
 *   CSRF token (`__Host-ds_admin_csrf`, minted per session at sign-in and already
 *   readable by the console), and only the same session gets it back; a request
 *   saved under another session — another administrator signed in in this tab —
 *   is discarded;
 * - **only after a confirmed code** — the code screen marks the confirmation once
 *   `mfa/reverify` answers `200` ({@link markStepUpConfirmed}); without a mark
 *   newer than the saved request (an abandoned code screen, a later plain visit
 *   to the section) the request is discarded, never sent;
 * - **within {@link STEP_UP_REPLAY_TTL_MS}**, shorter than the 30-minute step-up
 *   window;
 * - **cleared on sign-out** — `authProvider.logout`, which the 401 path also
 *   runs ({@link clearStepUpRequest}).
 *
 * Storage is optional: blocked or cleared, nothing is saved, the screen opens as
 * usual on return and the administrator repeats the action — inside the fresh
 * 30-minute window, so it asks for no code.
 */

/** The one key the pending request lives under. */
export const STEP_UP_STORAGE_KEY = "ds-admin:step-up-request";

/** The one-shot mark the code screen leaves after a successful re-verification. */
export const STEP_UP_CONFIRMED_KEY = "ds-admin:step-up-confirmed";

/**
 * How long a saved request may wait for its code — well inside the 30-minute
 * step-up window (ADR-0001 §10), long enough to open the authenticator.
 */
export const STEP_UP_REPLAY_TTL_MS = 10 * 60_000;

/**
 * Who is asking and when: `owner` is the current admin session's binding (its
 * CSRF token, `adminCsrfToken()`), `null` when no session is readable.
 */
export interface StepUpReplayScope {
  owner: string | null;
  now: number;
}

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

/** The saved request as stored: bound to its session and stamped with its time. */
export interface BoundStepUpRequest extends SavedStepUpRequest {
  owner: string;
  savedAt: number;
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

/**
 * Save the refused request, bound to the current session; `false` when there is
 * no usable storage or no session to bind it to. A confirmation left from an
 * earlier code is dropped, so only a code entered after this save counts.
 */
export function saveStepUpRequest(
  storage: StepUpStorage | null,
  request: SavedStepUpRequest,
  scope: StepUpReplayScope,
): boolean {
  if (!storage || !scope.owner) return false;
  const bound: BoundStepUpRequest = {
    ...request,
    owner: scope.owner,
    savedAt: scope.now,
  };
  try {
    storage.removeItem(STEP_UP_CONFIRMED_KEY);
    storage.setItem(STEP_UP_STORAGE_KEY, JSON.stringify(bound));
    return true;
  } catch {
    return false;
  }
}

/** The code screen, after `mfa/reverify` answered `200`: the code is confirmed. */
export function markStepUpConfirmed(
  storage: StepUpStorage | null,
  now: number,
): void {
  if (!storage) return;
  try {
    storage.setItem(STEP_UP_CONFIRMED_KEY, JSON.stringify({ at: now }));
  } catch {
    // No storage: nothing was saved either, so there is nothing to replay.
  }
}

/** Sign-out: drop the saved request and its confirmation. */
export function clearStepUpRequest(storage: StepUpStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(STEP_UP_STORAGE_KEY);
    storage.removeItem(STEP_UP_CONFIRMED_KEY);
  } catch {
    // Blocked storage holds nothing to clear.
  }
}

function parsed(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isBoundRequest(value: unknown): value is BoundStepUpRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<BoundStepUpRequest>;
  return (
    v.method === "POST" &&
    typeof v.path === "string" &&
    typeof v.owner === "string" &&
    typeof v.savedAt === "number"
  );
}

/**
 * The saved request for `path`, read once — or `null`. It comes back only for
 * the session that saved it, after a code confirmed since it was saved, within
 * {@link STEP_UP_REPLAY_TTL_MS}; any other saved request for `path` is
 * discarded together with the confirmation. A request saved for another path
 * stays for its own screen.
 */
export function takeStepUpRequest(
  storage: StepUpStorage | null,
  path: string,
  scope: StepUpReplayScope,
): BoundStepUpRequest | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STEP_UP_STORAGE_KEY);
    if (raw === null) return null;
    const saved = parsed(raw);
    if (isBoundRequest(saved) && saved.path !== path) return null;
    const confirmed = parsed(storage.getItem(STEP_UP_CONFIRMED_KEY)) as {
      at?: unknown;
    } | null;
    clearStepUpRequest(storage);
    if (!isBoundRequest(saved)) return null;
    const confirmedAt =
      typeof confirmed?.at === "number" ? confirmed.at : Number.NaN;
    const replayable =
      scope.owner !== null &&
      saved.owner === scope.owner &&
      confirmedAt >= saved.savedAt &&
      confirmedAt <= scope.now &&
      scope.now - saved.savedAt <= STEP_UP_REPLAY_TTL_MS;
    return replayable ? { ...saved, context: saved.context ?? {} } : null;
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
