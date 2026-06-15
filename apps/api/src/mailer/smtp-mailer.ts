import { Logger } from "@nestjs/common";
import { createTransport } from "nodemailer";
import { assertSendableEmail, type Mailer } from "./mailer.types.js";

/** One SMTP transport's resolved config — host unset ⇒ that transport is a no-op. */
export interface SmtpTransportConfig {
  /** SMTP host. **Unset ⇒ this transport is a logged no-op** (infra-gated). */
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  /** Envelope/From address for BFF notices (e.g. `noreply@doctor.school`). */
  from?: string | undefined;
}

/** Minimal transport surface the adapter needs — fakeable in the unit specs. */
export interface SmtpTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

/** Options nodemailer's `createTransport` is called with (the bit we assert on). */
export interface SmtpTransportFactoryOptions {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string } | undefined;
}

/** Builds a transport from resolved options — `nodemailer.createTransport` in prod. */
export type TransportFactory = (
  opts: SmtpTransportFactoryOptions,
) => SmtpTransport;

/** Diagnostic sink for the fail-soft "real creds absent" note (mirrors the reconcile). */
export type WarnFn = (message: string) => void;

/**
 * Dual-transport config (003 design §4, #209). The adapter carries BOTH the
 * intercept (`MAILER_SMTP_*`, Mailpit on the dev-stand) and the real
 * (`IDP_SMTP_REAL_*`) transports and selects per send from `isEnabled` — the live
 * `email-delivery-real` Unleash read — so a flag flip switches the BFF notice
 * Mailpit-intercept ↔ real with no restart, mirroring `DeliveryReconcileService`.
 */
export interface SmtpMailerConfig {
  /** The intercept transport (Mailpit) — the dev/test default and fail-soft target. */
  intercept: SmtpTransportConfig;
  /** The real relay transport (`IDP_SMTP_REAL_*`) — `undefined` when creds absent. */
  real?: SmtpTransportConfig | undefined;
  /**
   * Live `email-delivery-real` read (mirror `bot-protection.module.ts:42`): true ⇒
   * select the real transport, false ⇒ intercept. Read on EVERY send so a mid-
   * session flip takes effect without a restart; Unleash-unreachable falls back to
   * the `EMAIL_DELIVERY_MODE` env default (same contract as the reconcile).
   */
  isEnabled: () => boolean;
  /** Portal origin the notice links point at (`/login`, `/reset`). */
  portalBaseUrl: string;
  /** Override the transport builder (the unit specs inject a recording fake). */
  transportFactory?: TransportFactory | undefined;
  /** Override the warn sink (the unit specs assert on it). */
  warn?: WarnFn | undefined;
}

/** Subject + RU body of the account-exists notice — carries NO secret (EARS-23). */
function accountExistsMessage(portalBaseUrl: string): {
  subject: string;
  text: string;
  html: string;
} {
  const base = portalBaseUrl.replace(/\/+$/, "");
  const loginUrl = `${base}/login`;
  const resetUrl = `${base}/reset`;
  const subject = "Doctor.School — у вас уже есть аккаунт";
  // No verification/login code, token, or PD — only a sign-in / reset prompt
  // (the identity-credential emails are Zitadel's; this is a product notice).
  const text = [
    "Здравствуйте!",
    "",
    "Мы получили попытку регистрации с этим адресом электронной почты, но " +
      "у вас уже есть аккаунт Doctor.School. Создавать новый не нужно.",
    "",
    `Войти: ${loginUrl}`,
    `Сбросить пароль: ${resetUrl}`,
    "",
    "Если это были не вы, просто проигнорируйте это письмо — никаких " +
      "изменений в вашем аккаунте не произошло.",
    "",
    "Команда Doctor.School",
  ].join("\n");
  const html = [
    `<p>Здравствуйте!</p>`,
    `<p>Мы получили попытку регистрации с этим адресом электронной почты, ` +
      `но у вас уже есть аккаунт Doctor.School. Создавать новый не нужно.</p>`,
    `<p><a href="${loginUrl}">Войти</a> &nbsp;·&nbsp; ` +
      `<a href="${resetUrl}">Сбросить пароль</a></p>`,
    `<p>Если это были не вы, просто проигнорируйте это письмо — никаких ` +
      `изменений в вашем аккаунте не произошло.</p>`,
    `<p>Команда Doctor.School</p>`,
  ].join("\n");
  return { subject, text, html };
}

/** Default transport builder — wraps `nodemailer.createTransport`. */
const nodemailerFactory: TransportFactory = (opts) =>
  createTransport(opts) as unknown as SmtpTransport;

/**
 * Production {@link Mailer} over `nodemailer` (003 design §4) — the BFF's own
 * transactional-email channel (account-exists notice; lockout / welcome later),
 * deliberately separate from Zitadel's identity-credential emails (the ones that
 * carry a secret).
 *
 * Dual transport, flag-gated (#209): it carries an **intercept** transport
 * (`MAILER_SMTP_*`, Mailpit) and a **real** transport (`IDP_SMTP_REAL_*`) and
 * selects per send from the live `email-delivery-real` Unleash flag — so one flag
 * flip moves BOTH this notice and Zitadel's channel between Mailpit-intercept and
 * the real relay with no restart, mirroring `DeliveryReconcileService`. Fail-soft:
 *
 * - flag OFF (or Unleash-unreachable, env default `mailpit`) ⇒ intercept;
 * - flag ON but the real transport is unconfigured ⇒ **warn + use intercept**
 *   (never throw, never silently drop — mirrors the reconcile's "never activate the
 *   wrong provider" safety);
 * - the SELECTED transport's `host` unset ⇒ the existing logged no-op (infra-gated,
 *   like the IdP / Redis fakes): the dev-stand / CI without an SMTP host still boots
 *   and the EARS-23 path stays exercised (throttle + fire-and-forget hold; only the
 *   wire send is skipped).
 */
export class SmtpMailer implements Mailer {
  private readonly logger = new Logger(SmtpMailer.name);
  private readonly intercept: SmtpTransport | null;
  private readonly real: SmtpTransport | null;
  private readonly warn: WarnFn;

  constructor(private readonly config: SmtpMailerConfig) {
    const factory = config.transportFactory ?? nodemailerFactory;
    this.warn = config.warn ?? ((m) => this.logger.warn(m));
    this.intercept = buildTransport(config.intercept, factory);
    this.real = config.real ? buildTransport(config.real, factory) : null;
  }

  async sendAccountExistsNotice(email: string): Promise<void> {
    // Reject exactly what FakeMailer rejects (contract parity) — before any
    // transport decision, so no path is more permissive than the real adapter.
    assertSendableEmail(email);

    // Live flag read on EVERY send (mirror bot-protection.module.ts:42): a mid-
    // session flip takes effect with no restart; Unleash-unreachable already
    // resolved to the EMAIL_DELIVERY_MODE env default by the time we are called.
    const wantReal = this.config.isEnabled();

    let transport: SmtpTransport | null;
    let from: string | undefined;
    if (wantReal && this.real) {
      transport = this.real;
      from = this.config.real?.from;
    } else {
      if (wantReal && !this.real) {
        // Fail-soft: flag ON but the real relay is unconfigured. Never throw,
        // never silently drop — use intercept and warn (mirror the reconcile's
        // "never activate the wrong provider").
        this.warn(
          "email-delivery-real is ON but the real SMTP relay is unconfigured " +
            "(IDP_SMTP_REAL_* unset) — falling back to the Mailpit intercept " +
            "transport for the account-exists notice. Set IDP_SMTP_REAL_* to " +
            "deliver via the real relay.",
        );
      }
      transport = this.intercept;
      from = this.config.intercept.from;
    }

    if (!transport) {
      // Selected transport's host unset ⇒ the existing logged no-op.
      this.warn(
        `${
          wantReal ? "IDP_SMTP_REAL_HOST" : "MAILER_SMTP_HOST"
        } is unset — skipping the account-exists notice send (logged no-op).`,
      );
      return;
    }

    const { subject, text, html } = accountExistsMessage(
      this.config.portalBaseUrl,
    );
    await transport.sendMail({
      from: from ?? "noreply@doctor.school",
      to: email,
      subject,
      text,
      html,
    });
  }
}

/** Build a transport from one channel's config; `null` when the host is unset. */
function buildTransport(
  cfg: SmtpTransportConfig,
  factory: TransportFactory,
): SmtpTransport | null {
  if (!cfg.host) return null;
  const port = cfg.port ?? 1025;
  return factory({
    host: cfg.host,
    port,
    // Mailpit on dev is plaintext on 1025; secure only on the conventional 465.
    secure: port === 465,
    auth: cfg.user && cfg.password ? { user: cfg.user, pass: cfg.password } : undefined,
  });
}
