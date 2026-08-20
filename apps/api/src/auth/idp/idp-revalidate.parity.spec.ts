import { describe, expect, it } from "vitest";
import { FakeIdpClient } from "./idp.fake.js";
import type { AdminAuthorityVerdict, IdpClient } from "./idp.types.js";
import type { FetchLike } from "./zitadel.idp.js";
import { ZitadelIdpClient } from "./zitadel.idp.js";

/**
 * #1304 — `revalidateAdminAuthority` port parity.
 *
 * One table of scenarios run against BOTH bindings: the strict fake the suite
 * uses everywhere, and the real `ZitadelIdpClient` over a scripted `fetch`. The
 * point is the recorded project rule "the fake is no more permissive than the
 * real adapter": each scenario states the verdict ONCE and each port is driven
 * into that situation in its own idiom — the fake by shaping its in-memory
 * session/account/grant state, the adapter by scripting the three HTTP hops.
 *
 * The `unavailable` row carries the load-bearing property of the whole method:
 * a provider fault must NOT arrive as a credential denial. The fake reaches it
 * only through `setRevalidationUnavailable` (an in-memory double cannot produce
 * a 5xx), the adapter through a real refused response — and both must land on
 * the same outcome, or a Zitadel blip would be a mass 401 in production while
 * every fake-backed test stayed green.
 */

const PROJECT_ID = "project-1";
const SUB = "user-1";
const SESSION_ID = "sess-1";
const ADMIN_EMAIL = "admin@ds.test";
const ADMIN_PASSWORD = "pw-12345678";

/** The three service-authenticated hops the real adapter makes, in order. */
interface AdapterScript {
  session?: { ok: boolean; status: number; body: unknown };
  users?: { ok: boolean; status: number; body: unknown };
  grants?: { ok: boolean; status: number; body: unknown };
}

function adapterFor(script: AdapterScript): ZitadelIdpClient {
  const respond = (r: { ok: boolean; status: number; body: unknown }) =>
    Promise.resolve({
      ok: r.ok,
      status: r.status,
      headers: {},
      json: () => Promise.resolve(r.body),
    });
  const fetchImpl: FetchLike = (url) => {
    if (url.includes("/v2/sessions/")) {
      return respond(
        script.session ?? {
          ok: true,
          status: 200,
          body: { session: { factors: { user: { id: SUB } } } },
        },
      );
    }
    if (url.includes("/v2/users")) {
      return respond(
        script.users ?? {
          ok: true,
          status: 200,
          body: { result: [{ userId: SUB, state: "USER_STATE_ACTIVE" }] },
        },
      );
    }
    if (url.includes("/users/grants/_search")) {
      return respond(
        script.grants ?? {
          ok: true,
          status: 200,
          body: {
            result: [{ projectId: PROJECT_ID, roleKeys: ["platform_admin"] }],
          },
        },
      );
    }
    return Promise.reject(new Error(`unscripted call: ${url}`));
  };
  return new ZitadelIdpClient({
    baseUrl: "https://idp.test",
    serviceToken: "service-token",
    projectId: PROJECT_ID,
    // Set explicitly so the adapter never makes the `orgs/me` hop — this spec is
    // about the revalidation reads, not about org resolution.
    orgId: "org-1",
    fetchImpl,
  });
}

interface Scenario {
  name: string;
  expected: (verdict: AdminAuthorityVerdict) => void;
  script: AdapterScript;
}

describe("#1304 revalidateAdminAuthority — fake/real port parity", () => {
  /**
   * Establish the baseline both ports agree on: a live session bound to `sub`,
   * an active account, and a live `platform_admin` grant. Each scenario then
   * breaks exactly one of those three.
   */
  async function fakeWithSession(): Promise<{
    idp: FakeIdpClient;
    sub: string;
    sessionId: string;
  }> {
    const fake = new FakeIdpClient();
    const created = await fake.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    const login = await fake.passwordLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(login.outcome, "the fake must mint a checked session").toBe(
      "authenticated",
    );
    const sessionId =
      login.outcome === "authenticated" ? login.session.zitadelSessionId : "";
    await fake.grantProjectRole(created.sub, "platform_admin");
    return { idp: fake, sub: created.sub, sessionId };
  }

  const scenarios: Scenario[] = [
    {
      name: "active — live session, active account, live grant",
      expected: (v) => {
        expect(v.outcome).toBe("active");
        if (v.outcome === "active") {
          expect(v.roles).toContain("platform_admin");
        }
      },
      script: {},
    },
    {
      name: "inactive — the wrapped session is gone (force-logout, expiry)",
      expected: (v) => {
        expect(v.outcome).toBe("inactive");
        if (v.outcome === "inactive") expect(v.reason).toBe("session_gone");
      },
      script: { session: { ok: false, status: 404, body: {} } },
    },
    {
      name: "inactive — the account behind the session was deactivated",
      expected: (v) => {
        expect(v.outcome).toBe("inactive");
        if (v.outcome === "inactive") expect(v.reason).toBe("account_inactive");
      },
      script: {
        users: {
          ok: true,
          status: 200,
          body: { result: [{ userId: SUB, state: "USER_STATE_INACTIVE" }] },
        },
      },
    },
    {
      name: "role_revoked — session fine, the project-role grant is gone",
      expected: (v) => {
        expect(v.outcome).toBe("role_revoked");
        if (v.outcome === "role_revoked") {
          expect(v.roles).not.toContain("platform_admin");
        }
      },
      script: {
        grants: {
          ok: true,
          status: 200,
          body: { result: [{ projectId: PROJECT_ID, roleKeys: ["viewer"] }] },
        },
      },
    },
    {
      name: "unavailable — a provider fault is never a credential denial",
      expected: (v) => {
        expect(v.outcome).toBe("unavailable");
      },
      // A 503 on the session read: NOT a 404, so it says nothing about whether
      // the credential still stands.
      script: { session: { ok: false, status: 503, body: {} } },
    },
  ];

  describe("real adapter (ZitadelIdpClient over a scripted fetch)", () => {
    for (const scenario of scenarios) {
      it(`#1304: ${scenario.name}`, async () => {
        const idp: IdpClient = adapterFor(scenario.script);
        const verdict = await idp.revalidateAdminAuthority({
          zitadelSessionId: SESSION_ID,
          sub: SUB,
          requiredRole: "platform_admin",
        });
        scenario.expected(verdict);
      });
    }
  });

  describe("strict fake (FakeIdpClient over its own state)", () => {
    it("#1304: active — live session, active account, live grant", async () => {
      const { idp, sub, sessionId } = await fakeWithSession();
      const verdict = await idp.revalidateAdminAuthority({
        zitadelSessionId: sessionId,
        sub,
        requiredRole: "platform_admin",
      });
      expect(verdict.outcome).toBe("active");
      if (verdict.outcome === "active") {
        expect(verdict.roles).toContain("platform_admin");
      }
    });

    it("#1304: inactive — the wrapped session is gone (force-logout, expiry)", async () => {
      const { idp, sub, sessionId } = await fakeWithSession();
      await idp.terminateSession({ zitadelSessionId: sessionId, sub });
      const verdict = await idp.revalidateAdminAuthority({
        zitadelSessionId: sessionId,
        sub,
        requiredRole: "platform_admin",
      });
      expect(verdict).toEqual({ outcome: "inactive", reason: "session_gone" });
    });

    it("#1304: inactive — the session belongs to another subject", async () => {
      const { idp, sessionId } = await fakeWithSession();
      const verdict = await idp.revalidateAdminAuthority({
        zitadelSessionId: sessionId,
        sub: "someone-else",
        requiredRole: "platform_admin",
      });
      expect(verdict).toEqual({
        outcome: "inactive",
        reason: "session_subject_mismatch",
      });
    });

    it("#1304: inactive — the account behind the session was deactivated", async () => {
      const { idp, sub, sessionId } = await fakeWithSession();
      idp.setActive(sub, false);
      const verdict = await idp.revalidateAdminAuthority({
        zitadelSessionId: sessionId,
        sub,
        requiredRole: "platform_admin",
      });
      expect(verdict).toEqual({
        outcome: "inactive",
        reason: "account_inactive",
      });
    });

    it("#1304: role_revoked — session fine, the project-role grant is gone", async () => {
      const { idp, sub, sessionId } = await fakeWithSession();
      await idp.revokeProjectRole(sub, "platform_admin");
      const verdict = await idp.revalidateAdminAuthority({
        zitadelSessionId: sessionId,
        sub,
        requiredRole: "platform_admin",
      });
      expect(verdict.outcome).toBe("role_revoked");
      if (verdict.outcome === "role_revoked") {
        expect(verdict.roles).not.toContain("platform_admin");
      }
    });

    it("#1304: role_revoked — pd_officer is asked about independently of platform_admin", async () => {
      const { idp, sub, sessionId } = await fakeWithSession();
      // Holding platform_admin is not holding pd_officer: an ADR-0009 approval
      // route must not be satisfied by the broader admin grant.
      const verdict = await idp.revalidateAdminAuthority({
        zitadelSessionId: sessionId,
        sub,
        requiredRole: "pd_officer",
      });
      expect(verdict.outcome).toBe("role_revoked");
    });

    it("#1304: unavailable — a provider fault is never a credential denial", async () => {
      const { idp, sub, sessionId } = await fakeWithSession();
      idp.setRevalidationUnavailable("scripted outage");
      const verdict = await idp.revalidateAdminAuthority({
        zitadelSessionId: sessionId,
        sub,
        requiredRole: "platform_admin",
      });
      expect(verdict).toEqual({
        outcome: "unavailable",
        reason: "scripted outage",
      });
      // And the seam is reversible — it makes the fake stricter for a test, it
      // does not leave it permanently broken.
      idp.setRevalidationUnavailable(null);
      const restored = await idp.revalidateAdminAuthority({
        zitadelSessionId: sessionId,
        sub,
        requiredRole: "platform_admin",
      });
      expect(restored.outcome).toBe("active");
    });

    it("#1304: an unknown session is refused, exactly as the real adapter refuses a 404", async () => {
      const { idp, sub } = await fakeWithSession();
      const verdict = await idp.revalidateAdminAuthority({
        zitadelSessionId: "never-existed",
        sub,
        requiredRole: "platform_admin",
      });
      expect(verdict).toEqual({ outcome: "inactive", reason: "session_gone" });
    });
  });

  describe("the real adapter folds EVERY fault class into `unavailable`", () => {
    const faults: Array<{ name: string; script: AdapterScript }> = [
      {
        name: "429 on the session read",
        script: { session: { ok: false, status: 429, body: {} } },
      },
      {
        name: "401 on the SERVICE token (not the user's credential)",
        script: { session: { ok: false, status: 401, body: {} } },
      },
      {
        name: "5xx on the account read",
        script: { users: { ok: false, status: 502, body: {} } },
      },
      {
        name: "5xx on the grant read",
        script: { grants: { ok: false, status: 500, body: {} } },
      },
      {
        name: "malformed session payload (200 naming no checked user)",
        script: { session: { ok: true, status: 200, body: { session: {} } } },
      },
    ];
    for (const fault of faults) {
      it(`#1304: ${fault.name} → unavailable, never a denial`, async () => {
        const verdict = await adapterFor(
          fault.script,
        ).revalidateAdminAuthority({
          zitadelSessionId: SESSION_ID,
          sub: SUB,
          requiredRole: "platform_admin",
        });
        expect(verdict.outcome).toBe("unavailable");
      });
    }

    it("#1304: a transport error (no response at all) → unavailable", async () => {
      const idp = new ZitadelIdpClient({
        baseUrl: "https://idp.test",
        serviceToken: "service-token",
        projectId: PROJECT_ID,
        orgId: "org-1",
        fetchImpl: () => Promise.reject(new Error("ECONNREFUSED")),
      });
      const verdict = await idp.revalidateAdminAuthority({
        zitadelSessionId: SESSION_ID,
        sub: SUB,
        requiredRole: "platform_admin",
      });
      expect(verdict.outcome).toBe("unavailable");
    });

    it("#1304: an expired session is inactive even on a readable 200", async () => {
      const verdict = await adapterFor({
        session: {
          ok: true,
          status: 200,
          body: {
            session: {
              factors: { user: { id: SUB } },
              expirationDate: new Date(Date.now() - 60_000).toISOString(),
            },
          },
        },
      }).revalidateAdminAuthority({
        zitadelSessionId: SESSION_ID,
        sub: SUB,
        requiredRole: "platform_admin",
      });
      expect(verdict).toEqual({ outcome: "inactive", reason: "session_gone" });
    });

    it("#1304: a session bound to another subject is inactive, not role_revoked", async () => {
      const verdict = await adapterFor({
        session: {
          ok: true,
          status: 200,
          body: { session: { factors: { user: { id: "another-user" } } } },
        },
      }).revalidateAdminAuthority({
        zitadelSessionId: SESSION_ID,
        sub: SUB,
        requiredRole: "platform_admin",
      });
      expect(verdict).toEqual({
        outcome: "inactive",
        reason: "session_subject_mismatch",
      });
    });
  });
});
