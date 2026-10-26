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
 *   (`leaveHost`); from the code step it first steps back onto the form's
 *   entry of the same document, so no host entry stands BEHIND the returned
 *   page: Back from it is the page the person was on before — never a host
 *   address whose auth request is spent (EARS-66 would send it on to the
 *   storefront's landing). A browser can overwrite an entry but never drop
 *   one, so the code step's entry survives AHEAD of the returned page; Forward
 *   opens its spent auth request, which EARS-66 sends to the storefront.
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
 * Push the code step's own entry onto this document's history (no navigation,
 * no request). A fresh object, so the app router copies its own state into it
 * and adopts the address.
 */
export function pushCodeStep(href: string, email: string): void {
  leaving = false;
  window.history.pushState({ [CODE_STEP_STATE_KEY]: email }, "", href);
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

/**
 * Leave the host for `url`, replacing its history entry — after stepping back
 * off the code step's own entry when that is where the person is.
 */
export function leaveHost(url: string): void {
  leaving = true;
  if (codeStepOf(window.history.state) === null) {
    window.location.replace(url);
    return;
  }
  window.addEventListener("popstate", () => window.location.replace(url), {
    once: true,
  });
  window.history.back();
}
