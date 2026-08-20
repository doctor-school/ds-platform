import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STEP_UP_MAX_AGE_MS,
  STEP_UP_URL,
  type AuthzMeta,
} from "../../authz/authz.types.js";
import type {
  AdminAuthorityVerdict,
  IdpClient,
  RevalidateAdminAuthorityInput,
} from "../idp/idp.types.js";
import { AdminAuthorityGuard } from "./admin-authority.guard.js";
import {
  AdminAuthorityException,
  type AdminAuthorityErrorCode,
} from "./admin-authority.problem.js";
import type { AdminSessionService } from "./admin-session.service.js";
import type { AdminSessionRecord } from "./admin-session.types.js";

/**
 * #1304 — the refusal matrix of {@link AdminAuthorityGuard}.
 *
 * The guard is the single place where a live IdP verdict and the step-up
 * freshness window turn into a status + `errorCode`, so this suite is the
 * authority on that mapping. Two properties are asserted on EVERY refusal row
 * rather than only on the interesting ones:
 *
 *  1. the exact `errorCode`/status pair, because these strings are the published
 *     client contract (011/012 already speak `ADMIN_SESSION_REQUIRED` and
 *     `PLATFORM_ADMIN_REQUIRED`, and a drift here is a silent API break); and
 *  2. **no side effect** — the guard refused before anything downstream ran. A
 *     guard that consulted the IdP *after* touching the session store, or that
 *     kept going past a refusal, would still produce the right status while
 *     having already reserved an idempotency key or started an upload. The
 *     `canActivate` contract makes "refused" and "handler never ran" the same
 *     fact, so the assertion is that the throw happens and that the collaborators
 *     downstream of the refusal point were never called.
 */

const SID = "sid-1";
const ZITADEL_SESSION_ID = "zsess-1";
const SUB = "user-1";

function metaOf(over: Partial<AuthzMeta> = {}): AuthzMeta {
  return {
    audience: "admin",
    roles: ["platform_admin"],
    ...over,
  } as AuthzMeta;
}

/**
 * `mfaVerifiedAtMs: null` means the FIELD IS ABSENT — a record written before the
 * elevation timestamp existed. That is a distinct case from a stale timestamp and
 * the guard must fail closed on it, so the helper can express it exactly rather
 * than approximating it with `0`.
 */
function recordOf(opts: { mfaVerifiedAtMs?: number | null } = {}): AdminSessionRecord {
  const base = { sid: SID, sub: SUB, zitadelSessionId: ZITADEL_SESSION_ID };
  if (opts.mfaVerifiedAtMs === null) return base as AdminSessionRecord;
  return {
    ...base,
    mfaVerifiedAtMs: opts.mfaVerifiedAtMs ?? Date.now(),
  } as AdminSessionRecord;
}

interface Harness {
  guard: AdminAuthorityGuard;
  revalidate: ReturnType<typeof vi.fn>;
  getBySid: ReturnType<typeof vi.fn>;
  handler: ReturnType<typeof vi.fn>;
  context: Parameters<AdminAuthorityGuard["canActivate"]>[0];
}

interface HarnessOptions {
  meta?: AuthzMeta | undefined;
  principal?: { sid?: string } | undefined;
  record?: AdminSessionRecord | null | undefined;
  verdict?: AdminAuthorityVerdict | undefined;
}

function harness(opts: HarnessOptions): Harness {
  const activeVerdict: AdminAuthorityVerdict = {
    outcome: "active",
    sub: SUB,
    roles: ["platform_admin"],
  };
  const revalidate = vi.fn(
    (_input: RevalidateAdminAuthorityInput): Promise<AdminAuthorityVerdict> =>
      Promise.resolve(opts.verdict ?? activeVerdict),
  );
  const getBySid = vi.fn(() =>
    Promise.resolve(opts.record === undefined ? recordOf() : opts.record),
  );
  // Stands in for everything downstream of the guard. `canActivate` returning
  // false / throwing means Nest never invokes it — so "never called" is the
  // machine-checkable form of "the refusal preceded claim/domain/media/audit
  // work".
  const handler = vi.fn();

  const reflector = {
    getAllAndOverride: () => opts.meta,
  } as unknown as Reflector;

  const guard = new AdminAuthorityGuard(
    { revalidateAdminAuthority: revalidate } as unknown as IdpClient,
    reflector,
    { getBySid } as unknown as AdminSessionService,
  );

  const context = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ user: opts.principal }),
    }),
  } as unknown as Parameters<AdminAuthorityGuard["canActivate"]>[0];

  return { guard, revalidate, getBySid, handler, context };
}

async function expectRefusal(
  h: Harness,
  errorCode: AdminAuthorityErrorCode,
  status: number,
): Promise<AdminAuthorityException> {
  const err = await h.guard.canActivate(h.context).then(
    () => {
      throw new Error(`expected ${errorCode}, but the guard allowed the call`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AdminAuthorityException);
  const refusal = err as AdminAuthorityException;
  expect(refusal.errorCode).toBe(errorCode);
  expect(refusal.getStatus()).toBe(status);
  const body = refusal.getResponse() as { errorCode: string; status: number };
  expect(body.errorCode).toBe(errorCode);
  expect(body.status).toBe(status);
  // The refusal is the end of the request: the handler was never reached.
  expect(h.handler).not.toHaveBeenCalled();
  return refusal;
}

describe("AdminAuthorityGuard (#1304)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe("rows the guard does not act on", () => {
    it("#1304: an unclassified handler passes through — AuthzGuard owns that refusal", async () => {
      const h = harness({ meta: undefined });
      await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
      expect(h.revalidate).not.toHaveBeenCalled();
      expect(h.getBySid).not.toHaveBeenCalled();
    });

    it("#1304: a classified row without revalidate/stepUp is untouched", async () => {
      const h = harness({ meta: metaOf() });
      await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
      expect(h.revalidate).not.toHaveBeenCalled();
      expect(h.getBySid).not.toHaveBeenCalled();
    });
  });

  describe("the session precondition", () => {
    it("#1304: 401 ADMIN_SESSION_REQUIRED — no admin principal on the request", async () => {
      const h = harness({
        meta: metaOf({ revalidate: "live" }),
        principal: undefined,
      });
      await expectRefusal(h, "ADMIN_SESSION_REQUIRED", 401);
      expect(h.getBySid).not.toHaveBeenCalled();
      expect(h.revalidate).not.toHaveBeenCalled();
    });

    it("#1304: 401 ADMIN_SESSION_REQUIRED — the session record is gone (force-logout mid-request)", async () => {
      const h = harness({
        meta: metaOf({ revalidate: "live" }),
        principal: { sid: SID },
        record: null,
      });
      await expectRefusal(h, "ADMIN_SESSION_REQUIRED", 401);
      // The IdP is never consulted for a principal we no longer have a wrapped
      // session id for — there is nothing to ask about.
      expect(h.revalidate).not.toHaveBeenCalled();
    });
  });

  describe("the live IdP verdict", () => {
    it("#1304: active — the call proceeds, asked about the row's role", async () => {
      const h = harness({
        meta: metaOf({ revalidate: "live" }),
        principal: { sid: SID },
      });
      await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
      expect(h.revalidate).toHaveBeenCalledWith({
        zitadelSessionId: ZITADEL_SESSION_ID,
        sub: SUB,
        requiredRole: "platform_admin",
      });
    });

    it("#1304: 401 ADMIN_SESSION_REQUIRED — the IdP reports the credential inactive", async () => {
      const h = harness({
        meta: metaOf({ revalidate: "live" }),
        principal: { sid: SID },
        verdict: { outcome: "inactive", reason: "session_gone" },
      });
      await expectRefusal(h, "ADMIN_SESSION_REQUIRED", 401);
    });

    it("#1304: 403 PLATFORM_ADMIN_REQUIRED — the grant was revoked on a platform_admin row", async () => {
      const h = harness({
        meta: metaOf({ revalidate: "live" }),
        principal: { sid: SID },
        verdict: { outcome: "role_revoked", roles: [] },
      });
      await expectRefusal(h, "PLATFORM_ADMIN_REQUIRED", 403);
    });

    it("#1304: 403 PD_OFFICER_REQUIRED — the same verdict on an ADR-0009 officer row", async () => {
      const h = harness({
        meta: metaOf({
          revalidate: "live",
          roles: ["platform_admin", "pd_officer"],
        }),
        principal: { sid: SID },
        verdict: { outcome: "role_revoked", roles: ["platform_admin"] },
      });
      await expectRefusal(h, "PD_OFFICER_REQUIRED", 403);
      // A row naming the officer grant is revalidated against THAT grant, never
      // against the broader platform_admin it also carries.
      expect(h.revalidate).toHaveBeenCalledWith(
        expect.objectContaining({ requiredRole: "pd_officer" }),
      );
    });

    it("#1304: 503 IDP_REVALIDATION_UNAVAILABLE — a provider fault is never a credential denial", async () => {
      const h = harness({
        meta: metaOf({ revalidate: "live" }),
        principal: { sid: SID },
        verdict: { outcome: "unavailable", reason: "transport" },
      });
      await expectRefusal(h, "IDP_REVALIDATION_UNAVAILABLE", 503);
    });
  });

  describe("step-up freshness (ADR-0009 approval route)", () => {
    it("#1304: 401 STEP_UP_REQUIRED + stepUpUrl — no elevation recorded on the session", async () => {
      const h = harness({
        meta: metaOf({ stepUp: true, roles: ["pd_officer"] }),
        principal: { sid: SID },
        record: recordOf({ mfaVerifiedAtMs: null }),
      });
      const refusal = await expectRefusal(h, "STEP_UP_REQUIRED", 401);
      expect(refusal.stepUpUrl).toBe(STEP_UP_URL);
      expect(
        (refusal.getResponse() as { stepUpUrl?: string }).stepUpUrl,
      ).toBe(STEP_UP_URL);
    });

    it("#1304: 401 STEP_UP_REQUIRED — the elevation is older than the window", async () => {
      const h = harness({
        meta: metaOf({ stepUp: true, roles: ["pd_officer"] }),
        principal: { sid: SID },
        record: recordOf({
          mfaVerifiedAtMs: Date.now() - STEP_UP_MAX_AGE_MS - 1_000,
        }),
      });
      await expectRefusal(h, "STEP_UP_REQUIRED", 401);
    });

    it("#1304: a fresh elevation inside the window passes", async () => {
      const h = harness({
        meta: metaOf({ stepUp: true, roles: ["pd_officer"] }),
        principal: { sid: SID },
        record: recordOf({ mfaVerifiedAtMs: Date.now() - 1_000 }),
      });
      await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    });

    it("#1304: authority outranks elevation — a revoked officer is told the truth, not sent to re-elevate", async () => {
      const h = harness({
        meta: metaOf({
          revalidate: "live",
          stepUp: true,
          roles: ["pd_officer"],
        }),
        principal: { sid: SID },
        // Stale elevation AND a revoked grant: the role refusal must win, or the
        // operator would re-do MFA only to be refused afterwards.
        record: recordOf({ mfaVerifiedAtMs: null }),
        verdict: { outcome: "role_revoked", roles: [] },
      });
      await expectRefusal(h, "PD_OFFICER_REQUIRED", 403);
    });

    it("#1304: an outage on a step-up row is a 503, not a step-up prompt", async () => {
      const h = harness({
        meta: metaOf({
          revalidate: "live",
          stepUp: true,
          roles: ["pd_officer"],
        }),
        principal: { sid: SID },
        record: recordOf({ mfaVerifiedAtMs: null }),
        verdict: { outcome: "unavailable", reason: "service_auth" },
      });
      await expectRefusal(h, "IDP_REVALIDATION_UNAVAILABLE", 503);
    });
  });
});
