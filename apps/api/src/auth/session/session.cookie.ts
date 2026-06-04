import { createHash } from "node:crypto";

/**
 * BFF session cookie + fingerprint primitives (design §3, EARS-8).
 *
 * The browser holds **only** this cookie; the tokens live server-side keyed by
 * its value. The `__Host-` prefix is a security invariant — a user agent rejects
 * a `__Host-` cookie unless it is `Secure`, `Path=/`, and carries no `Domain`
 * (so it is locked to the exact origin that set it, which is exactly the
 * per-origin binding ADR-0001 §6 wants). The name is fixed (not an origin, so
 * the "no hardcoded origin" rule does not apply); the origin binding is the
 * prefix's job.
 */
export const SESSION_COOKIE_NAME = "__Host-ds_session";

/** The request surface the session fingerprint is derived from (design §3). */
export interface FingerprintInput {
  userAgent?: string | undefined;
  ip?: string | undefined;
  acceptLanguage?: string | undefined;
}

/**
 * Mask an IPv4 address to its /24 network. Binding the full host IP would evict
 * a legitimate session on every NAT/DHCP reassignment; the /24 keeps the binding
 * meaningful (an attacker on a different network fails) without that churn. A
 * non-IPv4 value (IPv6, unknown) is returned unchanged — still a stable bucket.
 */
export function ipToNet24(ip: string): string {
  const octets = ip.split(".");
  if (octets.length !== 4 || octets.some((o) => !/^\d+$/.test(o))) return ip;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
}

/**
 * Derive the session fingerprint (ADR-0001 §6): `hash(UA + IP/24 +
 * accept-language)`. Deterministic so the middleware can re-derive it on each
 * request and compare to the value bound at login; a mismatch invalidates the
 * session (a stolen cookie replayed from another device/network does not match).
 *
 * NOTE — the IP/24 component is only meaningful when Fastify resolves the real
 * client IP. Behind the v1 Caddy reverse proxy (ADR-0012), `request.ip` is the
 * proxy address unless `trustProxy` + the known hop count are configured on the
 * adapter, in which case this term collapses to a constant and the binding
 * degrades to UA + accept-language. Wiring `trustProxy` to the deployment
 * topology is deferred to that config (binding a *wrong*, spoofable IP is worse
 * than deferring); UA + accept-language still bind in the interim.
 */
export function computeFingerprint(input: FingerprintInput): string {
  const material = [
    input.userAgent ?? "",
    ipToNet24(input.ip ?? ""),
    input.acceptLanguage ?? "",
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

/** Serialize the `__Host-` session cookie with its mandatory attribute set. */
export function serializeSessionCookie(
  sid: string,
  opts: { maxAgeSeconds: number },
): string {
  // Order is cosmetic; the attribute *presence* is what matters. No `Domain` —
  // its presence would void the `__Host-` prefix.
  return [
    `${SESSION_COOKIE_NAME}=${sid}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${opts.maxAgeSeconds}`,
  ].join("; ");
}

/**
 * Serialize the cookie that **clears** the session (EARS-10 logout). It carries
 * the identical `__Host-` attribute set with an empty value and `Max-Age=0`, so
 * the user agent drops the cookie — the attributes must match (esp. `Path=/`, no
 * `Domain`) or some agents ignore the deletion.
 */
export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

/** Parse a `Cookie` request header into a name→value map; absent/empty ⇒ `{}`. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}
