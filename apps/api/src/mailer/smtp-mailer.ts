import { Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { assertSendableEmail, type Mailer } from "./mailer.types.js";

/** SMTP transport config the adapter needs — narrowed from the env (design §4). */
export interface SmtpMailerConfig {
  /** SMTP host. **Unset ⇒ the adapter is a logged no-op** (infra-gated, like the IdP/Redis fakes). */
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  /** Envelope/From address for BFF notices (e.g. `noreply@doctor.school`). */
  from?: string | undefined;
  /** Portal origin the notice links point at (`/login`, `/reset`). */
  portalBaseUrl: string;
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
 * Production {@link Mailer} over `nodemailer` (003 design §4) — the BFF's own
 * transactional-email channel (account-exists notice; lockout / welcome later),
 * deliberately separate from Zitadel's identity-credential emails (the ones that
 * carry a secret). On the dev-stand it points at Mailpit (`truenas.local:1025`,
 * no auth); in prod at a real SMTP relay.
 *
 * Infra-gated, like the IdP / Redis fakes: when `MAILER_SMTP_HOST` is unset the
 * adapter degrades to a **logged no-op** (a `console.warn`) and never throws at
 * boot — the dev-stand / CI without an SMTP host still boots and the EARS-23 path
 * stays exercised (the throttle + fire-and-forget contract holds; only the wire
 * send is skipped).
 */
export class SmtpMailer implements Mailer {
  private readonly logger = new Logger(SmtpMailer.name);
  private readonly transporter: Transporter | null;

  constructor(private readonly config: SmtpMailerConfig) {
    if (!config.host) {
      // Unconfigured: no transport, a logged no-op (see sendAccountExistsNotice).
      this.transporter = null;
      return;
    }
    this.transporter = createTransport({
      host: config.host,
      port: config.port ?? 1025,
      // Mailpit on dev is plaintext on 1025; secure only on the conventional 465.
      secure: (config.port ?? 1025) === 465,
      auth:
        config.user && config.password
          ? { user: config.user, pass: config.password }
          : undefined,
    });
  }

  async sendAccountExistsNotice(email: string): Promise<void> {
    // Reject exactly what FakeMailer rejects (contract parity) — before any
    // transport decision, so the no-op path is no more permissive than the real.
    assertSendableEmail(email);

    if (!this.transporter) {
      this.logger.warn(
        "MAILER_SMTP_HOST is unset — skipping the account-exists notice send " +
          "(logged no-op). Configure MAILER_SMTP_* to enable BFF notices.",
      );
      return;
    }

    const { subject, text, html } = accountExistsMessage(
      this.config.portalBaseUrl,
    );
    await this.transporter.sendMail({
      from: this.config.from ?? "noreply@doctor.school",
      to: email,
      subject,
      text,
      html,
    });
  }
}
