/** Stable identities shared with provision.sh; native login OTP remains Zitadel-sent. */
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
  /** SMTP metadata returned by Admin ListSMTPConfigs; passwords are never returned. */
  host?: string | undefined;
  tls?: boolean | undefined;
  user?: string | undefined;
  senderAddress?: string | undefined;
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
