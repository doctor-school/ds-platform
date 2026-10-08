import { ChannelRejection } from "./relay-channel.js";

/**
 * How far an SMTP attempt got on the wire (003 EARS-45). `before-end-of-data`
 * is only claimed by the owned-socket transport, which observes every byte it
 * writes; any other source of an error is `unknown`.
 */
export type SmtpPhase = "before-end-of-data" | "after-end-of-data" | "unknown";

/** Failures that by their nature happen before any message byte is sent. */
const PRE_SESSION_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EDNS",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAUTH",
  "EENVELOPE",
]);
/** Errno labels safe to publish; anything else becomes `connection-failure`. */
const PUBLISHABLE_CODES = new Set([
  ...PRE_SESSION_CODES,
  "ETLS",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNECTION",
  "ESOCKET",
  "EPIPE",
]);

interface SmtpErrorShape {
  responseCode?: unknown;
  response?: unknown;
  command?: unknown;
  code?: unknown;
}

/**
 * Certificate verification codes Node raises while the TLS handshake is still
 * in progress, i.e. before any application byte (003 EARS-45). A generic
 * TLS-layer failure (`ERR_SSL_*`, bad record MAC) can happen mid-session and
 * is not one of these.
 */
export function isCertificateHandshakeCode(code: string): boolean {
  return /^(CERT_|UNABLE_TO_(VERIFY|GET_ISSUER|DECRYPT_CERT)|DEPTH_ZERO_SELF_SIGNED_CERT$|SELF_SIGNED_CERT_IN_CHAIN$|ERR_TLS_CERT_ALTNAME_INVALID$|HOSTNAME_MISMATCH$)/.test(
    code,
  );
}

/** Enhanced status (RFC 3463) from a reply line, e.g. `550 5.1.1 …` → `5.1.1`. */
export function enhancedStatus(response: unknown): string | undefined {
  if (typeof response !== "string") return undefined;
  return /^\d{3}[ -]([245]\.\d{1,3}\.\d{1,3})\b/.exec(response.trim())?.[1];
}

/**
 * 003 EARS-45 SMTP classification. A server reply is definitive in any phase;
 * only an enhanced `5.1.x` (not `5.1.7`/`5.1.8`) to `RCPT TO` is
 * recipient-permanent. A non-reply failure follows the measured phase: before
 * end-of-data → provider-failure, after it → ambiguous whatever the errno. With
 * an unknown phase it is provider-failure only when pre-session by nature
 * (refusal, DNS, certificate handshake, EAUTH, EENVELOPE), otherwise ambiguous.
 */
export function classifySmtpError(
  err: unknown,
  phase: SmtpPhase,
): ChannelRejection {
  if (err instanceof ChannelRejection) return err;
  const e = (err ?? {}) as SmtpErrorShape;
  if (
    typeof e.responseCode === "number" &&
    e.responseCode >= 400 &&
    e.responseCode <= 599
  ) {
    const status = enhancedStatus(e.response);
    const code = status
      ? `${e.responseCode} ${status}`
      : String(e.responseCode);
    const recipientPermanent =
      e.command === "RCPT TO" &&
      e.responseCode >= 500 &&
      status !== undefined &&
      status.startsWith("5.1.") &&
      status !== "5.1.7" &&
      status !== "5.1.8";
    return new ChannelRejection(
      code,
      "SMTP reply rejected the attempt",
      recipientPermanent ? "recipient-permanent" : "provider-failure",
    );
  }
  const errno = String(e.code ?? "");
  const tls = /CERT|TLS|SSL/i.test(errno);
  const code = tls
    ? "ETLS"
    : PUBLISHABLE_CODES.has(errno)
      ? errno
      : "connection-failure";
  const definite =
    phase === "before-end-of-data" ||
    (phase === "unknown" &&
      (PRE_SESSION_CODES.has(errno) || isCertificateHandshakeCode(errno)));
  return new ChannelRejection(
    code,
    "SMTP attempt failed",
    definite ? "provider-failure" : "ambiguous",
  );
}

/** A resolved send whose final reply is not 2xx, or carries no reply at all. */
export function classifySmtpResult(info: unknown): ChannelRejection | null {
  const result = info as { response?: unknown; rejected?: unknown } | undefined;
  const code =
    typeof result?.response === "string"
      ? /^(\d{3})/.exec(result.response.trim())?.[1]
      : undefined;
  if (code?.startsWith("2")) {
    if (Array.isArray(result?.rejected) && result.rejected.length > 0)
      return new ChannelRejection(code, "SMTP rejected the recipient");
    return null;
  }
  return new ChannelRejection(
    code ?? "invalid-response",
    "SMTP did not confirm acceptance",
    code && /^[45]/.test(code) ? "provider-failure" : "ambiguous",
  );
}
