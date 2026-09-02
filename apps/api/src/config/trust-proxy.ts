import { isIP } from "node:net";

/**
 * Client-IP resolution behind the reverse-proxy chain (#1655).
 *
 * Every source-address control in the api reads `request.ip` — the EARS-13
 * rate-limit windows (`auth/rate-limit/`), the login-challenge gate, the
 * session/admin-session fingerprint binding and the bot-protection guard. With
 * Fastify's `trustProxy` unset, `request.ip` is the SOCKET peer, which in this
 * deployment is always the Caddy container: every visitor collapses onto one
 * address, so the per-address windows bound the whole platform instead of a
 * caller, and the session fingerprint's IP/24 term is a constant.
 *
 * The fix is a PREDICATE over trusted proxy ADDRESSES, not a hop count. The two
 * live paths have different chain lengths:
 *
 *   • academy / api direct — client → Caddy → api            (1 proxy hop)
 *   • doctor storefront    — client → Caddy → Next `/v1/:path*` rewrite → api
 *                                                             (2 proxy hops)
 *
 * A static `trustProxy: <number>` is therefore wrong for one of the two paths in
 * either direction (too few ⇒ the storefront resolves to the Next container; too
 * many ⇒ the direct path resolves to a client-supplied value one step further
 * left than the real client — i.e. spoofable). Given a list of trusted
 * addresses/CIDRs, Fastify (via `proxy-addr`) walks `x-forwarded-for`
 * RIGHT-to-LEFT skipping trusted entries and stops at the first untrusted one:
 * that address is the real client on BOTH paths, and a header injected by an
 * untrusted peer can never be believed — a request arriving at the api from an
 * address outside the trusted set keeps its socket peer as `request.ip`, whatever
 * `x-forwarded-for` it carries.
 *
 * The trusted set is config, never a hardcoded constant (AGENTS.md §9).
 */

/**
 * `proxy-addr` preset names accepted alongside literal addresses/CIDRs:
 * `loopback` (127.0.0.0/8, ::1/128), `linklocal` (169.254.0.0/16, fe80::/10),
 * `uniquelocal` (the RFC 1918 private ranges + fc00::/7).
 */
const PRESET_NAMES = new Set(["loopback", "linklocal", "uniquelocal"]);

/**
 * Default trusted set: loopback + link-local + the RFC 1918 / unique-local
 * private ranges. This is exactly the address space a container network hands
 * out, so the Compose deployment (Caddy → api, and Caddy → Next → api) resolves
 * the real client with NO extra configuration, while anything arriving from a
 * public address — the only way a spoofed header could reach the api directly —
 * is untrusted and its `x-forwarded-for` is ignored.
 *
 * Frozen: `resolveTrustProxy` always returns a fresh copy, so a caller mutating
 * its result can never poison the default for the next boot/test.
 */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = Object.freeze([
  "loopback",
  "linklocal",
  "uniquelocal",
]);

/** Env slice this resolver reads. */
export interface TrustProxyEnv {
  TRUSTED_PROXIES?: string | undefined;
}

/** One rejected `TRUSTED_PROXIES` entry, reported to the caller's warn sink. */
export interface TrustProxyRejection {
  readonly value: string;
  readonly reason: string;
}

/** `true` for an IPv4/IPv6 literal, optionally with a valid CIDR prefix. */
function isAddressOrCidr(entry: string): boolean {
  const slash = entry.indexOf("/");
  if (slash === -1) return isIP(entry) !== 0;

  const address = entry.slice(0, slash);
  const prefix = entry.slice(slash + 1);
  const family = isIP(address);
  if (family === 0) return false;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= (family === 4 ? 32 : 128);
}

/**
 * Resolve the Fastify `trustProxy` value from the environment, FAIL-SAFE.
 *
 * Contract, mirroring `resolveRateLimitThresholds` (#1076): unset/blank ⇒ the
 * byte-identical defaults; a comma-separated list of preset names / addresses /
 * CIDRs ⇒ that list; a malformed entry ⇒ dropped with a loud warn while the
 * VALID entries still apply; every entry malformed ⇒ the defaults + warns.
 *
 * Fail-safe, not fail-open: the worst outcome of a fat-fingered value is the
 * conservative default trusted set, never `trustProxy: true` (which would
 * believe any `x-forwarded-for` from anyone) and never a boot crash on a knob
 * that ops may edit under a live incident.
 */
export function resolveTrustProxy(
  env: TrustProxyEnv,
  onReject: (rejection: TrustProxyRejection) => void = () => {},
): string[] {
  const raw = env.TRUSTED_PROXIES?.trim();
  if (!raw) return [...DEFAULT_TRUSTED_PROXIES];

  const accepted: string[] = [];
  for (const token of raw.split(",")) {
    const entry = token.trim();
    if (entry === "") continue;
    if (PRESET_NAMES.has(entry) || isAddressOrCidr(entry)) {
      accepted.push(entry);
      continue;
    }
    onReject({
      value: entry,
      reason:
        "not an IP address, CIDR block, or one of loopback/linklocal/uniquelocal",
    });
  }

  return accepted.length > 0 ? accepted : [...DEFAULT_TRUSTED_PROXIES];
}
