import { describe, expect, it } from "vitest";
import type { FetchLike } from "./zitadel.idp.js";
import { ZitadelIdpClient } from "./zitadel.idp.js";
import { InMemoryOtpChallengeStore } from "./otp-challenge-store.fake.js";
import {
  IdpInvalidArgumentError,
  IdpPasswordPolicyError,
  IdpUnavailableError,
} from "./idp.types.js";

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

    const tokens = await client.exchangeSessionForTokens({
      zitadelSessionId: "sess-1",
      sub: "zid-user-1",
      sessionToken: "session-token-1",
    });

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
    const tokens = await client.exchangeSessionForTokens({
      zitadelSessionId: "sess-2",
      sub: "zid-user-2",
      sessionToken: "session-token-2",
    });
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
    const tokens = await client.exchangeSessionForTokens({
      zitadelSessionId: "sess-3",
      sub: "zid-user-3",
      sessionToken: "t3",
    });
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
    const tokens = await client.exchangeSessionForTokens({
      zitadelSessionId: "sess-5",
      sub: "zid-user-5",
      sessionToken: "t5",
    });
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
    const tokens = await client.exchangeSessionForTokens({
      zitadelSessionId: "sess-6",
      sub: "zid-user-6",
      sessionToken: "t6",
    });
    expect(tokens.claims.mfa).toBe(false);
  });

  it("EARS-8: rejects when the token endpoint fails (no token minted on a non-2xx)", async () => {
    const { fetchImpl } = scriptedFetch({
      token: { ok: false, status: 400, body: { error: "invalid_grant" } },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    await expect(
      client.exchangeSessionForTokens({
        zitadelSessionId: "sess-4",
        sub: "zid-user-4",
        sessionToken: "t4",
      }),
    ).rejects.toThrow();
  });

  it("EARS-8: fails closed when the session handle carries no checked-session token (#143)", async () => {
    // #143: the proof-of-check token now rides the IdpSession handle; a
    // missing/empty one must fail closed (mint nothing) exactly as the old
    // uncaptured-token path did — never an open gate (ADR-0001 §7).
    const { fetchImpl } = scriptedFetch({});
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    await expect(
      client.exchangeSessionForTokens({
        zitadelSessionId: "unknown-session",
        sub: "zid-user-x",
        sessionToken: "",
      }),
    ).rejects.toThrow(/checked-session token/i);
  });

  it("EARS-8: fails closed when the OIDC application config is absent (no clientId)", async () => {
    const { fetchImpl } = scriptedFetch({});
    const client = new ZitadelIdpClient({
      baseUrl: "http://idp.test:9080",
      serviceToken: "svc",
      fetchImpl,
    });
    await expect(
      client.exchangeSessionForTokens({
        zitadelSessionId: "s",
        sub: "zid-user-s",
        sessionToken: "t",
      }),
    ).rejects.toThrow(/OIDC application/i);
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
    expect(calls[0]?.url).toBe(
      "http://idp.test:9080/v2/users/user-1/email/resend",
    );
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ sendCode: {} });
  });

  it("003 EARS-3: with a portal origin configured the email send carries a /verify#email= FRAGMENT urlTemplate — identifier in the fragment, no query param (#904)", async () => {
    // #869 owner Stage-A verdict: the verification email is CODE-ONLY, and its CTA
    // must consume nothing on GET — mail.ru's `checklink` AV prefetch GETs every URL
    // in a delivered message before the human ever clicks. #904 owner Stage-A verdict:
    // the identifier now rides the URL FRAGMENT (`/verify#email=<addr>`), which browsers
    // NEVER send to the server, so the cold email-button open can seed the account and
    // the submit works — while the prefetch-safety invariant is preserved (a fragment is
    // not a query param, consumes nothing on GET). The invariant: NO query (`?`/`&`) AND
    // the `#email=` fragment carries the identifier.
    const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
    const client = new ZitadelIdpClient({
      ...SEND_CONFIG,
      portalBaseUrl: "http://portal.test:3001",
      fetchImpl,
    });
    await client.requestEmailVerification("user-1", "doc+a@example.com");
    const body = JSON.parse(calls[0]?.body ?? "{}") as {
      sendCode?: { urlTemplate?: string };
    };
    expect(body).toEqual({
      sendCode: {
        urlTemplate:
          "http://portal.test:3001/verify#email=doc%2Ba%40example.com",
      },
    });
    // The identifier rides the FRAGMENT, never a query param: no `?`/`&` anywhere.
    expect(body.sendCode?.urlTemplate).not.toMatch(/[?&]/);
    // …and the `#email=` fragment identifier is present.
    expect(body.sendCode?.urlTemplate).toContain("#email=");
  });

  it("003 EARS-3: the urlTemplate strips a trailing slash off the configured portal origin before the fragment (#904)", async () => {
    const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
    const client = new ZitadelIdpClient({
      ...SEND_CONFIG,
      portalBaseUrl: "http://portal.test:3001/",
      fetchImpl,
    });
    await client.requestEmailVerification("user-1", "doc@example.com");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      sendCode: {
        urlTemplate: "http://portal.test:3001/verify#email=doc%40example.com",
      },
    });
  });

  it("003 EARS-3: requestPhoneVerification stays a bare sendCode even with a portal origin configured (#869 — the SMS hop is untouched)", async () => {
    const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
    const client = new ZitadelIdpClient({
      ...SEND_CONFIG,
      portalBaseUrl: "http://portal.test:3001",
      fetchImpl,
    });
    await client.requestPhoneVerification("user-1");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ sendCode: {} });
  });

  it("003 EARS-25: resendEmailVerification carries the same /verify#email= FRAGMENT urlTemplate on the re-send hop (#904)", async () => {
    // The EARS-25 resend re-issues the SAME registration email as the initial
    // EARS-3 send, so it must be scanner-safe AND carry the identifier in the
    // fragment too — otherwise only the first email seeds the cold /verify open and
    // every re-sent one still dead-ends on a bare /verify. The resend already knows
    // the identifier (it is the resolution key), so it bakes it into the fragment.
    const calls: ScriptedCall[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body,
      });
      // Identifier-resolution hop: an existing, UNVERIFIED registrant.
      if (url.endsWith("/v2/users")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              result: [
                { userId: "user-9", human: { email: { isVerified: false } } },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    };
    const client = new ZitadelIdpClient({
      ...SEND_CONFIG,
      portalBaseUrl: "http://portal.test:3001",
      fetchImpl,
    });
    await expect(client.resendEmailVerification("user@ds.test")).resolves.toBe(
      true,
    );
    const resend = calls.find((c) => c.url.endsWith("/email/resend"));
    expect(resend, "the resend hop was reached").toBeTruthy();
    expect(JSON.parse(resend!.body ?? "{}")).toEqual({
      sendCode: {
        urlTemplate: "http://portal.test:3001/verify#email=user%40ds.test",
      },
    });
    // Fragment-only: the re-sent link carries no query param either.
    const body = JSON.parse(resend!.body ?? "{}") as {
      sendCode?: { urlTemplate?: string };
    };
    expect(body.sendCode?.urlTemplate).not.toMatch(/[?&]/);
    expect(body.sendCode?.urlTemplate).toContain("#email=");
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
    expect(calls[0]?.url).toBe(
      "http://idp.test:9080/v2/users/user-1/phone/resend",
    );
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ sendCode: {} });
  });

  it("EARS-3: verifyEmail POSTs /email/verify and returns true on 2xx", async () => {
    const { fetchImpl, calls } = recordingFetch({ ok: true, status: 200 });
    const client = new ZitadelIdpClient({ ...SEND_CONFIG, fetchImpl });
    const ok = await client.verifyEmail("user-1", "ABC123");
    expect(ok).toBe(true);
    expect(calls[0]?.url).toBe(
      "http://idp.test:9080/v2/users/user-1/email/verify",
    );
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
    expect(calls[0]?.url).toBe(
      "http://idp.test:9080/v2/users/user-1/phone/verify",
    );
  });
});

/**
 * #880 — the password-reset send (EARS-11) is CODE-ONLY, like the #869
 * verification email and the #878 login-OTP email. Zitadel's default
 * `password_reset` send (an empty body) renders a CTA whose URL is the IdP's
 * hosted set-password page on the identity host — a surface the product's
 * users must never see (the portal `/reset` screen owns the journey). The
 * send therefore carries the `PasswordResetRequest` oneof
 * `sendLink.urlTemplate` (proto: `SendPasswordResetLink { notification_type,
 * url_template }` — placeholders UserID/OrgID/Code are supported and
 * DELIBERATELY unused) pointing at the BARE portal `/reset`: no query, no
 * placeholders, nothing consumed on GET (mail.ru `checklink` scanner safety,
 * the #869 contract). `returnCode` is NOT used — the secret must ride the
 * configured notifier, never the HTTP response.
 */
describe("003 EARS-11 password-reset send wire shape (#880)", () => {
  const SEND_CONFIG = {
    baseUrl: "http://idp.test:9080",
    serviceToken: "svc-token",
  };

  /**
   * A routing fetch double: answers the identifier-resolution hop
   * (`POST /v2/users`) with one known user and records every call, so the
   * follow-on `/password_reset` hop's body can be asserted.
   */
  function resetFetch(): { fetchImpl: FetchLike; calls: ScriptedCall[] } {
    const calls: ScriptedCall[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body,
      });
      if (url.endsWith("/v2/users")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ result: [{ userId: "user-11" }] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    };
    return { fetchImpl, calls };
  }

  it("EARS-11: with a portal origin configured the reset send carries a BARE /reset sendLink urlTemplate — no code/userId params", async () => {
    const { fetchImpl, calls } = resetFetch();
    const client = new ZitadelIdpClient({
      ...SEND_CONFIG,
      portalBaseUrl: "http://portal.test:3001",
      fetchImpl,
    });
    await client.requestPasswordReset("user@ds.test");
    const reset = calls.find((c) => c.url.endsWith("/password_reset"));
    expect(reset, "the password_reset hop was reached").toBeTruthy();
    expect(reset?.url).toBe(
      "http://idp.test:9080/v2/users/user-11/password_reset",
    );
    expect(reset?.method).toBe("POST");
    const body = JSON.parse(reset?.body ?? "{}") as {
      sendLink?: { notificationType?: string; urlTemplate?: string };
    };
    expect(body).toEqual({
      sendLink: {
        notificationType: "NOTIFICATION_TYPE_Email",
        urlTemplate: "http://portal.test:3001/reset",
      },
    });
    // Belt-and-braces: the scanner-safety invariant, asserted explicitly.
    expect(body.sendLink?.urlTemplate).not.toMatch(/[?&{]/);
  });

  it("EARS-11: the urlTemplate strips a trailing slash off the configured portal origin", async () => {
    const { fetchImpl, calls } = resetFetch();
    const client = new ZitadelIdpClient({
      ...SEND_CONFIG,
      portalBaseUrl: "http://portal.test:3001/",
      fetchImpl,
    });
    await client.requestPasswordReset("user@ds.test");
    const reset = calls.find((c) => c.url.endsWith("/password_reset"));
    expect(JSON.parse(reset?.body ?? "{}")).toEqual({
      sendLink: {
        notificationType: "NOTIFICATION_TYPE_Email",
        urlTemplate: "http://portal.test:3001/reset",
      },
    });
  });

  it("EARS-11: without a portal origin the send keeps the empty default body", async () => {
    const { fetchImpl, calls } = resetFetch();
    const client = new ZitadelIdpClient({ ...SEND_CONFIG, fetchImpl });
    await client.requestPasswordReset("user@ds.test");
    const reset = calls.find((c) => c.url.endsWith("/password_reset"));
    expect(JSON.parse(reset?.body ?? "{}")).toEqual({});
  });
});

/**
 * #203 — createUser migrated to the CURRENT resource API `CreateUser`
 * (`POST /v2/users/new`), which REPLACES the deprecated `AddHumanUser`
 * (`POST /v2/users/human`). These pins lock the new wire shape proven live
 * against the v4.15 dev-stand:
 *   • URL `POST /v2/users/new` (the old `/v2/users/human` is gone).
 *   • body `{ organizationId, username, human: { profile, email:{ email,
 *     returnCode:{} }, password:{ password } } }` — the human fields nest under
 *     `human`, and `organizationId` is a NEW required field (the old RPC inferred
 *     it from the token; CreateUser 400s `invalid CreateUserRequest.OrganizationId`
 *     without it).
 *   • the new-user id is read from the response `id` (CreateUserResponse), NOT
 *     `userId`.
 *   • `returnCode: {}` under `human.email` suppresses the auto-send (the code is
 *     echoed as `emailCode` in the response instead — the #153 single-delivered-
 *     code invariant).
 *
 * The #147 failure-mapping contract is preserved: the enumeration-safety hinge
 * stays a 409 → `alreadyExisted`; a password-policy 400 → typed
 * {@link IdpPasswordPolicyError} (→ generic 422); any other deterministic 4xx →
 * {@link IdpInvalidArgumentError} (#202, → generic 4xx); 5xx → opaque (→ 503).
 * The password-policy signal now matches Zitadel's locale-independent `COMMA-`
 * error-id prefix (the live dev-stand answers in Russian, #195/#203 — the old
 * English `"password"`/`"complexity"` body-token match no longer fires).
 */
describe("ZitadelIdpClient createUser → CreateUser /v2/users/new (#203)", () => {
  /** A fetch double that records calls and answers per-URL (orgs/me + create). */
  function createFetch(create: { status: number; body?: unknown }): {
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
      // Org resolution hop (only hit when `orgId` is not configured).
      if (url.endsWith("/management/v1/orgs/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ org: { id: "org-resolved" } }),
        });
      }
      return Promise.resolve({
        ok: create.status >= 200 && create.status < 300,
        status: create.status,
        json: () => Promise.resolve(create.body ?? {}),
      });
    };
    return { fetchImpl, calls };
  }

  // Org id configured ⇒ no orgs/me round-trip; keeps the failure-mapping tests
  // focused on the create hop. The org-resolution fallback has its own test below.
  const CONFIG = {
    baseUrl: "http://idp.test:9080",
    serviceToken: "svc-token",
    orgId: "org-1",
  };
  const INPUT = { email: "user@ds.test", password: "Aa1!aaaa" };

  it("POSTs /v2/users/new with the organizationId + nested human{profile,email{returnCode},password} body and reads the response `id`", async () => {
    const { fetchImpl, calls } = createFetch({
      status: 201,
      body: {
        id: "u-99",
        creationDate: "2026-06-12T00:00:00Z",
        emailCode: "ABC123",
      },
    });
    const client = new ZitadelIdpClient({ ...CONFIG, fetchImpl });
    await expect(client.createUser(INPUT)).resolves.toEqual({
      sub: "u-99",
      alreadyExisted: false,
    });
    const create = calls.find((c) => c.url.endsWith("/v2/users/new"));
    expect(
      create,
      "create hit /v2/users/new (not /v2/users/human)",
    ).toBeTruthy();
    expect(create!.method).toBe("POST");
    expect(JSON.parse(create!.body ?? "{}")).toEqual({
      organizationId: "org-1",
      username: "user@ds.test",
      human: {
        profile: {
          givenName: "user",
          familyName: "guest",
          displayName: "user@ds.test",
        },
        password: { password: "Aa1!aaaa" },
        email: { email: "user@ds.test", returnCode: {} },
      },
    });
  });

  it("003 EARS-2 (#878): sends an EXPLICIT displayName = the registration identifier — Zitadel must never compute a «<local-part> guest» placeholder that its notification templates greet with", async () => {
    // #878: with no explicit displayName Zitadel computes `givenName familyName`
    // (e.g. "a guest") and renders it via {{.DisplayName}} in bundled email
    // greetings — the placeholder leaked user-facing. The identifier the user
    // registered with is the only truthful display value we hold at creation.
    const emailCase = createFetch({ status: 201, body: { id: "u-1" } });
    const client = new ZitadelIdpClient({
      ...CONFIG,
      fetchImpl: emailCase.fetchImpl,
    });
    await client.createUser({
      email: "www.alisa99@mail.ru",
      password: "Aa1!aaaa",
    });
    const emailCreate = emailCase.calls.find((c) =>
      c.url.endsWith("/v2/users/new"),
    );
    expect(JSON.parse(emailCreate!.body ?? "{}")).toMatchObject({
      human: {
        profile: {
          givenName: "www.alisa99",
          familyName: "guest",
          displayName: "www.alisa99@mail.ru",
        },
      },
    });

    // Phone-only creation (dormant path) falls back to the phone identifier —
    // never a computed "doctor guest".
    const phoneCase = createFetch({ status: 201, body: { id: "u-2" } });
    const phoneClient = new ZitadelIdpClient({
      ...CONFIG,
      fetchImpl: phoneCase.fetchImpl,
    });
    await phoneClient.createUser({
      phone: "+79001234567",
      password: "Aa1!aaaa",
    });
    const phoneCreate = phoneCase.calls.find((c) =>
      c.url.endsWith("/v2/users/new"),
    );
    expect(JSON.parse(phoneCreate!.body ?? "{}")).toMatchObject({
      human: {
        profile: {
          givenName: "doctor",
          familyName: "guest",
          displayName: "+79001234567",
        },
      },
    });
  });

  it("resolves the org id from /management/v1/orgs/me when IDP_ORG_ID is not configured (#203)", async () => {
    const { fetchImpl, calls } = createFetch({
      status: 201,
      body: { id: "u-1" },
    });
    const client = new ZitadelIdpClient({
      baseUrl: "http://idp.test:9080",
      serviceToken: "svc-token",
      fetchImpl,
    });
    await expect(client.createUser(INPUT)).resolves.toEqual({
      sub: "u-1",
      alreadyExisted: false,
    });
    expect(
      calls.some((c) => c.url.endsWith("/management/v1/orgs/me")),
      "the org was resolved from orgs/me",
    ).toBe(true);
    const create = calls.find((c) => c.url.endsWith("/v2/users/new"));
    expect(JSON.parse(create!.body ?? "{}")).toMatchObject({
      organizationId: "org-resolved",
    });
  });

  it("maps a 409 duplicate to alreadyExisted (not a throw) — the enumeration-safety hinge", async () => {
    const { fetchImpl } = createFetch({
      status: 409,
      body: { code: 6, message: "Пользователь уже существует (V3-DKcYh)" },
    });
    const client = new ZitadelIdpClient({ ...CONFIG, fetchImpl });
    await expect(client.createUser(INPUT)).resolves.toEqual({
      sub: "",
      alreadyExisted: true,
    });
  });

  it("maps a RU-localized password-policy 400 (COMMA- error id) to IdpPasswordPolicyError (#203 locale-independent)", async () => {
    // The live dev-stand answers in Russian (#195) — the old English body-token
    // match would miss this; the `COMMA-` id is the stable signal.
    const { fetchImpl } = createFetch({
      status: 400,
      body: {
        code: 3,
        message: "Пароль слишком короткий (COMMA-HuJf6)",
        details: [{ id: "COMMA-HuJf6", message: "Пароль слишком короткий" }],
      },
    });
    const client = new ZitadelIdpClient({ ...CONFIG, fetchImpl });
    await expect(client.createUser(INPUT)).rejects.toBeInstanceOf(
      IdpPasswordPolicyError,
    );
  });

  it("still maps an English password-policy 400 to IdpPasswordPolicyError (fallback for an EN instance)", async () => {
    const { fetchImpl } = createFetch({
      status: 400,
      body: { message: "Password does not match complexity policy" },
    });
    const client = new ZitadelIdpClient({ ...CONFIG, fetchImpl });
    await expect(client.createUser(INPUT)).rejects.toBeInstanceOf(
      IdpPasswordPolicyError,
    );
  });

  it("maps a non-password deterministic 4xx (e.g. invalid email) to IdpInvalidArgumentError, not password-policy (#202)", async () => {
    // The live invalid-email 400 carries NO `COMMA-` id, so it is NOT mislabeled
    // as a password rejection — it is the generic enumeration-safe 4xx.
    const { fetchImpl } = createFetch({
      status: 400,
      body: {
        code: 3,
        message:
          "invalid CreateUserRequest.Human: ... invalid SetHumanEmail.Email: value must be a valid email address",
      },
    });
    const client = new ZitadelIdpClient({ ...CONFIG, fetchImpl });
    const err = await client.createUser(INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IdpInvalidArgumentError);
    expect(err).not.toBeInstanceOf(IdpPasswordPolicyError);
  });

  it("maps a 5xx to IdpUnavailableError (a real infra fault → 503, never a bare 500)", async () => {
    const { fetchImpl } = createFetch({ status: 503 });
    const client = new ZitadelIdpClient({ ...CONFIG, fetchImpl });
    await expect(client.createUser(INPUT)).rejects.toBeInstanceOf(
      IdpUnavailableError,
    );
  });
});

/**
 * #153 — passwordless OTP-login (EARS-6 email / EARS-7 SMS) against the real
 * Zitadel Session v2 wire, pinned deterministically by a scripted `fetch`. The
 * request hop arms a session+challenge (`POST /v2/sessions`
 * `{ checks: { user: { userId } }, challenges: { otpEmail|otpSms: {} } }`); the
 * verify hop updates that session with the code (`POST /v2/sessions/{id}`
 * `{ sessionToken, checks: { otpEmail|otpSms: { code } } }`) and, on a 2xx,
 * caches the checked-session token so the shared OIDC exchange completes. These
 * exact field names/paths are the same live-wire-shape risk class that bit #122
 * and was corrected by #145/#148 — unit-pinned here, live-confirmed later.
 */
describe("ZitadelIdpClient passwordless OTP login wire shape (#153)", () => {
  /**
   * A fetch double scripting the whole OTP-login surface: the User v2 search
   * (`resolveUserId`), the Session v2 create-with-challenge and verify hops, AND
   * the three OIDC exchange hops (reusing the same authorize→link→token shapes as
   * the exchange double above) so a test can assert request→login→exchange
   * end-to-end. Records every call for wire assertions.
   */
  function otpFetch(opts: {
    /** `resolveUserId` result (the User v2 search `result[0].userId`); null ⇒ unknown. */
    userId?: string | null;
    /** Status of the session create-with-challenge hop. */
    createStatus?: number;
    /**
     * Status of the session verify hop (non-2xx ⇒ wrong/expired code). A single
     * number applies to every verify; an array scripts successive verify hops by
     * call order (e.g. `[403, 200]` = first attempt fails, retry succeeds) so a
     * test can prove the challenge survives a failed verify and a later correct
     * code still succeeds against the SAME cached session.
     */
    verifyStatus?: number | number[];
    /** Fresh session token the verify hop returns on success. */
    verifiedToken?: string;
    /** Token-endpoint response for the downstream exchange. */
    token?: { ok: boolean; status: number; body: unknown };
  }): { fetchImpl: FetchLike; calls: ScriptedCall[] } {
    const calls: ScriptedCall[] = [];
    // How many verify hops have run, so an array `verifyStatus` can vary the
    // response by call order (fail-then-succeed retry proof).
    let verifyCount = 0;
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body,
      });
      // User v2 search (resolveUserId) — a POST to /v2/users carrying `queries`.
      if (url.endsWith("/v2/users") && init.method === "POST") {
        const uid = opts.userId === undefined ? "otp-user-1" : opts.userId;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ result: uid ? [{ userId: uid }] : [] }),
        });
      }
      // OTP factor registration — POST /v2/users/{id}/otp_email|otp_sms (#153).
      // The challenge presupposes the factor; we register it (idempotent) before
      // the create hop. A 201 here = freshly registered.
      if (
        /\/v2\/users\/[^/]+\/otp_(email|sms)$/.test(url) &&
        init.method === "POST"
      ) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({}),
        });
      }
      // Session verify hop — PATCH /v2/sessions/{id} (has a path segment after).
      if (/\/v2\/sessions\/[^/]+$/.test(url) && init.method === "PATCH") {
        const scripted = opts.verifyStatus;
        const status = Array.isArray(scripted)
          ? (scripted[verifyCount] ?? scripted[scripted.length - 1] ?? 200)
          : (scripted ?? 200);
        verifyCount++;
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () =>
            Promise.resolve({
              sessionToken: opts.verifiedToken ?? "checked-token",
            }),
        });
      }
      // Session create-with-challenge — POST /v2/sessions (no path segment).
      if (url.endsWith("/v2/sessions") && init.method === "POST") {
        const status = opts.createStatus ?? 201;
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () =>
            Promise.resolve({
              sessionId: "otp-sess-1",
              sessionToken: "unchecked-token",
            }),
        });
      }
      // OIDC exchange hops (same shapes as the exchange double above).
      if (url.includes("/oauth/v2/authorize")) {
        return Promise.resolve({
          ok: false,
          status: 302,
          headers: { location: `/ui/login/login?authRequestID=AR-otp` },
          json: () => Promise.resolve({}),
        });
      }
      if (url.includes("/v2/oidc/auth_requests/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              callbackUrl: "http://app/callback?code=OTP_CODE&state=xyz",
            }),
        });
      }
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

  it("EARS-6: requestEmailOtp creates a session with the user check + otpEmail challenge and caches it", async () => {
    const { fetchImpl, calls } = otpFetch({ userId: "otp-user-1" });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });

    await expect(
      client.requestEmailOtp("Doc@ds.test"),
    ).resolves.toBeUndefined();

    // #153 live delta: the email OTP factor is registered before the challenge
    // (else Zitadel rejects the challenge with COMMAND-JKLJ3 "OTP isn't ready").
    const factor = calls.find(
      (c) =>
        /\/v2\/users\/otp-user-1\/otp_email$/.test(c.url) &&
        c.method === "POST",
    );
    expect(factor, "the otp_email factor was registered first").toBeTruthy();

    const create = calls.find(
      (c) => c.url.endsWith("/v2/sessions") && c.method === "POST",
    );
    expect(create, "a session create hop was issued").toBeTruthy();
    expect(JSON.parse(create!.body ?? "{}")).toEqual({
      checks: { user: { userId: "otp-user-1" } },
      challenges: { otpEmail: {} },
    });
  });

  it("003 EARS-6 (#878): with a portal origin configured the otpEmail challenge carries a BARE /login urlTemplate — no code/session params, no hosted-UI dead end", async () => {
    // Same #869 scanner-safety contract as the verify-email hop: Zitadel's
    // DEFAULT otpEmail send renders a hosted-login-v2 button URL with the OTP
    // code + sessionId embedded in the query (observed live on v4.15) — a
    // GET-consumable link a mail scanner burns and a dead end for portal
    // sessions. The bare portal `/login` replaces it; the mail stays CODE-ONLY.
    const { fetchImpl, calls } = otpFetch({ userId: "otp-user-1" });
    const client = new ZitadelIdpClient({
      ...BASE_CONFIG,
      portalBaseUrl: "http://portal.test:3001/",
      fetchImpl,
    });
    await client.requestEmailOtp("doc@ds.test");
    const create = calls.find(
      (c) => c.url.endsWith("/v2/sessions") && c.method === "POST",
    );
    expect(JSON.parse(create!.body ?? "{}")).toEqual({
      checks: { user: { userId: "otp-user-1" } },
      challenges: {
        otpEmail: {
          sendCode: { urlTemplate: "http://portal.test:3001/login" },
        },
      },
    });
    const body = create!.body ?? "";
    expect(body).not.toContain("{{.Code}}");
    expect(body).not.toContain("{{.OTP}}");
  });

  it("003 EARS-7 (#878): the otpSms challenge stays a bare {} even with a portal origin configured — the SMS hop has no urlTemplate", async () => {
    const { fetchImpl, calls } = otpFetch({ userId: "otp-user-1" });
    const client = new ZitadelIdpClient({
      ...BASE_CONFIG,
      portalBaseUrl: "http://portal.test:3001",
      fetchImpl,
    });
    await client.requestSmsOtp("+15551230000");
    const create = calls.find(
      (c) => c.url.endsWith("/v2/sessions") && c.method === "POST",
    );
    expect(JSON.parse(create!.body ?? "{}")).toEqual({
      checks: { user: { userId: "otp-user-1" } },
      challenges: { otpSms: {} },
    });
  });

  it("EARS-7: requestSmsOtp uses the otpSms challenge", async () => {
    const { fetchImpl, calls } = otpFetch({ userId: "otp-user-1" });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    await client.requestSmsOtp("+15551230000");
    const factor = calls.find(
      (c) =>
        /\/v2\/users\/otp-user-1\/otp_sms$/.test(c.url) && c.method === "POST",
    );
    expect(factor, "the otp_sms factor was registered first").toBeTruthy();
    const create = calls.find(
      (c) => c.url.endsWith("/v2/sessions") && c.method === "POST",
    );
    expect(JSON.parse(create!.body ?? "{}")).toEqual({
      checks: { user: { userId: "otp-user-1" } },
      challenges: { otpSms: {} },
    });
  });

  it("EARS-6/16: an unknown identifier sends NOTHING and still resolves void", async () => {
    const { fetchImpl, calls } = otpFetch({ userId: null });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    await expect(
      client.requestEmailOtp("nobody@ds.test"),
    ).resolves.toBeUndefined();
    // Only the User v2 search ran; no session was created (enumeration-safe).
    expect(calls.some((c) => c.url.endsWith("/v2/sessions"))).toBe(false);
  });

  it("EARS-6/16: a provider hiccup on the request hop still resolves void (no throw)", async () => {
    // The session-create hop 500s — must be swallowed exactly like the unknown
    // identifier so the acknowledgement is not a health/existence oracle.
    const { fetchImpl } = otpFetch({ userId: "otp-user-1", createStatus: 500 });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    await expect(
      client.requestEmailOtp("doc@ds.test"),
    ).resolves.toBeUndefined();
  });

  it("EARS-6/16: a thrown fetch on the request hop still resolves void", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.reject(new Error("network down"));
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    await expect(
      client.requestEmailOtp("doc@ds.test"),
    ).resolves.toBeUndefined();
  });

  it("EARS-6: loginWithEmailOtp verifies the code, threads the checked-session token on the handle, then exchange yields tokens", async () => {
    const { fetchImpl, calls } = otpFetch({
      userId: "otp-user-1",
      verifiedToken: "checked-token-1",
      token: {
        ok: true,
        status: 200,
        body: {
          access_token: "ACCESS",
          refresh_token: "REFRESH",
          expires_in: 900,
          id_token: jwt({ sub: "otp-user-1", amr: ["otp"] }),
        },
      },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });

    await client.requestEmailOtp("doc@ds.test");
    const session = await client.loginWithEmailOtp("Doc@ds.test", "123456");
    // #143: the checked session carries the fresh verify token on the handle.
    expect(session).toEqual({
      zitadelSessionId: "otp-sess-1",
      sub: "otp-user-1",
      sessionToken: "checked-token-1",
    });

    // The verify hop hit /v2/sessions/{id} with the unchecked token + the otpEmail
    // code. #153 live delta: the session update is a PATCH (a POST 405s live).
    const verify = calls.find((c) => /\/v2\/sessions\/otp-sess-1$/.test(c.url));
    expect(verify, "a session verify hop was issued").toBeTruthy();
    expect(verify!.method, "session update verb is PATCH (#153)").toBe("PATCH");
    expect(JSON.parse(verify!.body ?? "{}")).toEqual({
      sessionToken: "unchecked-token",
      checks: { otpEmail: { code: "123456" } },
    });

    // End-to-end linchpin (#143): the checked-session token rides the returned
    // handle, so the downstream OIDC exchange (which reads session.sessionToken)
    // completes and mints real tokens — no adapter-side cache.
    const tokens = await client.exchangeSessionForTokens(session!);
    expect(tokens.accessToken).toBe("ACCESS");
    expect(tokens.refreshToken).toBe("REFRESH");
    expect(tokens.claims.sub).toBe("otp-user-1");
    // Single-factor passwordless OTP is NOT mfa (design §7).
    expect(tokens.claims.mfa).toBe(false);
  });

  it("EARS-7: loginWithSmsOtp happy path verifies with the otpSms check", async () => {
    const { fetchImpl, calls } = otpFetch({
      userId: "otp-user-2",
      token: {
        ok: true,
        status: 200,
        body: {
          access_token: "A",
          refresh_token: "R",
          expires_in: 900,
          id_token: jwt({ sub: "otp-user-2", amr: ["otp"] }),
        },
      },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    await client.requestSmsOtp("+15551230000");
    const session = await client.loginWithSmsOtp("+15551230000", "654321");
    expect(session?.sub).toBe("otp-user-2");
    const verify = calls.find((c) => /\/v2\/sessions\/otp-sess-1$/.test(c.url));
    expect(JSON.parse(verify!.body ?? "{}")).toEqual({
      sessionToken: "unchecked-token",
      checks: { otpSms: { code: "654321" } },
    });
    await expect(
      client.exchangeSessionForTokens(session!),
    ).resolves.toMatchObject({ accessToken: "A" });
  });

  it("EARS-16: login with no prior challenge for the identifier returns null", async () => {
    const { fetchImpl, calls } = otpFetch({ userId: "otp-user-1" });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    // No requestEmailOtp first → no cached challenge.
    const session = await client.loginWithEmailOtp("doc@ds.test", "123456");
    expect(session).toBeNull();
    // Nothing was even sent (the miss is decided from the cache, no verify hop).
    expect(calls.some((c) => /\/v2\/sessions\/[^/]+$/.test(c.url))).toBe(false);
  });

  it("EARS-16: a wrong/expired code (non-2xx on verify) returns null", async () => {
    const { fetchImpl } = otpFetch({ userId: "otp-user-1", verifyStatus: 403 });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    await client.requestEmailOtp("doc@ds.test");
    expect(await client.loginWithEmailOtp("doc@ds.test", "000000")).toBeNull();
  });

  it("EARS-15: a failed verify KEEPS the challenge so the user retries the same delivered code (parity with the fake; Zitadel owns the attempt-limit, no SMS re-burn)", async () => {
    // First verify 403s (wrong/expired code), the retry 200s — the cached
    // challenge must survive the failure so the SAME Zitadel session accepts the
    // correct code WITHOUT a fresh `request*Otp` (which would burn the EARS-14 SMS
    // budget). Mirrors `FakeIdpClient.loginWithEmailOtp`, which leaves the
    // challenge armed on a wrong code and only deletes it on success.
    const { fetchImpl, calls } = otpFetch({
      userId: "otp-user-1",
      verifyStatus: [403, 200],
      verifiedToken: "checked-token-retry",
      token: {
        ok: true,
        status: 200,
        body: {
          access_token: "ACCESS",
          refresh_token: "REFRESH",
          expires_in: 900,
          id_token: jwt({ sub: "otp-user-1", amr: ["otp"] }),
        },
      },
    });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });

    await client.requestEmailOtp("doc@ds.test");
    // Wrong code → null, but the challenge stays armed (no re-request).
    expect(await client.loginWithEmailOtp("doc@ds.test", "000000")).toBeNull();
    // Exactly one session-create (request) hop ran — the failed verify did NOT
    // force a new `request*Otp` / `POST /v2/sessions`.
    expect(
      calls.filter((c) => c.url.endsWith("/v2/sessions") && c.method === "POST")
        .length,
    ).toBe(1);
    // The retry with the correct code verifies against the SAME session and wins.
    const session = await client.loginWithEmailOtp("doc@ds.test", "123456");
    expect(session).toEqual({
      zitadelSessionId: "otp-sess-1",
      sub: "otp-user-1",
      sessionToken: "checked-token-retry",
    });
    // Both verify hops hit the same cached session id.
    const verifyHops = calls.filter((c) =>
      /\/v2\/sessions\/otp-sess-1$/.test(c.url),
    );
    expect(verifyHops).toHaveLength(2);
    // The retried checked-session token (on the handle) feeds the OIDC exchange.
    const tokens = await client.exchangeSessionForTokens(session!);
    expect(tokens.accessToken).toBe("ACCESS");
  });

  it("EARS-6: a SUCCESSFUL verify consumes the challenge (single-use) — a second correct attempt is null", async () => {
    const { fetchImpl } = otpFetch({ userId: "otp-user-1" });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    await client.requestEmailOtp("doc@ds.test");
    // First correct code succeeds and deletes the challenge.
    expect(await client.loginWithEmailOtp("doc@ds.test", "123456")).toEqual({
      zitadelSessionId: "otp-sess-1",
      sub: "otp-user-1",
      sessionToken: "checked-token",
    });
    // The challenge was consumed on success → a second attempt finds nothing.
    expect(await client.loginWithEmailOtp("doc@ds.test", "123456")).toBeNull();
  });

  it("EARS-16: login for an unknown identifier (nothing armed) returns null", async () => {
    const { fetchImpl } = otpFetch({ userId: null });
    const client = new ZitadelIdpClient({ ...BASE_CONFIG, fetchImpl });
    await client.requestEmailOtp("nobody@ds.test"); // arms nothing
    expect(
      await client.loginWithEmailOtp("nobody@ds.test", "123456"),
    ).toBeNull();
  });

  it("#410: a challenge armed on instance A is verified on instance B through the SHARED store (scale-out proof)", async () => {
    // The Issue's core AC: request #1 and request #2 are two distinct HTTP
    // requests with no instance affinity — with the challenge in a shared
    // store, the verify hop must succeed on a DIFFERENT ZitadelIdpClient
    // instance than the one that armed it.
    const { fetchImpl, calls } = otpFetch({
      userId: "otp-user-1",
      verifiedToken: "checked-token-b",
    });
    const sharedStore = new InMemoryOtpChallengeStore();
    const instanceA = new ZitadelIdpClient(
      { ...BASE_CONFIG, fetchImpl },
      sharedStore,
    );
    const instanceB = new ZitadelIdpClient(
      { ...BASE_CONFIG, fetchImpl },
      sharedStore,
    );

    await instanceA.requestEmailOtp("Doc@ds.test");
    // Instance B never saw the request hop — only the shared store bridges it.
    const session = await instanceB.loginWithEmailOtp("doc@ds.test", "123456");
    expect(session).toEqual({
      zitadelSessionId: "otp-sess-1",
      sub: "otp-user-1",
      sessionToken: "checked-token-b",
    });
    // B verified against the exact Zitadel session A armed (same session id,
    // presenting A's unchecked token).
    const verify = calls.find((c) => /\/v2\/sessions\/otp-sess-1$/.test(c.url));
    expect(JSON.parse(verify!.body ?? "{}")).toEqual({
      sessionToken: "unchecked-token",
      checks: { otpEmail: { code: "123456" } },
    });
    // Consumed on success in the SHARED store: a replay on instance A misses too.
    expect(
      await instanceA.loginWithEmailOtp("doc@ds.test", "123456"),
    ).toBeNull();
  });

  it("#410/EARS-16: a store miss and a Zitadel-rejected code are the SAME generic null — no oracle distinguishing them", async () => {
    const { fetchImpl } = otpFetch({ userId: "otp-user-1", verifyStatus: 403 });
    // Store miss: nothing armed in this (empty) shared store.
    const missClient = new ZitadelIdpClient(
      { ...BASE_CONFIG, fetchImpl },
      new InMemoryOtpChallengeStore(),
    );
    const missResult = await missClient.loginWithEmailOtp(
      "doc@ds.test",
      "123456",
    );
    // Zitadel reject: challenge armed, verify hop 403s (wrong/expired code).
    const rejectClient = new ZitadelIdpClient(
      { ...BASE_CONFIG, fetchImpl },
      new InMemoryOtpChallengeStore(),
    );
    await rejectClient.requestEmailOtp("doc@ds.test");
    const rejectResult = await rejectClient.loginWithEmailOtp(
      "doc@ds.test",
      "123456",
    );
    // Both fall through to the identical generic failure value.
    expect(missResult).toBeNull();
    expect(rejectResult).toBeNull();
    expect(missResult).toStrictEqual(rejectResult);
  });
});

/**
 * #157/#203 — `grantProjectRole` migrated to the CURRENT resource API, the v2
 * **AuthorizationService.CreateAuthorization** ("Role Assignment"), which
 * REPLACES the deprecated management-v1 user-grant `POST
 * /management/v1/users/{sub}/grants`. The OIDC token's
 * `urn:zitadel:iam:org:project:roles` claim is asserted only for granted roles,
 * so without this assignment a registered user's token carries empty roles and
 * the `doctor_guest`-requiring guard 403s. The assignment must be idempotent (the
 * webhook + reconcile sweep re-grant): an ALREADY_EXISTS / 409 is SUCCESS; any
 * other non-2xx is a real failure and throws. Absent `projectId` fails closed.
 *
 * #203 wire deltas (proven live, v4.15 dev-stand):
 *   • URL = the GA connect-RPC path
 *     `POST /zitadel.authorization.v2.AuthorizationService/CreateAuthorization`
 *     (the `/v2/authorizations` REST alias is not served by v4.15.0 — it 404s).
 *   • body = `{ userId, projectId, organizationId, roleKeys }` — the v2 RPC
 *     requires `organizationId` (resolved via orgs/me when not configured), which
 *     the v1 grant inferred from the token.
 */
describe("ZitadelIdpClient grantProjectRole → v2 CreateAuthorization (#157/#203)", () => {
  /** A fetch double answering the orgs/me hop + the CreateAuthorization hop. */
  function grantFetch(result: {
    ok: boolean;
    status: number;
    body?: unknown;
  }): {
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
      if (url.endsWith("/management/v1/orgs/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ org: { id: "org-resolved" } }),
        });
      }
      return Promise.resolve({
        ok: result.ok,
        status: result.status,
        json: () => Promise.resolve(result.body ?? {}),
      });
    };
    return { fetchImpl, calls };
  }

  const AUTHZ_URL =
    "http://idp.test:9080/zitadel.authorization.v2.AuthorizationService/CreateAuthorization";

  // Org id configured ⇒ no orgs/me round-trip in these focused assertions.
  const CONFIG = {
    baseUrl: "http://idp.test:9080",
    serviceToken: "svc-token",
    projectId: "proj-1",
    orgId: "org-1",
  };

  it("POSTs the v2 CreateAuthorization RPC with userId + projectId + organizationId + roleKeys on success", async () => {
    const { fetchImpl, calls } = grantFetch({
      ok: true,
      status: 200,
      body: { id: "auth-1" },
    });
    const client = new ZitadelIdpClient({ ...CONFIG, fetchImpl });
    await expect(
      client.grantProjectRole("user-1", "doctor_guest"),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(AUTHZ_URL);
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      userId: "user-1",
      projectId: "proj-1",
      organizationId: "org-1",
      roleKeys: ["doctor_guest"],
    });
  });

  it("resolves the org from orgs/me when IDP_ORG_ID is not configured", async () => {
    const { fetchImpl, calls } = grantFetch({
      ok: true,
      status: 200,
      body: { id: "a" },
    });
    const client = new ZitadelIdpClient({
      baseUrl: "http://idp.test:9080",
      serviceToken: "svc-token",
      projectId: "proj-1",
      fetchImpl,
    });
    await expect(
      client.grantProjectRole("user-1", "doctor_guest"),
    ).resolves.toBeUndefined();
    expect(calls.some((c) => c.url.endsWith("/management/v1/orgs/me"))).toBe(
      true,
    );
    const grant = calls.find((c) => c.url === AUTHZ_URL);
    expect(JSON.parse(grant!.body ?? "{}")).toMatchObject({
      organizationId: "org-resolved",
    });
  });

  it("treats an already-existing assignment (409 ALREADY_EXISTS) as success (idempotent)", async () => {
    const { fetchImpl } = grantFetch({
      ok: false,
      status: 409,
      body: {
        code: "already_exists",
        message: "Допуск пользователя уже существует (V3-DKcYh)",
      },
    });
    const client = new ZitadelIdpClient({ ...CONFIG, fetchImpl });
    await expect(
      client.grantProjectRole("user-1", "doctor_guest"),
    ).resolves.toBeUndefined();
  });

  it("throws on any other non-2xx (a real failure surfaces loudly)", async () => {
    const { fetchImpl } = grantFetch({ ok: false, status: 500 });
    const client = new ZitadelIdpClient({ ...CONFIG, fetchImpl });
    await expect(
      client.grantProjectRole("user-1", "doctor_guest"),
    ).rejects.toThrow(/grant.*HTTP 500/i);
  });

  it("fails closed when projectId is not configured", async () => {
    const { fetchImpl, calls } = grantFetch({ ok: true, status: 200 });
    const client = new ZitadelIdpClient({
      baseUrl: "http://idp.test:9080",
      serviceToken: "svc-token",
      orgId: "org-1",
      fetchImpl,
    });
    await expect(
      client.grantProjectRole("user-1", "doctor_guest"),
    ).rejects.toThrow(/project/i);
    // Nothing was sent — the fail-closed gate is before the HTTP hop.
    expect(calls).toHaveLength(0);
  });
});
