import { describe, expect, it } from "vitest";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import {
  DEFAULT_TRUSTED_PROXIES,
  resolveTrustProxy,
  type TrustProxyEnv,
  type TrustProxyRejection,
} from "./trust-proxy.js";

// #1655: every source-address control in the api (EARS-13 rate-limit windows,
// login-challenge gate, session fingerprint, bot protection) reads `request.ip`.
// With `trustProxy` unset that was the socket peer — the Caddy container — so
// the whole platform shared one address. These tests pin BOTH halves of the fix:
// the fail-safe env resolver, and the actual Fastify behaviour the resolved
// value produces (a forwarded header is honoured from a trusted peer and
// ignored from an untrusted one).

describe("resolveTrustProxy (#1655 env parsing)", () => {
  const rejections = (env: TrustProxyEnv) => {
    const seen: TrustProxyRejection[] = [];
    const result = resolveTrustProxy(env, (r) => seen.push(r));
    return { result, seen };
  };

  it("EARS-13 (#1655): unset TRUSTED_PROXIES resolves to the default trusted set, no rejections", () => {
    const { result, seen } = rejections({});
    expect(result).toEqual([...DEFAULT_TRUSTED_PROXIES]);
    expect(seen).toEqual([]);
  });

  it("EARS-13 (#1655): the resolved list is a fresh copy — mutating it never touches the shared default", () => {
    const result = resolveTrustProxy({});
    result.push("203.0.113.7");
    expect([...DEFAULT_TRUSTED_PROXIES]).toEqual([
      "loopback",
      "linklocal",
      "uniquelocal",
    ]);
  });

  it("EARS-13 (#1655): a comma-separated list of addresses, CIDRs and preset names is accepted verbatim", () => {
    const { result, seen } = rejections({
      TRUSTED_PROXIES: "loopback, 10.0.0.0/8 ,172.18.0.5,::1,fd00::/8",
    });
    expect(result).toEqual([
      "loopback",
      "10.0.0.0/8",
      "172.18.0.5",
      "::1",
      "fd00::/8",
    ]);
    expect(seen).toEqual([]);
  });

  it("EARS-13 (#1655): a malformed entry is dropped with a warn while the valid entries still apply", () => {
    const { result, seen } = rejections({
      TRUSTED_PROXIES: "10.0.0.0/8,not-an-address,192.168.0.1",
    });
    expect(result).toEqual(["10.0.0.0/8", "192.168.0.1"]);
    expect(seen.map((r) => r.value)).toEqual(["not-an-address"]);
  });

  it("EARS-13 (#1655): an out-of-range CIDR prefix is rejected, not silently trusted", () => {
    const { result, seen } = rejections({ TRUSTED_PROXIES: "10.0.0.0/64" });
    expect(result).toEqual([...DEFAULT_TRUSTED_PROXIES]);
    expect(seen.map((r) => r.value)).toEqual(["10.0.0.0/64"]);
  });

  it("EARS-13 (#1655): an all-malformed value falls back to the default set — never fail-open, never a crash", () => {
    const { result, seen } = rejections({ TRUSTED_PROXIES: "true,*,0" });
    expect(result).toEqual([...DEFAULT_TRUSTED_PROXIES]);
    expect(seen).toHaveLength(3);
  });

  it("EARS-13 (#1655): a blank value is treated as unset", () => {
    expect(resolveTrustProxy({ TRUSTED_PROXIES: "   " })).toEqual([
      ...DEFAULT_TRUSTED_PROXIES,
    ]);
  });
});

describe("Fastify client-IP resolution (#1655 AC 1 + AC 2)", () => {
  /**
   * Bootstrap the SAME adapter `createApiApplication` builds — the Fastify
   * instance carrying the resolved `trustProxy` — with a single echo route, so
   * the assertion is against real `proxy-addr` behaviour rather than a re-stated
   * expectation. Nest's DI container is not involved: this pins the transport
   * layer, which is where the bug lived.
   */
  const ipEcho = (env: TrustProxyEnv) => {
    const adapter = new FastifyAdapter({ trustProxy: resolveTrustProxy(env) });
    const instance = adapter.getInstance();
    instance.get("/__ip", (request, reply) => {
      void reply.send({ ip: request.ip, ips: request.ips });
    });
    return async (remoteAddress: string, forwardedFor?: string) => {
      const response = await instance.inject({
        method: "GET",
        url: "/__ip",
        remoteAddress,
        ...(forwardedFor === undefined
          ? {}
          : { headers: { "x-forwarded-for": forwardedFor } }),
      });
      return response.json() as { ip: string; ips?: string[] };
    };
  };

  it("EARS-13 (#1655): x-forwarded-for from a trusted proxy resolves request.ip to the real client", async () => {
    const call = ipEcho({});
    // client → Caddy → api: one hop, the container network peer is trusted.
    const { ip } = await call("172.18.0.4", "203.0.113.7");
    expect(ip).toBe("203.0.113.7");
  });

  it("EARS-13 (#1655): the two-hop storefront chain resolves to the same client, so no hop count is assumed", async () => {
    const call = ipEcho({});
    // client → Caddy → Next `/v1/:path*` rewrite → api: two hops, both private.
    const { ip } = await call("172.18.0.9", "203.0.113.7, 172.18.0.4");
    expect(ip).toBe("203.0.113.7");
  });

  it("EARS-13 (#1655): a spoofed x-forwarded-for from an UNTRUSTED peer is ignored", async () => {
    const call = ipEcho({});
    // A request reaching the api directly from a public address: whatever header
    // it carries, `request.ip` stays the socket peer.
    const { ip } = await call("198.51.100.23", "203.0.113.7");
    expect(ip).toBe("198.51.100.23");
  });

  it("EARS-13 (#1655): a client-injected hop LEFT of the trusted chain is not adopted as the client", async () => {
    const call = ipEcho({});
    // The real client prepends a forged address; proxy-addr stops at the first
    // untrusted entry from the right, which is the real client's own address.
    const { ip } = await call("172.18.0.4", "10.9.9.9, 203.0.113.7");
    expect(ip).toBe("203.0.113.7");
  });

  it("EARS-13 (#1655): with no forwarded header request.ip is the socket peer", async () => {
    const call = ipEcho({});
    const { ip } = await call("172.18.0.4");
    expect(ip).toBe("172.18.0.4");
  });

  it("EARS-13 (#1655): an explicit TRUSTED_PROXIES narrows the trusted set — a private peer outside it is untrusted", async () => {
    const call = ipEcho({ TRUSTED_PROXIES: "172.18.0.4" });
    expect((await call("172.18.0.4", "203.0.113.7")).ip).toBe("203.0.113.7");
    expect((await call("10.1.2.3", "203.0.113.7")).ip).toBe("10.1.2.3");
  });
});
