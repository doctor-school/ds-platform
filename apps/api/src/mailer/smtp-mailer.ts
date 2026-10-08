import { emailSender } from "./email-layout.js";
import {
  adminLockoutMessage,
  congressConfirmationMessage,
  type CongressSubmissionDecisionContent,
  congressSubmissionDecisionMessage,
  congressSubmissionReceiptMessage,
  formatCongressEventDate,
  formatRevisionLastDay,
} from "./notice-emails.js";
import {
  resolveFallbackSmtp,
  resolveRealSmtp,
  type RealSmtpConfig,
} from "../config/real-smtp.js";
import {
  loginCodeEmail,
  passwordResetCodeEmail,
  reRegistrationCodeEmail,
  verificationCodeEmail,
  type CodeLifetime,
  type ReRegistrationCopyInput,
} from "./code-emails.js";
import {
  assertSendableCode,
  assertSendableEmail,
  type CongressConfirmationRequest,
  type CongressSubmissionDecisionRequest,
  type CongressSubmissionReceiptRequest,
  type Mailer,
} from "./mailer.types.js";
import type { ChannelReadiness, ReadinessState } from "./mailer-readiness.js";
import {
  ChannelRejection,
  type OutboundEmail,
  type ProbeResult,
  type RelayChannel,
  type SendOptions,
} from "./relay-channel.js";
import {
  DefaultRelayObservability,
  type ChainOutcome,
  type RelayAttempt,
  type RelayObservability,
} from "./relay-observability.js";
import { ResendChannel, type ResendChannelConfig } from "./resend-transport.js";
import { type SyntheticSuppression } from "./synthetic-suppression.js";
import { classifySmtpError, classifySmtpResult } from "./smtp-outcome.js";
import { boundedSmtpFactory } from "./smtp-transport.js";

export interface SmtpTransportConfig {
  provider?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  from?: string | undefined;
}
/** The mail.ru reserve: its own explicit switch and credentials (003 EARS-31). */
export interface FallbackSmtpTransportConfig extends SmtpTransportConfig {
  enabled?: boolean | undefined;
}
export type SmtpSendOptions = SendOptions;
export interface SmtpTransport {
  sendMail(
    message: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    },
    options?: SmtpSendOptions,
  ): Promise<unknown>;
  /** Authenticated handshake without a message (003 EARS-46). */
  verify?(): Promise<void>;
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
  fallback?: FallbackSmtpTransportConfig | undefined;
  resend?: ResendChannelConfig | undefined;
  observability?: RelayObservability | undefined;
  isEnabled: () => boolean;
  synthetic?: SyntheticSuppression | undefined;
  transportFactory?: TransportFactory | undefined;
  warn?: WarnFn | undefined;
  /** Total chain budget; 003 §14.3 fixes it at {@link MAIL_CHAIN_BUDGET_MS}. */
  budgetMs?: number | undefined;
  now?: (() => number) | undefined;
}

/** 003 §14.3 total chain budget (15 + 15 + 10 s). */
export const MAIL_CHAIN_BUDGET_MS = 40_000;

interface RealChain {
  channels: RelayChannel[];
  /** Disabled or absent chain channels (003 EARS-32). */
  skipped: number;
}

/** Configuration errors carry no input values (EARS-30). */
class MailerConfigurationError extends Error {
  constructor() {
    super("Mailer: invalid transport configuration");
    this.name = "MailerConfigurationError";
  }
}

function primaryOf(config: SmtpMailerConfig): RealSmtpConfig {
  const raw = config.real;
  return resolveRealSmtp({
    IDP_SMTP_REAL_PROVIDER: raw?.provider,
    IDP_SMTP_REAL_HOST: raw?.host,
    IDP_SMTP_REAL_PORT: raw?.port,
    IDP_SMTP_REAL_USER: raw?.user,
    IDP_SMTP_REAL_PASSWORD: raw?.password,
    IDP_SMTP_REAL_SENDER_ADDRESS: raw?.from,
  });
}

function reserveOf(config: SmtpMailerConfig) {
  const raw = config.fallback;
  return resolveFallbackSmtp(
    {
      MAILER_FALLBACK_SMTP_ENABLED: raw?.enabled,
      MAILER_FALLBACK_SMTP_PROVIDER: raw?.provider,
      MAILER_FALLBACK_SMTP_HOST: raw?.host,
      MAILER_FALLBACK_SMTP_PORT: raw?.port,
      MAILER_FALLBACK_SMTP_USER: raw?.user,
      MAILER_FALLBACK_SMTP_PASSWORD: raw?.password,
      MAILER_FALLBACK_SMTP_SENDER_ADDRESS: raw?.from,
    },
    config.real?.provider,
  );
}

type ResendResolution =
  | { state: "disabled" | "absent" }
  | { state: "configured"; config: ResendChannelConfig };

function resendOf(config: SmtpMailerConfig): ResendResolution {
  const resend = config.resend;
  const key = resend?.apiKey?.trim();
  if (!resend?.enabled) return { state: key ? "disabled" : "absent" };
  if (!key) throw new Error("Invalid Resend configuration");
  return { state: "configured", config: resend };
}

/**
 * 003 EARS-31 startup check: an enabled reserve must be complete and differ
 * from the primary; the primary must be valid when real mode is selected.
 * Throws without naming any value.
 */
export function assertMailerConfiguration(
  config: SmtpMailerConfig,
  realSelected: boolean,
): void {
  try {
    reserveOf(config);
    resendOf(config);
    if (realSelected) primaryOf(config);
  } catch {
    throw new MailerConfigurationError();
  }
}

/** 003 §14.3 chain: flag-selected real mode or the explicit Mailpit intercept. */
export class SmtpMailer implements Mailer {
  private readonly observability: RelayObservability;
  constructor(private readonly config: SmtpMailerConfig) {
    this.observability =
      config.observability ?? new DefaultRelayObservability();
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
  async sendLoginCodeEmail(
    email: string,
    code: string,
    lifetime: CodeLifetime = "5m",
  ): Promise<void> {
    assertSendableEmail(email);
    assertSendableCode(code);
    await this.dispatch(
      email,
      loginCodeEmail(code, lifetime),
      "login-code email",
    );
  }
  async sendReRegistrationCodeEmail(
    email: string,
    code: string,
    input: ReRegistrationCopyInput,
  ): Promise<void> {
    assertSendableEmail(email);
    assertSendableCode(code);
    await this.dispatch(
      email,
      reRegistrationCodeEmail(code, input),
      "re-registration code email",
    );
  }
  async sendCongressRegistrationConfirmation(
    input: CongressConfirmationRequest,
  ): Promise<void> {
    assertSendableEmail(input.email);
    await this.dispatch(
      input.email,
      congressConfirmationMessage({
        eventTitle: input.eventTitle,
        eventDate: formatCongressEventDate(input.eventStartsAt),
        eventVenue: input.eventVenue,
      }),
      "congress registration confirmation",
    );
  }
  async sendCongressSubmissionReceipt(
    input: CongressSubmissionReceiptRequest,
  ): Promise<void> {
    assertSendableEmail(input.email);
    await this.dispatch(
      input.email,
      congressSubmissionReceiptMessage({
        title: input.title,
        kindLabel: input.kindLabel,
        eventTitle: input.eventTitle,
      }),
      "congress submission receipt",
    );
  }
  async sendCongressSubmissionDecision(
    input: CongressSubmissionDecisionRequest,
  ): Promise<void> {
    assertSendableEmail(input.email);
    await this.dispatch(
      input.email,
      congressSubmissionDecisionMessage(decisionContent(input)),
      "congress submission decision",
    );
  }

  /**
   * 003 EARS-46: each chain channel's state from configuration alone
   * (`configured-unverified` until probed).
   */
  readinessStatement(): ChannelReadiness[] {
    return this.readinessPlan().map(({ role, provider, state }) => ({
      role,
      provider,
      state,
    }));
  }

  /** 003 EARS-46: probe every configured channel without sending a message. */
  async probeReadiness(): Promise<ChannelReadiness[]> {
    return Promise.all(
      this.readinessPlan().map(async ({ role, provider, state, channel }) => {
        const probed: ReadinessState = channel
          ? await channel.probe().catch(() => "probe-failed" as const)
          : state;
        return { role, provider, state: probed };
      }),
    );
  }

  private readinessPlan(): Array<
    ChannelReadiness & { channel?: RelayChannel | undefined }
  > {
    const factory = this.config.transportFactory ?? boundedSmtpFactory;
    const unverified = "configured-unverified" as const;
    const guard = (
      plan: () => { state: ReadinessState; channel?: RelayChannel },
    ): { state: ReadinessState; channel?: RelayChannel } => {
      try {
        return plan();
      } catch {
        return { state: "absent" };
      }
    };
    const primary = guard(() => {
      if (!this.config.isEnabled()) return { state: "disabled" };
      const cfg = primaryOf(this.config);
      return {
        state: unverified,
        channel: buildSmtpChannel(cfg.provider, cfg, factory),
      };
    });
    const reserve = guard(() => {
      const r = reserveOf(this.config);
      return r.state === "configured"
        ? {
            state: unverified,
            channel: buildSmtpChannel("mail.ru", r.config, factory),
          }
        : { state: r.state };
    });
    const resend = guard(() => {
      const r = resendOf(this.config);
      return r.state === "configured"
        ? { state: unverified, channel: new ResendChannel(r.config) }
        : { state: r.state };
    });
    return [
      {
        role: "primary",
        provider:
          this.config.real?.provider === "mail.ru" ? "mail.ru" : "postbox",
        ...primary,
      },
      { role: "reserve", provider: "mail.ru", ...reserve },
      { role: "resend", provider: "resend", ...resend },
    ];
  }

  /** 003 EARS-31: Postbox → mail.ru (switch + credentials) → Resend (switch + key). */
  private realChain(factory: TransportFactory): RealChain {
    const primary = primaryOf(this.config);
    const reserve = reserveOf(this.config);
    const resend = resendOf(this.config);
    const channels: RelayChannel[] = [
      buildSmtpChannel(primary.provider, primary, factory),
    ];
    if (reserve.state === "configured")
      channels.push(buildSmtpChannel("mail.ru", reserve.config, factory));
    if (resend.state === "configured")
      channels.push(new ResendChannel(resend.config));
    return { channels, skipped: 3 - channels.length };
  }

  private async dispatch(
    to: string,
    message: Omit<OutboundEmail, "to">,
    context: string,
  ): Promise<void> {
    if (this.config.synthetic?.suppress("email", to)) return;
    const real = this.config.isEnabled();
    const factory = this.config.transportFactory ?? boundedSmtpFactory;
    let chain: RealChain;
    try {
      if (real) {
        chain = this.realChain(factory);
      } else {
        if (!this.config.intercept.host)
          throw new Error("Invalid intercept configuration");
        chain = {
          channels: [
            buildSmtpChannel("mailpit", this.config.intercept, factory),
          ],
          skipped: 0,
        };
      }
    } catch {
      this.observability.configurationError({
        context,
        provider: real ? safeProvider(this.config.real?.provider) : "mailpit",
      });
      throw new MailerConfigurationError();
    }
    // Composed once by the caller; every channel receives this same object.
    const outbound: OutboundEmail = { to, ...message };
    const now = this.config.now ?? Date.now;
    const deadline = now() + (this.config.budgetMs ?? MAIL_CHAIN_BUDGET_MS);
    const attempts: RelayAttempt[] = [];
    let outcome: ChainOutcome = "exhausted";
    for (const channel of chain.channels) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        outcome = "stopped-budget";
        break;
      }
      try {
        await channel.send(outbound, { deadlineMs: remaining });
        const attempt: RelayAttempt = {
          provider: channel.provider,
          outcome: "accepted",
          code: "accepted",
        };
        attempts.push(attempt);
        this.observability.attempt({ context, ...attempt });
        this.observability.chain({
          context,
          outcome: `accepted-by-${channel.provider}`,
          skipped: chain.skipped,
          attempts,
        });
        return;
      } catch (err) {
        // Never publish provider text: it may contain credentials, recipient or OTP.
        const rejection =
          err instanceof ChannelRejection
            ? err
            : new ChannelRejection(
                "unexpected-failure",
                "attempt failed",
                "ambiguous",
              );
        const attempt: RelayAttempt = {
          provider: channel.provider,
          outcome: rejection.outcome,
          code: rejection.code,
        };
        attempts.push(attempt);
        this.observability.attempt({ context, ...attempt });
        if (rejection.outcome === "recipient-permanent") {
          outcome = "stopped-recipient-permanent";
          break;
        }
        if (now() >= deadline) {
          outcome = "stopped-budget";
          break;
        }
        if (rejection.outcome === "ambiguous") {
          outcome = "stopped-ambiguous";
          break;
        }
      }
    }
    this.observability.chain({
      context,
      outcome,
      skipped: chain.skipped,
      attempts,
    });
    // Deliberately construct outside the catch: provider errors may embed secrets
    // in properties and cannot safely be retained as Error.cause.
    throw new Error(
      `Mailer: ${context} send failed (${outcome}): ${attempts.map((a) => `${a.provider}=${a.code}`).join(", ")}`,
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
  async send(message: OutboundEmail, options?: SendOptions): Promise<void> {
    let info: unknown;
    try {
      info = await this.transport.sendMail(
        { from: this.from, ...message },
        options,
      );
    } catch (err) {
      // The owned-socket transport classifies by phase; anything else is unproven.
      throw classifySmtpError(err, "unknown");
    }
    const rejection = classifySmtpResult(info);
    if (rejection) throw rejection;
  }
  async probe(): Promise<ProbeResult> {
    if (!this.transport.verify) return "probe-failed";
    try {
      await this.transport.verify();
      return "verified";
    } catch {
      return "probe-failed";
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
    emailSender(cfg.from),
  );
}

/**
 * 046 EARS-29, EARS-35 — the request as the letter renders it: the stored
 * deadline instant becomes its Moscow last day, the only presentation step.
 */
function decisionContent(
  input: CongressSubmissionDecisionRequest,
): CongressSubmissionDecisionContent {
  const named = { title: input.title, kindLabel: input.kindLabel };
  switch (input.letter) {
    case "accepted":
      return { ...named, letter: "accepted" };
    case "rejected":
      return { ...named, letter: "rejected", comment: input.comment };
    case "needs_revision":
      return {
        ...named,
        letter: "needs_revision",
        comment: input.comment,
        lastDay: formatRevisionLastDay(input.revisionDueAt),
      };
    case "revision_extended":
      return {
        ...named,
        letter: "revision_extended",
        lastDay: formatRevisionLastDay(input.revisionDueAt),
      };
  }
}
