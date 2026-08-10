import { randomUUID } from "node:crypto";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FakeIdpClient } from "../idp/idp.fake.js";
import { InMemoryAuthAuditLog } from "../session/auth-audit.fake.js";
import { computeFingerprint } from "../session/session.cookie.js";
import { AuthzGuard } from "../../authz/authz.guard.js";
import { AUTHZ_KEY, type AuthzMeta } from "../../authz/authz.types.js";
import { AdminSessionService } from "./admin-session.service.js";
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
  }> {
    const idp = new FakeIdpClient();
    const email = `admin-${randomUUID()}@ds.test`;
    const { sub } = await idp.createUser({ email, password });
    if (role) await idp.grantProjectRole(sub, role);
    const store = new InMemoryAdminSessionStore();
    const audit = new InMemoryAuthAuditLog();
    const svc = new AdminSessionService(
      idp,
      store,
      new InMemoryPendingAuthStore(),
      audit,
    );
    return { svc, idp, audit, store, email, sub };
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
