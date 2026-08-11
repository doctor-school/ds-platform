import { randomUUID } from "node:crypto";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FakeIdpClient } from "../idp/idp.fake.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";
import { DEFAULT_RATE_LIMIT_THRESHOLDS } from "../rate-limit/rate-limit.types.js";
import { InMemoryAuthAuditLog } from "../session/auth-audit.fake.js";
import { computeFingerprint } from "../session/session.cookie.js";
import { FakeMailer } from "../../mailer/mailer.fake.js";
import { AuthzGuard } from "../../authz/authz.guard.js";
import { AUTHZ_KEY, type AuthzMeta } from "../../authz/authz.types.js";
import { AdminSessionService } from "./admin-session.service.js";
import {
  MFA_LOCKOUT_THRESHOLD,
  MfaLockoutService,
} from "./mfa-lockout.service.js";
import { resolveAdminRequest } from "./admin-session-auth.hook.js";
import {
  InMemoryAdminSessionStore,
  InMemoryPendingAuthStore,
} from "./admin-session-store.fake.js";
import { ADMIN_SESSION_COOKIE_NAME } from "./admin-session.cookie.js";
import type { AdminSessionRecord } from "./admin-session.types.js";

/**
 * 011 EARS-3 / EARS-10 at the service + hook altitude, over the fakes — the
 * invariants that HTTP cannot reach in this slice.
 *
 * Two of them exist only here by construction: `startLogin` refuses every
 * non-policy role, so no HTTP route can produce an admin session for a
 * non-`platform_admin` principal — which is exactly why the 007 role gate needs a
 * unit-level assertion (it is vacuous over HTTP today, and load-bearing the
 * moment `MFA_REQUIRED_BY_ROLE` gains its second tenant).
 */
describe("011 EARS-3/EARS-10 — admin tier refusal + role gate (unit)", () => {
  const FP = "fp-admin-device";
  const password = "Aa1!ufficiently-long-pw";
  /** The device the synthetic records below are bound to (the hook re-derives it). */
  const DEVICE: Record<string, string> = {
    "user-agent": "AdminTest/1.0",
    "accept-language": "en-US",
  };
  const DEVICE_IP = "127.0.0.1";
  const DEVICE_FP = computeFingerprint({
    userAgent: DEVICE["user-agent"],
    ip: DEVICE_IP,
    acceptLanguage: DEVICE["accept-language"],
  });

  async function serviceOverFakes(role: string | null): Promise<{
    svc: AdminSessionService;
    idp: FakeIdpClient;
    audit: InMemoryAuthAuditLog;
    store: InMemoryAdminSessionStore;
    email: string;
    sub: string;
    mailer: FakeMailer;
    lockout: MfaLockoutService;
    /** Mutable wall clock shared by the limiter + the lockout window. */
    clock: { now: number };
  }> {
    const idp = new FakeIdpClient();
    const email = `admin-${randomUUID()}@ds.test`;
    const { sub } = await idp.createUser({ email, password });
    if (role) await idp.grantProjectRole(sub, role);
    const store = new InMemoryAdminSessionStore();
    const audit = new InMemoryAuthAuditLog();
    const mailer = new FakeMailer();
    const clock = { now: Date.now() };
    const limiter = new RateLimitService(
      DEFAULT_RATE_LIMIT_THRESHOLDS,
      () => clock.now,
    );
    const lockout = new MfaLockoutService(() => clock.now);
    const svc = new AdminSessionService(
      idp,
      store,
      new InMemoryPendingAuthStore(),
      audit,
      mailer,
      limiter,
      lockout,
    );
    return { svc, idp, audit, store, email, sub, mailer, lockout, clock };
  }

  it("EARS-3: a valid-credential principal outside the policy is recorded as not_permitted, with its subject", async () => {
    // `doctor_guest` only — the credentials are VALID, the policy is not met.
    const { svc, audit, email, sub } = await serviceOverFakes("doctor_guest");

    const outcome = await svc.startLogin(email, password, FP);

    expect(outcome.status).toBe("refused");
    const failure = audit.events.find(
      (e) => e.type === "AdminPrimaryAuthFailed",
    );
    expect(failure).toBeDefined();
    // The forensic distinction the admin tier exists to produce: a stolen doctor
    // password probed at the admin origin is NOT enumeration noise, and the row
    // can name the subject the IdP already asserted. Audit-only — the caller's
    // answer is the same uniform refusal a wrong password gets.
    expect(failure).toMatchObject({ reason: "not_permitted", sub });
  });

  it("EARS-3: a wrong password stays subject-less — the pre-identity branches name nobody", async () => {
    const { svc, audit, email } = await serviceOverFakes("doctor_guest");

    const outcome = await svc.startLogin(email, "wrong-password-entirely", FP);

    expect(outcome.status).toBe("refused");
    expect(audit.events.at(-1)).toMatchObject({
      type: "AdminPrimaryAuthFailed",
      reason: "wrong_password",
      sub: null,
    });
  });

  it("EARS-3: the refused principal leaves no live IdP session behind", async () => {
    const { svc, idp, email, sub } = await serviceOverFakes("doctor_guest");
    const terminate = vi.spyOn(idp, "terminateSession");

    await svc.startLogin(email, password, FP);

    // The password check DID create a Zitadel session before the policy fork
    // refused the request it was created for — so the tier terminates it.
    expect(terminate).toHaveBeenCalledTimes(1);
    const terminated = terminate.mock.calls[0]![0];
    expect(terminated.sub).toBe(sub);
    // Fake/real parity in the strict direction: a terminated session is GONE, so
    // it can never be exchanged for tokens — the same way a deleted Zitadel
    // session fails the OIDC link at the real adapter.
    await expect(idp.exchangeSessionForTokens(terminated)).rejects.toThrow();
  });

  it("EARS-3: a policy-covered principal keeps its IdP session — the upgrade needs it", async () => {
    const { svc, idp, email } = await serviceOverFakes("platform_admin");
    const terminate = vi.spyOn(idp, "terminateSession");

    const outcome = await svc.startLogin(email, password, FP);

    expect(outcome.status).toBe("pending");
    expect(terminate).not.toHaveBeenCalled();
  });

  it("EARS-10: an admin session whose principal lacks platform_admin is refused by the role gate", async () => {
    // Synthetic record: no HTTP path can create one (startLogin refuses every
    // non-policy role), so the gate is asserted directly over the resolution the
    // hook performs plus the guard the 007 routes carry.
    const { svc, store } = await serviceOverFakes(null);
    const record: AdminSessionRecord = {
      sid: randomUUID(),
      zitadelSessionId: "zit-session-1",
      sub: "sub-moderator",
      roles: ["moderator"],
      mfa: true,
      fingerprint: DEVICE_FP,
      csrfToken: randomUUID(),
      expiresAtMs: Date.now() + 60_000,
    };
    await store.create(record);

    const resolution = await resolveAdminRequest(svc, {
      headers: {
        ...DEVICE,
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${record.sid}`,
      },
      method: "GET",
      ip: DEVICE_IP,
    });
    // It authenticates — the cookie tier is right and the fingerprint matches…
    expect("subject" in resolution).toBe(true);
    if (!("subject" in resolution)) return;

    // …and the 007 role gate still refuses it: authentication is not authority.
    const meta: AuthzMeta = {
      access: "authenticated",
      roles: ["platform_admin"],
      check: "fast-path",
      audit: "high-stakes",
      tests: ["EARS-2"],
    };
    expect(() =>
      new AuthzGuard().canActivate(ctx(meta, resolution.subject)),
    ).toThrow(ForbiddenException);
  });

  it("EARS-10: the same resolution with platform_admin passes the gate", async () => {
    const { svc, store } = await serviceOverFakes(null);
    const record: AdminSessionRecord = {
      sid: randomUUID(),
      zitadelSessionId: "zit-session-2",
      sub: "sub-admin",
      roles: ["platform_admin"],
      mfa: true,
      fingerprint: DEVICE_FP,
      csrfToken: randomUUID(),
      expiresAtMs: Date.now() + 60_000,
    };
    await store.create(record);

    const resolution = await resolveAdminRequest(svc, {
      headers: {
        ...DEVICE,
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${record.sid}`,
      },
      method: "GET",
      ip: DEVICE_IP,
    });
    expect("subject" in resolution).toBe(true);
    if (!("subject" in resolution)) return;

    const meta: AuthzMeta = {
      access: "authenticated",
      roles: ["platform_admin"],
      check: "fast-path",
      audit: "high-stakes",
      tests: ["EARS-2"],
    };
    expect(new AuthzGuard().canActivate(ctx(meta, resolution.subject))).toBe(
      true,
    );
  });
});

/**
 * 011 EARS-7 — the lockout **notification**, at the only altitude it is
 * observable.
 *
 * The e2e proves the lock and its `auth.lockout.triggered` row, but the mail
 * cannot be seen there: `AppModule` binds the real `SmtpMailer`, which is a
 * logged no-op with no SMTP host configured. So the notice is asserted here,
 * against the `FakeMailer` the port exists for — and asserted as
 * fire-and-forget, because putting an SMTP round-trip on the response path of
 * attempt #10 would make it measurably slower than attempts #1-9 and hand back
 * the timing oracle EARS-7 spends a clause denying.
 */
describe("011 EARS-7 — lockout notification (unit)", () => {
  const password = "Aa1!ufficiently-long-pw";
  const FP = "fp-admin-device";

  it("EARS-7: crossing the threshold notifies the operator exactly once, off the response path", async () => {
    const idp = new FakeIdpClient();
    const email = `lockout-${randomUUID()}@ds.test`;
    const { sub } = await idp.createUser({ email, password });
    await idp.grantProjectRole(sub, "platform_admin");
    const mailer = new FakeMailer();
    const lockout = new MfaLockoutService(() => Date.now());
    const svc = new AdminSessionService(
      idp,
      new InMemoryAdminSessionStore(),
      new InMemoryPendingAuthStore(),
      new InMemoryAuthAuditLog(),
      mailer,
      new RateLimitService(DEFAULT_RATE_LIMIT_THRESHOLDS, () => Date.now()),
      lockout,
    );

    // Enrol so the principal reaches the CHALLENGE step, then fail it enough
    // times to trip the §7 threshold. The per-user rate window is the production
    // default (10/15 min) and the lockout threshold is 10, so the failures are
    // driven straight against the lockout service rather than through ten HTTP
    // requests that the limiter would refuse first — the two ceilings are
    // separately proven (e2e EARS-7.4 / EARS-7.5).
    idp.setTotpFactor(sub, true);
    const login = await svc.startLogin(email, password, FP);
    expect(login.status).toBe("pending");

    for (let attempt = 0; attempt < MFA_LOCKOUT_THRESHOLD - 1; attempt++) {
      lockout.recordFailure(sub);
    }
    const ref = pendingRefFrom(
      (login as { status: "pending"; cookie: string }).cookie,
    );
    const refused = await svc.verifyChallenge(ref, FP, "000000");
    expect(refused.status).toBe("refused");

    // Fire-and-forget: the send is in flight when the call returns, so the
    // assertion waits for it rather than assuming it already happened.
    await vi.waitFor(() =>
      expect(mailer.adminLockoutNotices).toEqual([email.toLowerCase()]),
    );

    // Continuing to guess does NOT re-notify — the notice is one per lock, not
    // one per attempt, or an attacker could aim a mail flood at an operator.
    const again = await svc.verifyChallenge(ref, FP, "000000");
    expect(again.status).toBe("refused");
    await new Promise((r) => setTimeout(r, 20));
    expect(mailer.adminLockoutNotices).toHaveLength(1);
  });
});

/**
 * The pending reference out of the `Set-Cookie` the login outcome carries — the
 * same value a browser would send back, read the same way the handler reads it.
 * No reflection into the store: the test travels the production path.
 */
function pendingRefFrom(setCookie: string): string {
  const ref = /__Host-ds_admin_pending=([^;]+)/.exec(setCookie)?.[1];
  if (!ref) throw new Error(`no pending reference in ${setCookie}`);
  return ref;
}

/** A fake `ExecutionContext` whose handler carries `meta` and request carries `user`. */
function ctx(meta: AuthzMeta, user: unknown): ExecutionContext {
  const handler = (): void => {};
  Reflect.defineMetadata(AUTHZ_KEY, meta, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}
