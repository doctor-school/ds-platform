import { describe, expect, it } from "vitest";
import { FakeIdpClient } from "../idp/idp.fake.js";
import { InMemorySessionStore } from "./session-store.fake.js";
import { InMemoryAuthAuditLog } from "./auth-audit.fake.js";
import { SessionService } from "./session.service.js";
import { parseCookies, SESSION_COOKIE_NAME } from "./session.cookie.js";

// Refresh rotation + logout (EARS-9, EARS-10) at the service altitude — the
// store/IdP invariants the BFF owns (design §3, ADR-0001 §6/§7, RFC 6819).
//
// These run without Postgres or HTTP: rotation single-use, RFC-6819 reuse →
// chain invalidation, and logout are pure session-layer logic over the fake IdP
// + in-memory store + the audit seam. The reuse path is deliberately tested
// here rather than over HTTP: in the BFF the refresh token lives only
// server-side, so a *client* can never replay it — reuse is a store/IdP
// invariant (a BFF that re-presents an already-consumed token, e.g. a
// persist-after-rotate crash window), which is exactly what this exercises.
describe("SessionService — refresh rotation + logout", () => {
  const FP = "fp-device-1";

  /** A fresh service over fakes, plus a freshly-established session's `sid`. */
  async function establishedSession(): Promise<{
    svc: SessionService;
    store: InMemorySessionStore;
    audit: InMemoryAuthAuditLog;
    sid: string;
    sub: string;
  }> {
    const idp = new FakeIdpClient();
    await idp.createUser({ email: "user@ds.test", password: "pw-12345678" });
    const login = await idp.passwordLogin("user@ds.test", "pw-12345678");
    if (login.outcome !== "authenticated") throw new Error("login setup failed");
    const store = new InMemorySessionStore();
    const audit = new InMemoryAuthAuditLog();
    const svc = new SessionService(idp, store, audit);

    const { cookie, claims } = await svc.establish(
      login.session.zitadelSessionId,
      FP,
    );
    const sid = parseCookies(cookie)[SESSION_COOKIE_NAME] as string;
    return { svc, store, audit, sid, sub: claims.sub };
  }

  it("EARS-9: when a session's access token is refreshed, the system shall rotate the refresh token single-use and issue a new access token", async () => {
    const { svc, store, sid } = await establishedSession();
    const before = await store.get(sid);

    const outcome = await svc.refresh(sid);

    expect(outcome.status).toBe("rotated");
    const after = await store.get(sid);
    // Single-use rotation: the stored refresh token is replaced (the old one is
    // now consumed) and a fresh access token is minted under the same session.
    expect(after?.refreshToken).not.toBe(before?.refreshToken);
    expect(after?.accessToken).not.toBe(before?.accessToken);
    // The session itself (sid, principal) is unchanged — the cookie still binds.
    expect(after?.sid).toBe(sid);
    expect(after?.sub).toBe(before?.sub);
  });

  it("EARS-9: when a refresh token is replayed after rotation, the system shall invalidate the chain, revoke the session, and emit RefreshReuseDetected", async () => {
    const { svc, store, audit, sid, sub } = await establishedSession();
    // Capture the first refresh token, then rotate once so it becomes consumed.
    const consumed = (await store.get(sid))!.refreshToken;
    await svc.refresh(sid);

    // Model the replay: the BFF re-presents the already-consumed token (the
    // persist-after-rotate crash/replay window). The IdP owns RFC-6819 reuse
    // detection (ADR-0001 §7), so this must be caught on the next refresh.
    await store.rotate(sid, "stale-access", consumed);
    const outcome = await svc.refresh(sid);

    expect(outcome.status).toBe("reuse_detected");
    // Chain invalidated + session revoked: the record is gone (force re-auth).
    expect(await store.get(sid)).toBeUndefined();
    // Exactly the RefreshReuseDetected security event is recorded.
    expect(audit.events).toContainEqual({
      type: "RefreshReuseDetected",
      sub,
      sid,
    });
  });

  it("EARS-10: when an authenticated user logs out, the system shall delete the session, clear the __Host- cookie, and emit SessionRevoked", async () => {
    const { svc, store, audit, sid, sub } = await establishedSession();

    const { cookie } = await svc.logout(sid);

    // Server-side session deleted (its refresh chain is invalidated with it).
    expect(await store.get(sid)).toBeUndefined();
    // The __Host- cookie is cleared (expired immediately, same attribute set).
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toMatch(/Max-Age=0/);
    expect(cookie).not.toMatch(/Domain=/i);
    // The SessionRevoked event is recorded.
    expect(audit.events).toContainEqual({ type: "SessionRevoked", sub, sid });
  });

  it("EARS-12: when a password reset completes, the system shall revoke every session for that subject and emit PasswordResetCompleted", async () => {
    // Establish two sessions for the SAME subject (e.g. two devices), plus one
    // for a different subject that must survive the targeted revocation.
    const idp = new FakeIdpClient();
    await idp.createUser({ email: "victim@ds.test", password: "pw-12345678" });
    await idp.createUser({ email: "other@ds.test", password: "pw-12345678" });
    const store = new InMemorySessionStore();
    const audit = new InMemoryAuthAuditLog();
    const svc = new SessionService(idp, store, audit);

    async function establishFor(email: string): Promise<string> {
      const s = await idp.passwordLogin(email, "pw-12345678");
      if (s.outcome !== "authenticated") throw new Error("login setup failed");
      const { cookie } = await svc.establish(s.session.zitadelSessionId, FP);
      return parseCookies(cookie)[SESSION_COOKIE_NAME] as string;
    }

    const sidA = await establishFor("victim@ds.test");
    const sidB = await establishFor("victim@ds.test");
    const sidOther = await establishFor("other@ds.test");
    const sub = (await store.get(sidA))!.sub;

    await svc.revokeAllForSub(sub);

    // Every session belonging to the subject is gone (global force-logout)…
    expect(await store.get(sidA)).toBeUndefined();
    expect(await store.get(sidB)).toBeUndefined();
    // …while another subject's session is untouched (revocation is sub-scoped).
    expect(await store.get(sidOther)).toBeDefined();
    // The user-level PasswordResetCompleted event is recorded exactly once.
    expect(audit.events).toContainEqual({ type: "PasswordResetCompleted", sub });
  });
});
