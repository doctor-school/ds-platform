"use client";

import type { RegisterCardValues } from "@ds/design-system/blocks";

/**
 * 003 EARS-24 amended — the typed registration fields «← Изменить почту»
 * refills, carried across a FULL page load in this tab (#3172).
 *
 * The in-memory hold (`@ds/design-system/blocks` `pending-registration`)
 * survives only a client-side hop. On the sign-in host the door moves to its
 * code step by a full page load (the host proxy refuses non-top-level requests
 * to a door, EARS-70), so the module singleton is gone when the visitor steps
 * back. The NON-SECRET fields — address, promo code, consent ticks — therefore
 * ride the tab's `sessionStorage`: same tab is the spec's own boundary, and a
 * second tab starts empty.
 *
 * The PASSWORD is never written here (003-design «No password is stored
 * anywhere new»): after «← Изменить почту» the password field is empty and
 * re-typed. Every storage access is guarded — blocked storage simply means no
 * refill, the behaviour before this carrier existed.
 */

const KEY = "ds.auth-flow.registration-form";

/** What the tab holds: the form minus the password. */
interface StoredDraft {
  readonly email: string;
  readonly promoCode: string;
  readonly consents: Record<string, boolean>;
}

function isStoredDraft(value: unknown): value is StoredDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Record<string, unknown>;
  if (typeof draft.email !== "string") return false;
  if (typeof draft.promoCode !== "string") return false;
  if (typeof draft.consents !== "object" || draft.consents === null) {
    return false;
  }
  return Object.values(draft.consents).every((v) => typeof v === "boolean");
}

/** Hold the typed fields — never the password — for this tab's way back. */
export function writeRegistrationFormDraft(form: RegisterCardValues): void {
  const draft: StoredDraft = {
    email: form.email,
    promoCode: form.promoCode,
    consents: { ...form.consents },
  };
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Blocked storage: the form simply opens empty on the way back.
  }
}

/** The fields this tab holds, the password empty; `undefined` when none. */
export function readRegistrationFormDraft(): RegisterCardValues | undefined {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return undefined;
    const draft: unknown = JSON.parse(raw);
    if (!isStoredDraft(draft)) return undefined;
    return {
      email: draft.email,
      password: "",
      promoCode: draft.promoCode,
      consents: { ...draft.consents },
    };
  } catch {
    return undefined;
  }
}

/** Drop the held fields (accepted code / a new submit). */
export function clearRegistrationFormDraft(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Blocked storage holds nothing to drop.
  }
}
