import { expect, it, vi } from "vitest";
import { AuthService } from "./auth.service.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "./idp/idp.fake.js";
import { InMemoryLoginHandoffStore } from "./login-handoff/login-handoff.store.js";
import { InMemoryAuthAuditLog } from "./session/auth-audit.fake.js";
import { InMemorySessionStore } from "./session/session-store.fake.js";
import { SessionService } from "./session/session.service.js";
import { InMemoryRegisterNoticeThrottle } from "../mailer/register-notice-throttle.js";
import { SyntheticSuppression } from "../mailer/synthetic-suppression.js";

it("EARS-35: verifies a proven reset before an OIDC exchange that refuses an unverified account", async () => {
  const idp = new FakeIdpClient();
  const email = "reset-order@example.test";
  const { sub } = await idp.createUser({ email, password: "Old-password1!" });
  const audit = new InMemoryAuthAuditLog();
  const store = new InMemorySessionStore();
  const sessions = new SessionService(idp, store, audit);
  const mirrorFlip = vi.fn(async () => undefined);
  const unused = new Proxy(
    {},
    {
      get() {
        throw new Error("unused dependency reached");
      },
    },
  );
  const service = new AuthService(
    idp,
    unused as never,
    undefined,
    audit,
    new InMemoryRegisterNoticeThrottle("test-pepper"),
    SyntheticSuppression.disabled(),
    new InMemoryLoginHandoffStore(),
    { markEmailVerified: mirrorFlip } as never,
    sessions,
    unused as never,
  );
  const exchange = idp.exchangeSessionForTokens.bind(idp);
  const checkedExchange = vi
    .spyOn(idp, "exchangeSessionForTokens")
    .mockImplementation(async (session) => {
      // Reproduce the IdP boundary the permissive fake does not enforce (003 EARS-35).
      if (!(await idp.getUser(session.sub))?.emailVerified) {
        throw new Error("OIDC exchange requires verified email");
      }
      return exchange(session);
    });

  await expect(idp.getUser(sub)).resolves.toMatchObject({
    emailVerified: false,
  });
  await idp.requestPasswordReset(email);
  const completed = await service.completePasswordReset(
    email,
    FAKE_VALID_CODE,
    "New-password1!",
    "reset-browser",
  );

  expect(completed.body).toEqual({ status: "reset_completed" });
  expect(completed.cookie.startsWith("__Host-ds_session=")).toBe(true);
  expect(checkedExchange).toHaveBeenCalledTimes(1);
  expect(mirrorFlip).toHaveBeenCalledExactlyOnceWith(sub);
  expect(
    audit.events.filter((event) => event.type === "IdentifierVerified"),
  ).toEqual([{ type: "IdentifierVerified", sub, channel: "email" }]);
  expect(audit.events).toContainEqual({ type: "PasswordResetCompleted", sub });
  expect(audit.events).toContainEqual({
    type: "LoginSucceeded",
    sub,
    method: "password",
  });
});
