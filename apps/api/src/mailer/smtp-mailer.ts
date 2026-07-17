import { Logger } from "@nestjs/common";
import { createTransport } from "nodemailer";
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
   * The Resend failover channel (`RESEND_API_KEY`, design §14.3, EARS-31) —
   * `undefined` when the key is absent (the chain is then mail.ru only).
   * Failover-only: it sits BEHIND the mail.ru primary and never carries
   * steady-state volume (the §14.5 warm-up plan; 152-ФЗ posture §14.6).
   */
  resend?: ResendChannelConfig | undefined;
  /** Failover/relay-failure sinks (EARS-32); defaults to the real log+metric+GlitchTip triple. */
  observability?: RelayObservability | undefined;
  /**
   * Live `email-delivery-real` read (mirror `bot-protection.module.ts:42`): true ⇒
   * select the real transport, false ⇒ intercept. Read on EVERY send so a mid-
   * session flip takes effect without a restart; Unleash-unreachable falls back to
   * the `EMAIL_DELIVERY_MODE` env default (same contract as the reconcile).
   */
  isEnabled: () => boolean;
  /** Portal origin the notice links point at (`/login`, `/reset`). */
  portalBaseUrl: string;
  /**
   * EARS-33 synthetic-send suppression seam (design §14.8) — optional; absent ⇒
   * no suppression (every send proceeds). When present it is consulted at the
   * single send point below, BEFORE any relay contact.
   */
  synthetic?: SyntheticSuppression | undefined;
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
  private readonly intercept: RelayChannel | null;
  private readonly real: RelayChannel | null;
  private readonly resend: RelayChannel | null;
  private readonly observability: RelayObservability;
  private readonly warn: WarnFn;

  constructor(private readonly config: SmtpMailerConfig) {
    const factory = config.transportFactory ?? nodemailerFactory;
    this.warn = config.warn ?? ((m) => this.logger.warn(m));
    this.intercept = buildSmtpChannel("mailpit", config.intercept, factory);
    this.real = config.real
      ? buildSmtpChannel("mail.ru", config.real, factory)
      : null;
    this.resend = config.resend ? new ResendChannel(config.resend) : null;
    this.observability =
      config.observability ?? new DefaultRelayObservability();
  }

  async sendAccountExistsNotice(email: string): Promise<void> {
    // Reject exactly what FakeMailer rejects (contract parity) — before any
    // transport decision, so no path is more permissive than the real adapter.
    assertSendableEmail(email);
    await this.dispatch(
      email,
      accountExistsMessage(this.config.portalBaseUrl),
      "account-exists notice",
    );
  }

  async sendVerificationCodeEmail(email: string, code: string): Promise<void> {
    // Parity guards first (fake and real reject identically), before any
    // transport decision — and before the secret touches a message object.
    assertSendableEmail(email);
    assertSendableCode(code);
    await this.dispatch(
      email,
      verificationCodeEmail(code),
      "verification-code email",
      code,
    );
  }

  async sendPasswordResetCodeEmail(
    email: string,
    code: string,
  ): Promise<void> {
    assertSendableEmail(email);
    assertSendableCode(code);
    await this.dispatch(
      email,
      passwordResetCodeEmail(code),
      "password-reset-code email",
      code,
    );
  }

  /**
   * Shared per-send channel-chain selection + dispatch (#209 flag gate +
   * EARS-31 failover, design §14.3).
   *
   * Chain semantics (EARS-31): on the real path the chain is
   * **mail.ru primary → Resend failover** — a rate-limit/availability
   * rejection on the active channel (mail.ru `451`, Resend `429`, any
   * 4xx/5xx/connection failure, or a resolved non-2xx acceptance) triggers ONE
   * switch to the next channel within the same send; each channel is attempted
   * at most once (no same-channel retry); a send counts as delivered ONLY on a
   * provider 2xx. All channels failing ⇒ **fail-closed**: the failure is
   * reported with every provider response code (EARS-32) and a sanitized error
   * is thrown — the enumeration-safe API surface above stays unchanged
   * (EARS-16: callers fire-and-forget/log, never 500 the client).
   *
   * The intercept (sink) path never fails over to a real provider — a
   * flag-OFF send must land in Mailpit or fail, never leak (#209).
   *
   * EARS-30: when `secret` is present (the EARS-29 code sends) every provider
   * detail is redacted BEFORE it reaches the observability sinks, and the
   * thrown error carries provider=code pairs only — never raw provider text
   * (which may echo the outbound message), never the caught error as `cause`.
   */
  private async dispatch(
    to: string,
    message: { subject: string; text: string; html: string },
    context: string,
    secret?: string,
  ): Promise<void> {
    // EARS-33 (design §14.8): the synthetic-send suppression seam sits at this
    // single send point, BEFORE the transport-selection + relay hop. The public
    // method already ran the identical request-shape pipeline (parity guards +
    // artifact composition) the #873 load test must exercise; with the toggle ON
    // and a `@loadtest.invalid`-tagged recipient the send is dropped here — the
    // transport is never contacted, so zero real send leaves the box, and the drop
    // is counted + logged loudly. Toggle OFF (default) or an untagged recipient ⇒
    // fully inert (falls through to the normal transport chain below).
    if (this.config.synthetic?.suppress("email", to)) return;

    // Live flag read on EVERY send (mirror bot-protection.module.ts:42): a mid-
    // session flip takes effect with no restart; Unleash-unreachable already
    // resolved to the EMAIL_DELIVERY_MODE env default by the time we are called.
    const wantReal = this.config.isEnabled();

    const chain: RelayChannel[] = [];
    if (wantReal && (this.real || this.resend)) {
      // Real path: mail.ru primary first, Resend strictly as failover (§14.3;
      // primary-first is also the §14.5 warm-up mechanism — never pre-split
      // volume away from mail.ru).
      if (this.real) chain.push(this.real);
      if (this.resend) chain.push(this.resend);
    } else {
      if (wantReal) {
        // Fail-soft: flag ON but no real channel is configured. Never throw,
        // never silently drop — use intercept and warn (mirror the reconcile's
        // "never activate the wrong provider").
        this.warn(
          "email-delivery-real is ON but no real channel is configured " +
            `(IDP_SMTP_REAL_* and RESEND_API_KEY unset) — falling back to the ` +
            `Mailpit intercept transport for the ${context}. Set ` +
            "IDP_SMTP_REAL_* to deliver via the real relay.",
        );
      }
      if (!this.intercept) {
        // Selected transport's host unset ⇒ the existing logged no-op. The warn
        // names the context only — never the recipient or a secret (EARS-30).
        this.warn(
          `${
            wantReal ? "IDP_SMTP_REAL_HOST" : "MAILER_SMTP_HOST"
          } is unset — skipping the ${context} send (logged no-op).`,
        );
        return;
      }
      chain.push(this.intercept);
    }

    const outbound: OutboundEmail = {
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    };
    const attempts: RelayAttempt[] = [];
    for (let i = 0; i < chain.length; i += 1) {
      const channel = chain[i]!;
      try {
        await channel.send(outbound);
        return; // Delivered — a channel resolves only on a provider 2xx.
      } catch (err) {
        const code =
          err instanceof ChannelRejection ? err.code : "unexpected-failure";
        const raw = err instanceof Error ? err.message : String(err);
        // EARS-30: redact BEFORE the detail can reach any sink or error.
        const detail = secret ? redactSecret(raw, secret) : raw;
        attempts.push({ provider: channel.provider, code, detail });
        const next = chain[i + 1];
        if (next) {
          // EARS-32: every failover is reported (log + counter + GlitchTip).
          this.observability.failover({
            context,
            from: channel.provider,
            code,
            to: next.provider,
            detail,
          });
        }
      }
    }

    // Fail-closed (EARS-31): every channel rejected. Report with ALL provider
    // response codes (EARS-32), then throw a sanitized error — provider=code
    // pairs only, no raw provider text, no `cause` (EARS-30: the caught error
    // object may embed the outbound message in properties redaction cannot
    // reach).
    this.observability.relayFailure({ context, attempts });
    throw new Error(
      `Mailer: ${context} send failed on all channels: ${attempts
        .map((a) => `${a.provider}=${a.code}`)
        .join(", ")}`,
    );
  }
}

/**
 * One SMTP provider attempt as a {@link RelayChannel} (EARS-31): resolves only
 * on a 2xx acceptance. nodemailer's SMTP transport resolves only when the
 * server accepted the envelope, so a parseable non-2xx `response` or a
 * non-empty `rejected` list on a *resolved* send is still counted as a
 * rejection (2xx-only success, belt and braces); a thrown provider error maps
 * its `responseCode` (SMTP code) or errno `code` into the rejection.
 */
class SmtpChannel implements RelayChannel {
  constructor(
    readonly provider: string,
    private readonly transport: SmtpTransport,
    private readonly from: string | undefined,
  ) {}

  async send(message: OutboundEmail): Promise<void> {
    let info: unknown;
    try {
      info = await this.transport.sendMail({
        from: this.from ?? "noreply@doctor.school",
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (err) {
      throw new ChannelRejection(
        smtpErrorCode(err),
        err instanceof Error ? err.message : String(err),
      );
    }
    const code = smtpAcceptanceCode(info);
    if (code && !code.startsWith("2")) {
      throw new ChannelRejection(code, `SMTP response ${code}`);
    }
    const rejected = (info as { rejected?: unknown } | null | undefined)
      ?.rejected;
    if (Array.isArray(rejected) && rejected.length > 0) {
      throw new ChannelRejection(
        code ?? "rejected",
        "SMTP relay rejected the recipient",
      );
    }
  }
}

/**
 * Provider code of a thrown SMTP error: nodemailer sets `responseCode` (the
 * SMTP status, e.g. `451`) on protocol rejections and an errno string on
 * `code` (`ECONNREFUSED`, `ETIMEDOUT`, …) for connection failures — both are
 * bounded, metric-safe values (EARS-32 labels).
 */
function smtpErrorCode(err: unknown): string {
  const e = err as { responseCode?: unknown; code?: unknown };
  if (typeof e?.responseCode === "number") return String(e.responseCode);
  if (typeof e?.code === "string" && e.code) return e.code;
  return "connection-failure";
}

/**
 * SMTP status of a RESOLVED send, parsed from the leading digits of
 * `info.response` (e.g. `250 2.0.0 OK …` → `250`). `undefined` when the shape
 * carries no response string — nodemailer resolves only on server acceptance,
 * so an unparseable resolution counts as accepted.
 */
function smtpAcceptanceCode(info: unknown): string | undefined {
  const response = (info as { response?: unknown } | null | undefined)
    ?.response;
  if (typeof response !== "string") return undefined;
  const match = /^(\d{3})/.exec(response.trim());
  return match ? match[1] : undefined;
}

/**
 * EARS-30: remove every occurrence of the transiting one-time code from a
 * provider error before it can reach a log line, a trace, or an error report.
 */
function redactSecret(message: string, secret: string): string {
  return message.split(secret).join("[redacted]");
}

/** Build an SMTP channel from one transport's config; `null` when the host is unset. */
function buildSmtpChannel(
  provider: string,
  cfg: SmtpTransportConfig,
  factory: TransportFactory,
): RelayChannel | null {
  if (!cfg.host) return null;
  const port = cfg.port ?? 1025;
  const transport = factory({
    host: cfg.host,
    port,
    // Mailpit on dev is plaintext on 1025; secure only on the conventional 465.
    secure: port === 465,
    auth: cfg.user && cfg.password ? { user: cfg.user, pass: cfg.password } : undefined,
  });
  return new SmtpChannel(provider, transport, cfg.from);
}
