import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { SessionClaims } from "@ds/schemas";
import { IDP_CLIENT, type IdpClient } from "../idp/idp.types.js";
import { AUTH_AUDIT, type AuthAuditLog } from "./auth-audit.types.js";
import {
  clearSessionCookie,
  serializeSessionCookie,
} from "./session.cookie.js";
import {
  SESSION_STORE,
  type SessionRecord,
  type SessionStore,
} from "./session.types.js";

/**
 * Outcome of a refresh attempt (EARS-9). `rotated` carries the (unchanged)
 * principal; `reuse_detected` means the chain was invalidated and the session
 * revoked; `no_session` means the cookie resolved to no live session.
 */
export type RefreshOutcome =
  | { status: "rotated"; claims: SessionClaims }
  | { status: "reuse_detected" }
  | { status: "no_session" };

/**
 * Web session lifetime = the refresh-token lifetime (ADR-0001 §6: opaque, 30 d
 * web). The cookie `Max-Age` and the server-side store TTL share this value, so
 * the cookie and its backing record expire together. The 15 min access-JWT
 * lifetime is token-internal (refreshed under the same session by F4/EARS-9).
 */
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Owns BFF session establishment and lookup (design §3, EARS-8). The single
 * place the OIDC exchange is turned into a server-side session + `__Host-`
 * cookie, so the cookie/token logic exists exactly once for every login variant
 * (password F2, email/SMS-OTP F3 converge here — design §6).
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(IDP_CLIENT) private readonly idp: IdpClient,
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    @Inject(AUTH_AUDIT) private readonly audit: AuthAuditLog,
  ) {}

  /**
   * EARS-8: complete the OIDC exchange for a checked Zitadel session, persist the
   * tokens + fingerprint server-side under a fresh `sid`, and return the
   * `__Host-` cookie to set plus the principal claims to surface. No token is
   * returned to the caller's body — it goes only into the server-side record.
   */
  async establish(
    zitadelSessionId: string,
    fingerprint: string,
  ): Promise<{ cookie: string; claims: SessionClaims }> {
    const tokens = await this.idp.exchangeSessionForTokens(zitadelSessionId);
    const sid = randomUUID();
    const record: SessionRecord = {
      sid,
      zitadelSessionId,
      sub: tokens.claims.sub,
      roles: tokens.claims.roles,
      mfa: tokens.claims.mfa,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      fingerprint,
      expiresAtMs: Date.now() + SESSION_TTL_SECONDS * 1000,
    };
    await this.store.create(record);

    return {
      cookie: serializeSessionCookie(sid, {
        maxAgeSeconds: SESSION_TTL_SECONDS,
      }),
      claims: { sub: record.sub, roles: record.roles, mfa: record.mfa },
    };
  }

  /** Resolve a session by its cookie `sid` (used by the auth middleware). */
  getBySid(sid: string): Promise<SessionRecord | undefined> {
    return this.store.get(sid);
  }

  /**
   * EARS-9: rotate the session's refresh token single-use. Reads the current
   * server-side token, exchanges it at the IdP (which owns RFC-6819 reuse
   * detection, ADR-0001 §7), and persists the fresh pair. If the IdP reports the
   * presented token was already consumed, the chain is invalidated by deleting
   * the session (force re-auth) and a `RefreshReuseDetected` event is recorded.
   * The `sid`/cookie is unchanged on success — only the server-side tokens move.
   */
  async refresh(sid: string): Promise<RefreshOutcome> {
    const record = await this.store.get(sid);
    if (!record) return { status: "no_session" };

    const result = await this.idp.refreshTokens(record.refreshToken);
    if (result.reuseDetected) {
      await this.store.delete(sid);
      await this.audit.record({
        type: "RefreshReuseDetected",
        sub: record.sub,
        sid,
      });
      return { status: "reuse_detected" };
    }

    await this.store.rotate(
      sid,
      result.tokens.accessToken,
      result.tokens.refreshToken,
    );
    return {
      status: "rotated",
      claims: { sub: record.sub, roles: record.roles, mfa: record.mfa },
    };
  }

  /**
   * EARS-10: log out. Deletes the server-side session (invalidating its refresh
   * chain — the tokens live only in the record), records `SessionRevoked`, and
   * returns the `__Host-` cookie that clears the browser's copy. Idempotent: a
   * missing session still returns the clearing cookie, but emits no event (there
   * was nothing to revoke).
   */
  async logout(sid: string): Promise<{ cookie: string }> {
    const record = await this.store.get(sid);
    if (record) {
      await this.store.delete(sid);
      await this.audit.record({
        type: "SessionRevoked",
        sub: record.sub,
        sid,
      });
    }
    return { cookie: clearSessionCookie() };
  }

  /**
   * EARS-12 session-side effect of a completed password reset: revoke **every**
   * session belonging to `sub` (global force-logout — a credential change must
   * not leave a live session behind, ADR-0001 §6/§7) and record the user-level
   * `PasswordResetCompleted` event. The password itself is set at the IdP by the
   * orchestrating {@link AuthService}; this method owns only the session-store +
   * audit half, keeping the audit seam consolidated in this service (as logout
   * and refresh-reuse already are). Idempotent — a subject with no live sessions
   * still records the event (the reset did complete).
   */
  async revokeAllForSub(sub: string): Promise<void> {
    await this.store.deleteBySub(sub);
    await this.audit.record({ type: "PasswordResetCompleted", sub });
  }
}
