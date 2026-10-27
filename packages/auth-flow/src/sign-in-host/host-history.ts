/**
 * 003 EARS-5 / EARS-24 / EARS-71 — the sign-in host's history: the host is ONE
 * stop of the person's journey, so it holds ONE history entry of its own (plus
 * the registration code step's, below), and every entry it holds is replaced
 * when the person leaves.
 *
 * - A hop between doors (`/login` ↔ `/register` ↔ `/reset`, the address-less
 *   `/verify`'s way back) is a top-level navigation — the host proxy answers
 *   only those (EARS-70) — that REPLACES the current entry: `hopHostDoor`.
 * - The registration door's in-place code step pushes ONE same-document entry
 *   of its own (`pushCodeStep`), so Back from the step shows the filled form
 *   again and Forward the step; the entry carries the address the code went to.
 * - A finished credential step leaves for the URL the API named (the IdP's
 *   callback, then the storefront's) by REPLACING the host's entry
 *   (`leaveHost`); from a code step THIS document pushed it first steps back
 *   onto the form's entry of the same document, so no host entry stands
 *   BEHIND the returned page: Back from it is the page the person was on
 *   before — never a host address whose auth request is spent (EARS-66 would
 *   send it on to the storefront's landing). A browser can overwrite an entry
 *   but never drop one, so the code step's entry survives AHEAD of the
 *   returned page; Forward opens its spent auth request, which EARS-66 sends
 *   to the storefront.
 * - A RELOADED code step (EARS-39) is a document of its own: the app router
 *   keeps the entry's state, but the form's entry behind it belongs to the
 *   earlier document, and stepping back onto it would load that spent
 *   request — the callback would never be visited. So the step back happens
 *   only on the document that pushed the entry (its mark in the entry's
 *   state); a reloaded step replaces its own entry. The form's entry then
 *   stays BEHIND the returned page: Back opens its spent auth request, which
 *   EARS-66 sends to the storefront.
 */

/** The `history.state` key of the code step's own entry: the address the code went to. */
export const CODE_STEP_STATE_KEY = "dsCodeStep";

/** The address of the code step a history entry belongs to, or `null` for any other entry. */
export function codeStepOf(state: unknown): string | null {
  if (state === null || typeof state !== "object") return null;
  const email = (state as Record<string, unknown>)[CODE_STEP_STATE_KEY];
  return typeof email === "string" && email.length > 0 ? email : null;
}

/**
 * The `history.state` key marking which document pushed the code step's entry.
 * The app router keeps an entry's state across a RELOAD, so a reloaded code
 * step still reads as one — but the reloaded document is not the one whose
 * history holds the form's entry as a same-document neighbour.
 */
export const CODE_STEP_DOCUMENT_KEY = "dsCodeStepDocument";

/** This document's own mark: a fresh value on every document load. */
const THIS_DOCUMENT = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * How long `leaveHost` waits for the step back's `popstate` before it replaces
 * the entry it is on regardless.
 */
export const LEAVE_POPSTATE_WAIT_MS = 400;

/**
 * Push the code step's own entry onto this document's history (no navigation,
 * no request). A fresh object, so the app router copies its own state into it
 * and adopts the address.
 */
export function pushCodeStep(href: string, email: string): void {
  leaving = false;
  window.history.pushState(
    { [CODE_STEP_STATE_KEY]: email, [CODE_STEP_DOCUMENT_KEY]: THIS_DOCUMENT },
    "",
    href,
  );
}

let leaving = false;

/** True once `leaveHost` runs: the document's own history listeners stand down. */
export function isLeavingHost(): boolean {
  return leaving;
}

/** A door hop: a top-level navigation that replaces the host's entry. */
export function hopHostDoor(href: string): void {
  window.location.replace(href);
}

/** True when the person is on a code-step entry THIS document pushed. */
function onOwnCodeStep(state: unknown): boolean {
  return (
    codeStepOf(state) !== null &&
    (state as Record<string, unknown>)[CODE_STEP_DOCUMENT_KEY] === THIS_DOCUMENT
  );
}

/**
 * Leave the host for `url`, replacing its history entry — after stepping back
 * off the code step's own entry when this document pushed it (a reloaded code
 * step, a document of its own, replaces its own entry instead). Should the
 * step back's `popstate` not arrive, it replaces after a short wait.
 */
export function leaveHost(url: string): void {
  leaving = true;
  if (!onOwnCodeStep(window.history.state)) {
    window.location.replace(url);
    return;
  }
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    window.location.replace(url);
  };
  window.addEventListener("popstate", leave, { once: true });
  window.setTimeout(leave, LEAVE_POPSTATE_WAIT_MS);
  window.history.back();
}
