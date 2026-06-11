import type {
  BotProtection,
  BotProtectionAction,
  BotProtectionResult,
} from "./bot-protection.types.js";

/** Subset of `fetch` the adapter needs — narrowed so the spec can inject a fake. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface SmartCaptchaConfig {
  /**
   * Master switch, read **live per verification** (#185). When it returns `false`
   * (the dev-stand default — no Yandex account required) the verification
   * short-circuits to `ok`. The widget and guard stay wired end to end; only the
   * server-to-server validation is skipped. It is a callback (not a static
   * boolean) so the value comes from the live Unleash `bot-protection` flag on
   * every request — an operator toggle in the admin UI takes effect without a
   * restart. The callback owns the fail-closed fallback: when Unleash is
   * unreachable it returns the env bootstrap default (`BOT_PROTECTION_ENABLED`),
   * never an implicit "open". The unit fake passes a constant.
   */
  isEnabled: () => boolean;
  /** Yandex Cloud SmartCaptcha *server* key (the secret half of the keypair). */
  serverKey?: string | undefined;
  /** Validation endpoint; defaults to the Yandex Cloud SmartCaptcha service. */
  validateUrl: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike | undefined;
}

/** Shape of the Yandex SmartCaptcha validation response. */
interface YandexValidateResponse {
  status?: string;
  message?: string;
  host?: string;
}

/**
 * Yandex SmartCaptcha adapter (design §10.1, ADR-0001 open-q #7).
 *
 * RF-accessible CAPTCHA — hCaptcha/reCAPTCHA are deprecated in RF (ADR-0001
 * §5.5). It implements {@link BotProtection} by POSTing the widget token to the
 * Yandex validation endpoint with the server key and the client IP.
 *
 * Fail-closed contract: a misconfiguration (enabled with no server key), a
 * non-2xx response, or a transport error all resolve to `ok: false` — never an
 * open gate (ADR-0001 §5.5 risk row: captcha downtime ⇒ block + alert, not
 * "login without bot-protection"). The caller decides the user-facing response;
 * `reason` stays in the audit ledger (EARS-16), never on the wire.
 */
export class SmartCaptchaProvider implements BotProtection {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: SmartCaptchaConfig) {
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as FetchLike);
  }

  async verify(
    token: string,
    action: BotProtectionAction,
    clientIp: string,
  ): Promise<BotProtectionResult> {
    if (!this.config.isEnabled()) {
      return { ok: true, reason: "bot-protection-disabled" };
    }
    if (!this.config.serverKey) {
      // Enabled but unconfigured is an operator error — fail closed.
      return { ok: false, reason: "missing-server-key" };
    }
    if (!token) {
      return { ok: false, reason: "missing-token" };
    }

    const body = new URLSearchParams({
      secret: this.config.serverKey,
      token,
      ip: clientIp,
    }).toString();

    try {
      const res = await this.fetchImpl(this.config.validateUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        return { ok: false, reason: `validate-http-${res.status}` };
      }
      const data = (await res.json()) as YandexValidateResponse;
      return data.status === "ok"
        ? { ok: true, host: data.host }
        : { ok: false, reason: data.message ?? "validate-failed" };
    } catch (err) {
      // Transport error / timeout — fail closed (the action label aids the
      // audit trail for the operator alert).
      return {
        ok: false,
        reason: `validate-error:${action}:${err instanceof Error ? err.message : "unknown"}`,
      };
    }
  }
}

/** Default Yandex Cloud SmartCaptcha server-side validation endpoint. */
export const SMARTCAPTCHA_VALIDATE_URL =
  "https://smartcaptcha.yandexcloud.net/validate";
