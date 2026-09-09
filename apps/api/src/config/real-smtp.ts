/** Shared BFF/native SMTP contract; errors intentionally contain no input values. */
export interface RealSmtpEnv {
  IDP_SMTP_REAL_PROVIDER?: string | undefined;
  IDP_SMTP_REAL_HOST?: string | undefined;
  IDP_SMTP_REAL_PORT?: number | undefined;
  IDP_SMTP_REAL_USER?: string | undefined;
  IDP_SMTP_REAL_PASSWORD?: string | undefined;
  IDP_SMTP_REAL_SENDER_ADDRESS?: string | undefined;
}

export interface RealSmtpConfig {
  provider: "postbox" | "mail.ru";
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

export function resolveRealSmtp(env: RealSmtpEnv): RealSmtpConfig {
  const provider = env.IDP_SMTP_REAL_PROVIDER;
  const expectedHost =
    provider === "postbox"
      ? "postbox.cloud.yandex.net"
      : provider === "mail.ru"
        ? "smtp.mail.ru"
        : undefined;
  const parts = env.IDP_SMTP_REAL_HOST?.split(":") ?? [];
  const host = parts[0];
  const port =
    parts.length === 2 && /^\d+$/.test(parts[1]!)
      ? Number(parts[1])
      : parts.length === 1
        ? env.IDP_SMTP_REAL_PORT
        : undefined;
  const user = env.IDP_SMTP_REAL_USER;
  const password = env.IDP_SMTP_REAL_PASSWORD;
  const from = env.IDP_SMTP_REAL_SENDER_ADDRESS;
  if (
    !expectedHost ||
    host !== expectedHost ||
    port !== 465 ||
    (env.IDP_SMTP_REAL_PORT !== undefined && env.IDP_SMTP_REAL_PORT !== port) ||
    !user?.trim() ||
    !password?.trim() ||
    !from ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)
  ) {
    throw new Error("Invalid real SMTP configuration");
  }
  return {
    provider: provider as RealSmtpConfig["provider"],
    host,
    port,
    user,
    password,
    from,
  };
}
