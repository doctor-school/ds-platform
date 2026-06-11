/**
 * Delivery-reconcile contracts (#185).
 *
 * The api does NOT send OTP email/SMS — **Zitadel** does, using its currently
 * **active** provider. So "real send ↔ programmatic intercept" is *which provider
 * is active in Zitadel*, switched via the admin API `…/_activate`. A flag alone
 * cannot repoint Zitadel; this reconcile reacts to the Unleash flag and activates
 * the matching pre-configured provider. `provision.sh` ensures BOTH providers
 * exist with the stable `description` strings below; the reconcile only flips
 * which one is active (it holds no SMTP/SMS secrets, design of record §3).
 */

/**
 * Stable `description` strings `provision.sh` stamps on each Zitadel provider and
 * the reconcile matches on. They are the contract between the provisioner and the
 * api — changing one side without the other breaks the match (the reconcile then
 * finds no provider and logs a warning rather than activating the wrong one).
 */
export const SMTP_DESCRIPTION_INTERCEPT = "dev-stand mailpit";
export const SMTP_DESCRIPTION_REAL = "real transactional sender";
export const SMS_DESCRIPTION_INTERCEPT = "dev-stand sms-sink";
export const SMS_DESCRIPTION_REAL = "real sms-aero-adapter";

/** A Zitadel notification provider as the admin `_search` endpoints return it. */
export interface ZitadelProvider {
  /** Provider id — the `{id}` in `…/{id}/_activate`. */
  id: string;
  /** The stable recognizable label `provision.sh` set; the reconcile matches it. */
  description: string;
  /**
   * Whether this provider is the currently active one. Zitadel returns provider
   * state on `_search`; we normalise it to a boolean so the reconcile can skip a
   * redundant `_activate` (Zitadel rejects re-activating an already-active
   * provider — mirror provision.sh's `api_activate` tolerance).
   */
  active: boolean;
}

/**
 * The minimal Zitadel admin port the reconcile needs: list the SMTP / SMS
 * providers and activate one by id. Implemented against the real Zitadel admin
 * API by {@link ZitadelDeliveryAdmin}; faked in the unit spec (no live Zitadel in
 * the `@ds/api` suite).
 */
export interface DeliveryAdmin {
  listSmtpProviders(): Promise<ZitadelProvider[]>;
  listSmsProviders(): Promise<ZitadelProvider[]>;
  /** Activate a provider by id. Resolves on success OR on the already-active no-op. */
  activateSmtp(id: string): Promise<void>;
  activateSms(id: string): Promise<void>;
}
