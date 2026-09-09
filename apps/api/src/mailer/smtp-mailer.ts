import { resolveRealSmtp } from "../config/real-smtp.js";
import {
  passwordResetCodeEmail,
  verificationCodeEmail,
} from "./code-emails.js";
import {
  assertSendableCode,
  assertSendableEmail,
  type Mailer,
} from "./mailer.types.js";
import {
  ChannelRejection,
  type OutboundEmail,
  type RelayChannel,
} from "./relay-channel.js";
import {
  DefaultRelayObservability,
  type RelayAttempt,
  type RelayObservability,
} from "./relay-observability.js";
import { ResendChannel, type ResendChannelConfig } from "./resend-transport.js";
import { type SyntheticSuppression } from "./synthetic-suppression.js";
import { boundedSmtpFactory } from "./smtp-transport.js";

export interface SmtpTransportConfig {
  provider?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  from?: string | undefined;
}
export interface SmtpTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}
export interface SmtpTransportFactoryOptions {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string } | undefined;
}
export type TransportFactory = (
  opts: SmtpTransportFactoryOptions,
) => SmtpTransport;
export type WarnFn = (message: string) => void;
export interface SmtpMailerConfig {
  intercept: SmtpTransportConfig;
  real?: SmtpTransportConfig | undefined;
  resend?: ResendChannelConfig | undefined;
  observability?: RelayObservability | undefined;
  isEnabled: () => boolean;
  portalBaseUrl: string;
  synthetic?: SyntheticSuppression | undefined;
  transportFactory?: TransportFactory | undefined;
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

/**
 * Subject + RU body of the 011 EARS-7 admin-lockout notice — carries NO secret,
 * NO attempt count, and NO remaining-time figure.
 *
 * The recipient of this mail is, by construction, an account someone has just
 * failed ten second-factor attempts against — so the mailbox may well be the
 * attacker's next target and the mail itself must not become the progress report
 * the uniform-failure rule spends a whole clause denying (EARS-7). It states the
 * fact (temporarily locked), the reassurance (nothing was changed), and the one
 * recovery path the spec actually ships (LD-2: the Tech Lead removes the factor,
 * the next login re-enters enrollment).
 */
function adminLockoutMessage(): {
  subject: string;
  text: string;
  html: string;
} {
  const subject =
    "Doctor.School — вход в панель администрирования временно заблокирован";
  const text = [
    "Здравствуйте!",
    "",
    "Мы временно заблокировали вход в панель администрирования Doctor.School " +
      "для вашей учётной записи: одноразовый код вводился неверно слишком " +
      "много раз подряд.",
    "",
    "Пароль и данные учётной записи не изменились. Попробуйте войти позже.",
    "",
    "Если приложение-аутентификатор недоступно, обратитесь к техническому " +
      "руководителю — он снимет старый фактор, и вы подключите приложение заново.",
    "",
    "Если это были не вы, сообщите об этом техническому руководителю.",
    "",
    "Команда Doctor.School",
  ].join("\n");
  const html = [
    `<p>Здравствуйте!</p>`,
    `<p>Мы временно заблокировали вход в панель администрирования ` +
      `Doctor.School для вашей учётной записи: одноразовый код вводился ` +
      `неверно слишком много раз подряд.</p>`,
    `<p>Пароль и данные учётной записи не изменились. Попробуйте войти позже.</p>`,
    `<p>Если приложение-аутентификатор недоступно, обратитесь к техническому ` +
      `руководителю — он снимет старый фактор, и вы подключите приложение заново.</p>`,
    `<p>Если это были не вы, сообщите об этом техническому руководителю.</p>`,
    `<p>Команда Doctor.School</p>`,
  ].join("\n");
  return { subject, text, html };
}

/** Flag-selected SMTP primary; optional fallback requires explicit activation. */
export class SmtpMailer implements Mailer {
  private readonly observability: RelayObservability;
  constructor(private readonly config: SmtpMailerConfig) {
    this.observability =
      config.observability ?? new DefaultRelayObservability();
  }
  async sendAccountExistsNotice(email: string): Promise<void> {
    assertSendableEmail(email);
    await this.dispatch(
      email,
      accountExistsMessage(this.config.portalBaseUrl),
      "account-exists notice",
    );
  }
  async sendAdminLockoutNotice(email: string): Promise<void> {
    assertSendableEmail(email);
    await this.dispatch(email, adminLockoutMessage(), "admin-lockout notice");
  }
  async sendVerificationCodeEmail(email: string, code: string): Promise<void> {
    assertSendableEmail(email);
    assertSendableCode(code);
    await this.dispatch(
      email,
      verificationCodeEmail(code),
      "verification-code email",
    );
  }
  async sendPasswordResetCodeEmail(email: string, code: string): Promise<void> {
    assertSendableEmail(email);
    assertSendableCode(code);
    await this.dispatch(
      email,
      passwordResetCodeEmail(code),
      "password-reset-code email",
    );
  }
  private async dispatch(
    to: string,
    message: Omit<OutboundEmail, "to">,
    context: string,
  ): Promise<void> {
    if (this.config.synthetic?.suppress("email", to)) return;
    const real = this.config.isEnabled();
    const factory = this.config.transportFactory ?? boundedSmtpFactory;
    const chain: RelayChannel[] = [];
    let provider = real ? safeProvider(this.config.real?.provider) : "mailpit";
    try {
      if (real) {
        const raw = this.config.real;
        const cfg = resolveRealSmtp({
          IDP_SMTP_REAL_PROVIDER: raw?.provider,
          IDP_SMTP_REAL_HOST: raw?.host,
          IDP_SMTP_REAL_PORT: raw?.port,
          IDP_SMTP_REAL_USER: raw?.user,
          IDP_SMTP_REAL_PASSWORD: raw?.password,
          IDP_SMTP_REAL_SENDER_ADDRESS: raw?.from,
        });
        provider = cfg.provider;
        chain.push(buildSmtpChannel(provider, cfg, factory));
        if (this.config.resend?.enabled) {
          if (!this.config.resend.apiKey?.trim())
            throw new Error("Invalid fallback configuration");
          chain.push(new ResendChannel(this.config.resend));
        }
      } else {
        if (!this.config.intercept.host)
          throw new Error("Invalid intercept configuration");
        chain.push(buildSmtpChannel("mailpit", this.config.intercept, factory));
      }
    } catch {
      this.observability.relayFailure({
        context,
        outcome: "configuration",
        attempts: [{ provider, code: "configuration" }],
      });
      throw new Error("Mailer: invalid transport configuration");
    }
    const attempts: RelayAttempt[] = [];
    for (let i = 0; i < chain.length; i += 1) {
      const channel = chain[i]!;
      try {
        await channel.send({ to, ...message });
        this.observability.accepted?.({
          context,
          provider: channel.provider,
          route: real ? (i === 0 ? "primary" : "fallback") : "intercept",
        });
        return;
      } catch (err) {
        const code =
          err instanceof ChannelRejection ? err.code : "unexpected-failure";
        const uncertain =
          !(err instanceof ChannelRejection) || err.outcome === "uncertain";
        // Never publish provider text: it may contain credentials, recipient or OTP.
        attempts.push({ provider: channel.provider, code });
        const next = chain[i + 1];
        if (next && !uncertain) {
          this.observability.failover({
            context,
            from: channel.provider,
            code,
            to: next.provider,
          });
          continue;
        }
        this.observability.relayFailure({
          context,
          outcome: uncertain ? "uncertain" : "failure",
          attempts,
        });
        break;
      }
    }
    // Deliberately construct outside the catch: provider errors may embed secrets
    // in properties and cannot safely be retained as Error.cause.
    throw new Error(
      `Mailer: ${context} send failed: ${attempts.map((a) => `${a.provider}=${a.code}`).join(", ")}`,
    );
  }
}
function safeProvider(provider: string | undefined): string {
  return provider === "postbox" || provider === "mail.ru"
    ? provider
    : "unconfigured";
}
class SmtpChannel implements RelayChannel {
  constructor(
    readonly provider: string,
    private readonly transport: SmtpTransport,
    private readonly from: string,
  ) {}
  async send(message: OutboundEmail): Promise<void> {
    let info: unknown;
    try {
      info = await this.transport.sendMail({ from: this.from, ...message });
    } catch (err) {
      if (err instanceof ChannelRejection) throw err;
      const e = err as { responseCode?: unknown; code?: unknown };
      const definite =
        typeof e?.responseCode === "number" &&
        e.responseCode >= 400 &&
        e.responseCode <= 599;
      const code = definite
        ? String(e.responseCode)
        : [
              "ECONNREFUSED",
              "ETIMEDOUT",
              "ECONNRESET",
              "EDNS",
              "ESOCKET",
              "ETLS",
              "EAUTH",
            ].includes(String(e?.code))
          ? String(e.code)
          : "connection-failure";
      throw new ChannelRejection(
        code,
        "SMTP attempt failed",
        definite ? "rejected" : "uncertain",
      );
    }
    const result = info as
      { response?: unknown; rejected?: unknown } | undefined;
    const code =
      typeof result?.response === "string"
        ? /^(\d{3})/.exec(result.response.trim())?.[1]
        : undefined;
    if (
      !code?.startsWith("2") ||
      (Array.isArray(result?.rejected) && result.rejected.length > 0)
    ) {
      throw new ChannelRejection(
        code ?? "invalid-response",
        "SMTP did not confirm acceptance",
        code && /^[45]/.test(code) ? "rejected" : "uncertain",
      );
    }
  }
}
function buildSmtpChannel(
  provider: string,
  cfg: SmtpTransportConfig,
  factory: TransportFactory,
): RelayChannel {
  const port = cfg.port ?? 1025;
  return new SmtpChannel(
    provider,
    factory({
      host: cfg.host!,
      port,
      secure: port === 465,
      auth:
        cfg.user && cfg.password
          ? { user: cfg.user, pass: cfg.password }
          : undefined,
    }),
    cfg.from ?? "noreply@doctor.school",
  );
}
