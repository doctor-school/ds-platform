/** Shared BFF/native SMTP contract; errors intentionally contain no input values. */
export interface RealSmtpEnv {
  IDP_SMTP_REAL_PROVIDER?: string | undefined;
  IDP_SMTP_REAL_HOST?: string | undefined;
  IDP_SMTP_REAL_PORT?: number | undefined;
  IDP_SMTP_REAL_USER?: string | undefined;
  IDP_SMTP_REAL_PASSWORD?: string | undefined;
  IDP_SMTP_REAL_SENDER_ADDRESS?: string | undefined;
}

/** 003 §14.3 mail.ru reserve: its own namespace, never the native Zitadel profile. */
export interface FallbackSmtpEnv {
  MAILER_FALLBACK_SMTP_ENABLED?: boolean | undefined;
  MAILER_FALLBACK_SMTP_PROVIDER?: string | undefined;
  MAILER_FALLBACK_SMTP_HOST?: string | undefined;
  MAILER_FALLBACK_SMTP_PORT?: number | undefined;
  MAILER_FALLBACK_SMTP_USER?: string | undefined;
  MAILER_FALLBACK_SMTP_PASSWORD?: string | undefined;
  MAILER_FALLBACK_SMTP_SENDER_ADDRESS?: string | undefined;
}

export type SmtpProvider = "postbox" | "mail.ru";

export interface RealSmtpConfig {
  provider: SmtpProvider;
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

/** The reserve as the chain sees it (003 EARS-31/46). */
export type FallbackSmtpResolution =
  | { state: "disabled" | "absent" }
  | { state: "configured"; config: RealSmtpConfig };

const CANONICAL_HOST: Record<SmtpProvider, string> = {
  postbox: "postbox.cloud.yandex.net",
  "mail.ru": "smtp.mail.ru",
};

interface SmtpFields {
  provider?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  user?: string | undefined;
  password?: string | undefined;
  from?: string | undefined;
}

/** Explicit provider, canonical host:465, complete credentials — or null. */
function resolveProfile(fields: SmtpFields): RealSmtpConfig | null {
  const provider = fields.provider;
  const expectedHost =
    provider === "postbox" || provider === "mail.ru"
      ? CANONICAL_HOST[provider]
      : undefined;
  const parts = fields.host?.split(":") ?? [];
  const host = parts[0];
  const port =
    parts.length === 2 && /^\d+$/.test(parts[1]!)
      ? Number(parts[1])
      : parts.length === 1
        ? fields.port
        : undefined;
  const { user, password, from } = fields;
  if (
    !expectedHost ||
    host !== expectedHost ||
    port !== 465 ||
    (fields.port !== undefined && fields.port !== port) ||
    !user?.trim() ||
    !password?.trim() ||
    !from ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)
  ) {
    return null;
  }
  return {
    provider: provider as SmtpProvider,
    host,
    port,
    user,
    password,
    from,
  };
}

export function resolveRealSmtp(env: RealSmtpEnv): RealSmtpConfig {
  const config = resolveProfile({
    provider: env.IDP_SMTP_REAL_PROVIDER,
    host: env.IDP_SMTP_REAL_HOST,
    port: env.IDP_SMTP_REAL_PORT,
    user: env.IDP_SMTP_REAL_USER,
    password: env.IDP_SMTP_REAL_PASSWORD,
    from: env.IDP_SMTP_REAL_SENDER_ADDRESS,
  });
  if (!config) throw new Error("Invalid real SMTP configuration");
  return config;
}

/**
 * 003 EARS-31: the reserve joins only with its explicit switch AND a complete
 * mail.ru credential set; its provider must differ from the primary's.
 * Credentials without the switch are inert (`disabled`).
 */
export function resolveFallbackSmtp(
  env: FallbackSmtpEnv,
  primaryProvider: string | undefined,
): FallbackSmtpResolution {
  if (!env.MAILER_FALLBACK_SMTP_ENABLED) {
    const anyValue = [
      env.MAILER_FALLBACK_SMTP_PROVIDER,
      env.MAILER_FALLBACK_SMTP_HOST,
      env.MAILER_FALLBACK_SMTP_USER,
      env.MAILER_FALLBACK_SMTP_PASSWORD,
      env.MAILER_FALLBACK_SMTP_SENDER_ADDRESS,
    ].some((v) => v?.trim());
    return { state: anyValue ? "disabled" : "absent" };
  }
  const config = resolveProfile({
    provider: env.MAILER_FALLBACK_SMTP_PROVIDER,
    host: env.MAILER_FALLBACK_SMTP_HOST,
    port: env.MAILER_FALLBACK_SMTP_PORT,
    user: env.MAILER_FALLBACK_SMTP_USER,
    password: env.MAILER_FALLBACK_SMTP_PASSWORD,
    from: env.MAILER_FALLBACK_SMTP_SENDER_ADDRESS,
  });
  if (!config || config.provider !== "mail.ru" || primaryProvider === "mail.ru")
    throw new Error("Invalid fallback SMTP configuration");
  return { state: "configured", config };
}
