import { describe, expect, it } from "vitest";
import { FakeIdpClient } from "../idp/idp.fake.js";
import type { IdpSession } from "../idp/idp.types.js";
import { InMemorySessionStore } from "./session-store.fake.js";
import { InMemoryAuthAuditLog } from "./auth-audit.fake.js";
import { SessionService } from "./session.service.js";
import {
  SharedSessionHub,
  type LinkedSessionRefresher,
} from "./shared-session.js";
import { SubjectRevocationHub } from "./subject-revocation.js";
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
/**
 * A storefront session minted the production way — the linked redeem over the
 * checked Zitadel session's OIDC tokens; its `sid` and claims.
 */
async function mintFor(
  svc: SessionService,
  idp: FakeIdpClient,
  session: IdpSession,
  fingerprint: string,
): Promise<{ sid: string; sub: string }> {
  const tokens = await idp.exchangeSessionForTokens(session);
  const { cookie, claims } = await svc.mintLinked({
    zitadelSessionId: session.zitadelSessionId,
    client: "academy",
    claims: tokens.claims,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    fingerprint,
    expiresAtMs: Date.now() + 3600_000,
  });
  return {
    sid: parseCookies(cookie)[SESSION_COOKIE_NAME] as string,
    sub: claims.sub,
  };
}

/**
 * The storefront client's refresh grant as Zitadel answers it: each token is
 * single use — a presented token rotates to a fresh pair, and presenting a
 * spent one is refused as reuse (`invalid_grant`, RFC 6819).
 */
function rotatingRefresher(): LinkedSessionRefresher {
  const spent = new Set<string>();
  let seq = 0;
  return {
    refreshLinked: (_client, refreshToken) => {
      if (spent.has(refreshToken))
        return Promise.resolve({ reuseDetected: true });
      spent.add(refreshToken);
      seq += 1;
      return Promise.resolve({
        reuseDetected: false,
        tokens: { accessToken: `at-${seq}`, refreshToken: `rt-${seq}` },
      });
    },
  };
}

describe("SessionService — refresh rotation + logout", () => {
  const FP = "fp-device-1";

  /**
   * A fresh service over fakes, plus a linked session's `sid` — its refresh
   * rotates through the storefront client the hub's refresher stands for.
   */
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
    if (login.outcome !== "authenticated")
      throw new Error("login setup failed");
    const store = new InMemorySessionStore();
    const audit = new InMemoryAuthAuditLog();
    const shared = new SharedSessionHub();
    shared.registerRefresher(rotatingRefresher());
    const svc = new SessionService(
      store,
      audit,
      new SubjectRevocationHub(),
      shared,
    );
    const { sid, sub } = await mintFor(svc, idp, login.session, FP);
    return { svc, store, audit, sid, sub };
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
    const svc = new SessionService(store, audit);

    async function establishFor(email: string): Promise<string> {
      const s = await idp.passwordLogin(email, "pw-12345678");
      if (s.outcome !== "authenticated") throw new Error("login setup failed");
      return (await mintFor(svc, idp, s.session, FP)).sid;
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
    expect(audit.events).toContainEqual({
      type: "PasswordResetCompleted",
      sub,
    });
  });
});

// 003 EARS-12 / EARS-41 — both «every session of this subject ends» paths run
// through the one revocation hook, so another session holder (the sign-in
// host's records) can never be skipped by one of them.
describe("SessionService — subject revocation hook", () => {
  it("EARS-12: a completed reset and a first verification each revoke every registered holder", async () => {
    const hub = new SubjectRevocationHub();
    const revoked: string[] = [];
    hub.register({
      revokeSubject: (sub) => {
        revoked.push(sub);
        return Promise.resolve();
      },
    });
    const svc = new SessionService(
      new InMemorySessionStore(),
      new InMemoryAuthAuditLog(),
      hub,
    );
    await svc.revokeAllForSub("sub-reset");
    await svc.revokeAllBeforeVerification("sub-verify");
    expect(revoked).toEqual(["sub-reset", "sub-verify"]);
  });

  it("EARS-12: a holder that fails fails the revocation (no session minted over it)", async () => {
    const hub = new SubjectRevocationHub();
    hub.register({ revokeSubject: () => Promise.reject(new Error("down")) });
    const svc = new SessionService(
      new InMemorySessionStore(),
      new InMemoryAuthAuditLog(),
      hub,
    );
    await expect(svc.revokeAllForSub("sub")).rejects.toThrow("down");
  });

  it("EARS-65: refresh-token reuse detected on a linked session revokes the whole linked set on both storefronts", async () => {
    const store = new InMemorySessionStore();
    const audit = new InMemoryAuthAuditLog();
    const shared = new SharedSessionHub();
    shared.registerRefresher({
      refreshLinked: () => Promise.resolve({ reuseDetected: true }),
    });
    const svc = new SessionService(
      store,
      audit,
      new SubjectRevocationHub(),
      shared,
    );
    const claims = { sub: "sub-linked", roles: ["doctor_guest"], mfa: false };
    const mint = async (
      client: "academy" | "doctor",
      zitadelSessionId: string,
    ) =>
      parseCookies(
        (
          await svc.mintLinked({
            zitadelSessionId,
            client,
            claims,
            accessToken: "at",
            refreshToken: `rt-${client}-${zitadelSessionId}`,
            fingerprint: "fp-device-1",
            expiresAtMs: Date.now() + 3600_000,
          })
        ).cookie,
      )[SESSION_COOKIE_NAME] as string;
    const academy = await mint("academy", "zs-1");
    const doctor = await mint("doctor", "zs-1");
    const otherBrowser = await mint("doctor", "zs-2");

    expect((await svc.refresh(academy)).status).toBe("reuse_detected");

    expect(await store.get(academy)).toBeUndefined();
    expect(await store.get(doctor)).toBeUndefined();
    expect(await store.get(otherBrowser)).toBeDefined();
    expect(audit.events).toContainEqual({
      type: "RefreshReuseDetected",
      sub: "sub-linked",
      sid: academy,
    });
    expect(audit.events).toContainEqual({
      type: "SessionRevoked",
      sub: "sub-linked",
      sid: doctor,
      reason: "theft_detected",
    });
  });

  it("EARS-65: a refused linked refresh that is not reuse (an IdP outage, a locked user) ends only the presenting session and records no reuse", async () => {
    const store = new InMemorySessionStore();
    const audit = new InMemoryAuthAuditLog();
    const shared = new SharedSessionHub();
    shared.registerRefresher({
      refreshLinked: () =>
        Promise.resolve({ reuseDetected: false, failed: true }),
    });
    const svc = new SessionService(
      store,
      audit,
      new SubjectRevocationHub(),
      shared,
    );
    const claims = { sub: "sub-linked", roles: ["doctor_guest"], mfa: false };
    const mint = async (client: "academy" | "doctor") =>
      parseCookies(
        (
          await svc.mintLinked({
            zitadelSessionId: "zs-1",
            client,
            claims,
            accessToken: "at",
            refreshToken: `rt-${client}`,
            fingerprint: "fp-device-1",
            expiresAtMs: Date.now() + 3600_000,
          })
        ).cookie,
      )[SESSION_COOKIE_NAME] as string;
    const academy = await mint("academy");
    const doctor = await mint("doctor");

    expect((await svc.refresh(academy)).status).toBe("refresh_failed");

    expect(await store.get(academy)).toBeUndefined();
    expect(await store.get(doctor)).toBeDefined();
    expect(audit.events.map((e) => e.type)).not.toContain(
      "RefreshReuseDetected",
    );
    expect(audit.events).toContainEqual({
      type: "SessionRevoked",
      sub: "sub-linked",
      sid: academy,
      reason: "force",
    });
  });
});

// 003 EARS-8 (amended) / EARS-69 — the storefront callback's linked redeem is
// the one way a storefront session comes to be: the service keeps no second
// minting path that would hand out a session no sign-in-host record backs.
describe("SessionService — one minting path", () => {
  it("003 EARS-69: SessionService has no establish; every storefront session is minted through the linked redeem path", () => {
    expect("establish" in SessionService.prototype).toBe(false);
    expect(typeof SessionService.prototype.mintLinked).toBe("function");
  });
});

// 003 EARS-8 (amended), #3175 switch-over — the store may still hold storefront
// sessions minted before the linked redeem: with no Zitadel session id at all
// (before S4), or by the storefront's own retired forms (no storefront client).
// No sign-in-host record backs either, so every read refuses it: no subject,
// the record deleted, never refreshed, one `SessionRevoked`.
describe("SessionService — an unlinked storefront session is refused at read time", () => {
  const legacy = {
    sub: "sub-legacy",
    roles: ["doctor_guest"],
    mfa: false,
    accessToken: "at-legacy",
    refreshToken: "rt-legacy",
    fingerprint: "fp-device-1",
  };
  const unlinked = [
    ["no Zitadel session id", {}],
    ["an empty Zitadel session id", { zitadelSessionId: "" }],
    [
      "no storefront client (a retired form mint)",
      { zitadelSessionId: "zs-legacy" },
    ],
  ] as const;

  function setup(): {
    svc: SessionService;
    store: InMemorySessionStore;
    audit: InMemoryAuthAuditLog;
    refreshes: string[];
    ended: string[];
  } {
    const store = new InMemorySessionStore();
    const audit = new InMemoryAuthAuditLog();
    const shared = new SharedSessionHub();
    const refreshes: string[] = [];
    const ended: string[] = [];
    shared.registerRefresher({
      refreshLinked: (_client, refreshToken) => {
        refreshes.push(refreshToken);
        return Promise.resolve({ reuseDetected: false, failed: true });
      },
    });
    shared.register({
      endSharedSession: (_sub, zitadelSessionId) => {
        ended.push(zitadelSessionId);
        return Promise.resolve();
      },
    });
    const svc = new SessionService(
      store,
      audit,
      new SubjectRevocationHub(),
      shared,
    );
    return { svc, store, audit, refreshes, ended };
  }

  async function seed(
    store: InMemorySessionStore,
    shape: { zitadelSessionId?: string },
  ): Promise<string> {
    const sid = `legacy-${Math.random().toString(36).slice(2)}`;
    await store.create({
      sid,
      ...legacy,
      ...shape,
      expiresAtMs: Date.now() + 3600_000,
    });
    return sid;
  }

  for (const [label, shape] of unlinked) {
    it(`003 EARS-8: a session with ${label} resolves to no session, is deleted and records SessionRevoked (force)`, async () => {
      const { svc, store, audit } = setup();
      const sid = await seed(store, shape);

      expect(await svc.getBySid(sid)).toBeUndefined();

      expect(await store.get(sid)).toBeUndefined();
      expect(audit.events).toEqual([
        { type: "SessionRevoked", sub: "sub-legacy", sid, reason: "force" },
      ]);
    });

    it(`003 EARS-8: a session with ${label} is never refreshed`, async () => {
      const { svc, store, audit, refreshes } = setup();
      const sid = await seed(store, shape);

      expect(await svc.refresh(sid)).toEqual({ status: "no_session" });

      expect(refreshes).toEqual([]);
      expect(await store.get(sid)).toBeUndefined();
      expect(audit.events.map((e) => e.type)).toEqual(["SessionRevoked"]);
    });

    it(`003 EARS-8: logging out a session with ${label} deletes it, clears the cookie and ends no shared session`, async () => {
      const { svc, store, audit, ended } = setup();
      const sid = await seed(store, shape);

      const { cookie } = await svc.logout(sid);

      expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
      expect(await store.get(sid)).toBeUndefined();
      expect(ended).toEqual([]);
      expect(audit.events).toEqual([
        { type: "SessionRevoked", sub: "sub-legacy", sid },
      ]);
    });
  }

  it("003 EARS-8: a linked session still resolves", async () => {
    const { svc, store } = setup();
    const { cookie } = await svc.mintLinked({
      zitadelSessionId: "zs-live",
      client: "doctor",
      claims: { sub: "sub-linked", roles: ["doctor_guest"], mfa: false },
      accessToken: "at",
      refreshToken: "rt",
      fingerprint: "fp-device-1",
      expiresAtMs: Date.now() + 3600_000,
    });
    const sid = parseCookies(cookie)[SESSION_COOKIE_NAME] as string;

    expect((await svc.getBySid(sid))?.sub).toBe("sub-linked");
    expect(await store.get(sid)).toBeDefined();
  });
});
