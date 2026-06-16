/**
 * Runtime feature-flag port (#185).
 *
 * The api reads dev-stand runtime flags from Unleash so an operator can flip a
 * switch in the Unleash admin UI without editing `.env.local` and restarting the
 * service. The concrete adapter wraps the Unleash **server SDK**
 * (`unleash-client`); call sites depend on this narrow port by the
 * {@link FEATURE_FLAGS} token so the SDK is swappable and — crucially — fakeable
 * in the unit specs (the `@ds/api` suite runs without a live Unleash, ADR-0007
 * CI topology: api tests run only in `api-e2e`).
 *
 * Precedence + fallback (design of record §4): when Unleash is reachable its
 * value wins; when it is unreachable / the flag is absent, the caller-supplied
 * `defaultValue` (sourced from env) is returned. The bootstrap default is the
 * env value; the **fallback** is also the env value — so an Unleash outage never
 * silently changes behaviour, and for the security flag (`bot-protection`) the
 * caller passes a **fail-closed** default (Unleash-unreachable must not open the
 * gate).
 */
export interface FeatureFlags {
  /**
   * Read a boolean flag **live**. `defaultValue` is returned when Unleash is
   * unreachable or the flag is unknown — the SDK's own fallback contract — so a
   * flag read is a pure function of (live Unleash state, env default) with no
   * throw path. Per-request callers (the captcha guard/provider) call this on
   * every request, so a mid-session toggle takes effect without a restart.
   */
  isEnabled(flag: FlagName, defaultValue: boolean): boolean;

  /**
   * Register a listener fired when the flag set changes (the SDK `changed`
   * poll). The delivery reconcile (which repoints Zitadel's active provider)
   * subscribes here so a flag flip drives a `…/_activate` call rather than being
   * re-read per request. Returns an unsubscribe handle. A no-op when the adapter
   * has no live SDK (env-only fallback mode) — the reconcile then never fires and
   * the boot-time env mode stands, which is the documented fallback.
   */
  onChange(listener: () => void): () => void;

  /**
   * Register a listener fired once the SDK has completed its **first successful
   * poll** of the Unleash server (the `synchronized` event). Distinct from
   * {@link onChange}, which fires only on a *subsequent* toggle: a flag that is
   * already steadily ON at boot never emits `changed`, so the delivery reconcile
   * subscribes here to converge a steady-ON flag once real server state is known
   * — without waiting for an operator to toggle it (#214 defect C). Before this
   * fires, {@link isEnabled} returns the caller's env default (the unsynchronised
   * fallback), so the boot-time reconcile may pick the wrong provider; this hook
   * is the signal to re-reconcile. Returns an unsubscribe handle. A no-op when the
   * adapter has no live SDK (env-only fallback mode) — there is no remote state to
   * sync to, so the boot-time env mode stands (the documented fallback).
   */
  onSynchronized(listener: () => void): () => void;
}

/** The three dev-stand runtime flags this migration owns (#185, design §1/§5). */
export type FlagName =
  | "bot-protection"
  | "email-delivery-real"
  | "sms-delivery-real";

/** Canonical flag-name constants (avoid stringly-typed call sites). */
export const FLAG_BOT_PROTECTION = "bot-protection" as const;
export const FLAG_EMAIL_DELIVERY_REAL = "email-delivery-real" as const;
export const FLAG_SMS_DELIVERY_REAL = "sms-delivery-real" as const;
