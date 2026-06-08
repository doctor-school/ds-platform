import { describe, expect, it } from "vitest";
import type { FetchLike } from "./zitadel.idp.js";
import { ZitadelIdpClient } from "./zitadel.idp.js";

/**
 * Unit coverage for the real Zitadel adapter's OIDC session→token exchange
 * (EARS-8, design §3) against a scripted `fetch` double — no live instance. It
 * pins the three-hop dance (authorize → link checked session → token endpoint)
 * and the claim parsing (`roles[]` from the Zitadel project-roles claim, `mfa`
 * from `amr`). The live-instance contract is asserted by the `IDP_ISSUER`-gated
 * integration spec; here we prove the wire shape and the parsing deterministically.
 */

/** Build a base64url JWT body (no signature verification — the IdP signs). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.`;
}

interface ScriptedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

/**
 * A fetch double scripting the authorize redirect, the auth-request callback,
 * and the token response. Records every call so the test can assert the wire.
 */
function scriptedFetch(opts: {
  authRequestId?: string;
  callbackUrl?: string;
  token?: { ok: boolean; status: number; body: unknown };
}): { fetchImpl: FetchLike; calls: ScriptedCall[] } {
  const calls: ScriptedCall[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    // 1. authorize → 302 with `authRequest=<id>` in the Location.
    if (url.includes("/oauth/v2/authorize")) {
      return Promise.resolve({
        ok: false,
        status: 302,
        headers: {
          location: `/ui/login/login?authRequest=${opts.authRequestId ?? "AR-1"}`,
        },
        json: () => Promise.resolve({}),
      });
    }
    // 2. link the checked session → { callbackUrl } carrying the code.
    if (url.includes("/v2/oidc/auth_requests/")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            callbackUrl:
              opts.callbackUrl ?? "http://app/callback?code=THE_CODE&state=xyz",
          }),
      });
    }
    // 3. token endpoint.
    if (url.includes("/oauth/v2/token")) {
      const t = opts.token ?? { ok: true, status: 200, body: {} };
      return Promise.resolve({
        ok: t.ok,
        status: t.status,
        json: () => Promise.resolve(t.body),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });
  };
  return { fetchImpl, calls };
}

const BASE_CONFIG = {
  baseUrl: "http://idp.test:9080",
  serviceToken: "svc-token",
  clientId: "ds-platform-dev",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:3000/auth/callback",
  scopes: ["openid", "profile", "urn:zitadel:iam:org:project:roles"],
};

const ROLES_CLAIM = "urn:zitadel:iam:org:project:roles";

describe("ZitadelIdpClient OIDC session→token exchange", () => {
  it("EARS-8: completes authorize → link-session → token and parses roles[]/mfa from the id_token", async () => {
    const { fetchImpl, calls } = scriptedFetch({
      token: {
        ok: true,
        status: 200,
        body: {
          access_token: "ACCESS",
          refresh_token: "REFRESH",
          expires_in: 900,
          id_token: jwt({
            sub: "zid-user-1",
            amr: ["pwd", "mfa"],
            [ROLES_CLAIM]: { doctor_guest: { org1: "doctor.school" } },
          }),
        },
      },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });

    client.rememberSessionToken("sess-1", "session-token-1");
    const tokens = await client.exchangeSessionForTokens("sess-1");

    expect(tokens.accessToken).toBe("ACCESS");
    expect(tokens.refreshToken).toBe("REFRESH");
    expect(tokens.expiresInSeconds).toBe(900);
    expect(tokens.claims.sub).toBe("zid-user-1");
    expect(tokens.claims.roles).toEqual(["doctor_guest"]);
    expect(tokens.claims.mfa).toBe(true);

    // Wire assertions: authorize carried the OIDC app params; the link hop sent
    // the checked session; the token hop used the authorization_code grant.
    const authorize = calls.find((c) => c.url.includes("/oauth/v2/authorize"));
    expect(authorize?.url).toContain("client_id=ds-platform-dev");
    expect(authorize?.url).toContain("response_type=code");
    const link = calls.find((c) => c.url.includes("/v2/oidc/auth_requests/"));
    expect(link?.body).toContain("sess-1");
    expect(link?.body).toContain("session-token-1");
    const token = calls.find((c) => c.url.includes("/oauth/v2/token"));
    expect(token?.body).toContain("grant_type=authorization_code");
    expect(token?.body).toContain("code=THE_CODE");
  });

  it("EARS-8: mfa is false when amr carries only a single primary factor", async () => {
    const { fetchImpl } = scriptedFetch({
      token: {
        ok: true,
        status: 200,
        body: {
          access_token: "ACCESS",
          refresh_token: "REFRESH",
          expires_in: 900,
          id_token: jwt({
            sub: "zid-user-2",
            amr: ["pwd"],
            [ROLES_CLAIM]: { doctor_guest: {} },
          }),
        },
      },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    client.rememberSessionToken("sess-2", "session-token-2");
    const tokens = await client.exchangeSessionForTokens("sess-2");
    expect(tokens.claims.mfa).toBe(false);
    expect(tokens.claims.roles).toEqual(["doctor_guest"]);
  });

  it("EARS-8: parses multiple project roles; single-factor otp in amr is NOT mfa", async () => {
    // EARS-6/7 passwordless OTP logins are single factor: Zitadel emits
    // `amr:["otp"]`. That must derive `mfa:false` (only the dedicated RFC 8176
    // `"mfa"` reference means multi-factor) so the `role → mfa_required` seam
    // (design §7) does not fail-open on a passwordless login.
    const { fetchImpl } = scriptedFetch({
      token: {
        ok: true,
        status: 200,
        body: {
          access_token: "A",
          refresh_token: "R",
          expires_in: 900,
          id_token: jwt({
            sub: "zid-user-3",
            amr: ["otp"],
            [ROLES_CLAIM]: { doctor_guest: {}, expert: {} },
          }),
        },
      },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    client.rememberSessionToken("sess-3", "t3");
    const tokens = await client.exchangeSessionForTokens("sess-3");
    expect(tokens.claims.roles.sort()).toEqual(["doctor_guest", "expert"]);
    expect(tokens.claims.mfa).toBe(false);
  });

  it("EARS-8: mfa is false when the id_token carries no amr claim", async () => {
    const { fetchImpl } = scriptedFetch({
      token: {
        ok: true,
        status: 200,
        body: {
          access_token: "A",
          refresh_token: "R",
          expires_in: 900,
          // No `amr` claim at all.
          id_token: jwt({
            sub: "zid-user-5",
            [ROLES_CLAIM]: { doctor_guest: {} },
          }),
        },
      },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    client.rememberSessionToken("sess-5", "t5");
    const tokens = await client.exchangeSessionForTokens("sess-5");
    expect(tokens.claims.mfa).toBe(false);
  });

  it("EARS-8: mfa is false when amr is empty", async () => {
    const { fetchImpl } = scriptedFetch({
      token: {
        ok: true,
        status: 200,
        body: {
          access_token: "A",
          refresh_token: "R",
          expires_in: 900,
          id_token: jwt({
            sub: "zid-user-6",
            amr: [],
            [ROLES_CLAIM]: { doctor_guest: {} },
          }),
        },
      },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    client.rememberSessionToken("sess-6", "t6");
    const tokens = await client.exchangeSessionForTokens("sess-6");
    expect(tokens.claims.mfa).toBe(false);
  });

  it("EARS-8: rejects when the token endpoint fails (no token minted on a non-2xx)", async () => {
    const { fetchImpl } = scriptedFetch({
      token: { ok: false, status: 400, body: { error: "invalid_grant" } },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    client.rememberSessionToken("sess-4", "t4");
    await expect(client.exchangeSessionForTokens("sess-4")).rejects.toThrow();
  });

  it("EARS-8: rejects when the checked session token was never captured", async () => {
    const { fetchImpl } = scriptedFetch({});
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    await expect(
      client.exchangeSessionForTokens("unknown-session"),
    ).rejects.toThrow();
  });

  it("EARS-8: fails closed when the OIDC application config is absent (no clientId)", async () => {
    const { fetchImpl } = scriptedFetch({});
    const client = new ZitadelIdpClient({
      baseUrl: "http://idp.test:9080",
      serviceToken: "svc",
      fetchImpl,
    });
    client.rememberSessionToken("s", "t");
    await expect(client.exchangeSessionForTokens("s")).rejects.toThrow(
      /OIDC application/i,
    );
  });

  it("EARS-9: refresh-token rotation hits the token endpoint with the refresh grant and parses claims", async () => {
    const { fetchImpl, calls } = scriptedFetch({
      token: {
        ok: true,
        status: 200,
        body: {
          access_token: "A2",
          refresh_token: "R2",
          expires_in: 900,
          id_token: jwt({
            sub: "zid-user-1",
            amr: ["pwd"],
            [ROLES_CLAIM]: { doctor_guest: {} },
          }),
        },
      },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    const result = await client.refreshTokens("OLD_REFRESH");
    expect(result.reuseDetected).toBe(false);
    if (!result.reuseDetected) {
      expect(result.tokens.accessToken).toBe("A2");
      expect(result.tokens.refreshToken).toBe("R2");
      expect(result.tokens.claims.roles).toEqual(["doctor_guest"]);
    }
    const token = calls.find((c) => c.url.includes("/oauth/v2/token"));
    expect(token?.body).toContain("grant_type=refresh_token");
    expect(token?.body).toContain("refresh_token=OLD_REFRESH");
  });

  it("EARS-9: a rejected refresh grant resolves to reuseDetected (RFC-6819)", async () => {
    const { fetchImpl } = scriptedFetch({
      token: { ok: false, status: 400, body: { error: "invalid_grant" } },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    const result = await client.refreshTokens("REUSED");
    expect(result.reuseDetected).toBe(true);
  });
});

/**
 * Wire-shape pins for the email/phone verification-code send + verify hops
 * (EARS-3, design §4) against a scripted `fetch` double. These lock the Zitadel
 * v4 User-v2 paths the live dev-stand actually serves (#148): the send is
 * `POST /v2/users/{id}/email/resend` with the `{ sendCode: {} }` oneof (the old
 * `/email/_send_code` 404s live), and the verify is `POST /v2/users/{id}/email/verify`
 * (the old `/email/_verify` also 404s live). The `IDP_ISSUER`-gated integration
 * spec proves the Mailpit round-trip; here we pin the wire deterministically.
 */
describe("ZitadelIdpClient email/phone verification wire shape (#148)", () => {
  /** A fetch double that records calls and returns a scripted ok/status. */
  function recordingFetch(result: { ok: boolean; status: number }): {
    fetchImpl: FetchLike;
    calls: ScriptedCall[];
  } {
    const calls: ScriptedCall[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body,
      });
      return Promise.resolve({
        ok: result.ok,
        status: result.status,
        json: () => Promise.resolve({}),
      });
    };
    return { fetchImpl, calls };
  }

  const SEND_CONFIG = {
    baseUrl: "http://idp.test:9080",
    serviceToken: "svc-token",
  };

  it("EARS-3: requestEmailVerification POSTs /email/resend with the sendCode oneof", async () => {
    const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
    const client = new ZitadelIdpClient({ ...SEND_CONFIG, fetchImpl });
    await client.requestEmailVerification("user-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://idp.test:9080/v2/users/user-1/email/resend");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ sendCode: {} });
  });

  it("EARS-3: requestEmailVerification throws fail-closed on a non-2xx send", async () => {
    const { fetchImpl } = recordingFetch({ ok: false, status: 404 });
    const client = new ZitadelIdpClient({ ...SEND_CONFIG, fetchImpl });
    await expect(client.requestEmailVerification("user-1")).rejects.toThrow(
      /email send_code failed: HTTP 404/,
    );
  });

  it("EARS-3: requestPhoneVerification POSTs /phone/resend with the sendCode oneof", async () => {
    const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
    const client = new ZitadelIdpClient({ ...SEND_CONFIG, fetchImpl });
    await client.requestPhoneVerification("user-1");
    expect(calls[0]?.url).toBe("http://idp.test:9080/v2/users/user-1/phone/resend");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ sendCode: {} });
  });

  it("EARS-3: verifyEmail POSTs /email/verify and returns true on 2xx", async () => {
    const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
    const client = new ZitadelIdpClient({ ...SEND_CONFIG, fetchImpl });
    const ok = await client.verifyEmail("user-1", "ABC123");
    expect(ok).toBe(true);
    expect(calls[0]?.url).toBe("http://idp.test:9080/v2/users/user-1/email/verify");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      verificationCode: "ABC123",
    });
  });

  it("EARS-3: verifyEmail returns false on a non-2xx (bad/expired code)", async () => {
    const { fetchImpl } = recordingFetch({ ok: false, status: 400 });
    const client = new ZitadelIdpClient({ ...SEND_CONFIG, fetchImpl });
    expect(await client.verifyEmail("user-1", "BAD")).toBe(false);
  });

  it("EARS-3: verifyPhone POSTs /phone/verify", async () => {
    const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
    const client = new ZitadelIdpClient({ ...SEND_CONFIG, fetchImpl });
    await client.verifyPhone("user-1", "ABC123");
    expect(calls[0]?.url).toBe("http://idp.test:9080/v2/users/user-1/phone/verify");
  });
});
