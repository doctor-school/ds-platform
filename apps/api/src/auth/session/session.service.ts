import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { SessionClaims } from "@ds/schemas";
import {
  IDP_CLIENT,
  type IdpClient,
  type IdpSession,
} from "../idp/idp.types.js";
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
import { SharedSessionHub } from "./shared-session.js";
import { SubjectRevocationHub } from "./subject-revocation.js";

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
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

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
    @Inject(SubjectRevocationHub)
    private readonly revocations: SubjectRevocationHub = new SubjectRevocationHub(),
    @Inject(SharedSessionHub)
    private readonly sharedSessions: SharedSessionHub = new SharedSessionHub(),
  ) {}

  /**
   * 003 EARS-8 (amended) — the ONLY other path that mints a storefront
   * session: the storefront callback's redeem, after the code's ID token
   * proved its `sid` is the Zitadel session of a live sign-in-host record.
   * A fresh `sid` every time (no presented id is ever adopted), linked to that
   * Zitadel session, the tokens kept server-side, and an expiry no later than
   * the Zitadel session's (`expiresAtMs`, capped at the web session lifetime).
   */
  async mintLinked(input: {
    zitadelSessionId: string;
    client: "academy" | "doctor";
    claims: SessionClaims;
    accessToken: string;
    refreshToken: string;
    fingerprint: string;
    expiresAtMs: number;
  }): Promise<{ cookie: string; claims: SessionClaims }> {
    const now = Date.now();
    const expiresAtMs = Math.min(
      input.expiresAtMs,
      now + SESSION_TTL_SECONDS * 1000,
    );
    const record: SessionRecord = {
      sid: randomUUID(),
      zitadelSessionId: input.zitadelSessionId,
      sub: input.claims.sub,
      roles: input.claims.roles,
      mfa: input.claims.mfa,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      fingerprint: input.fingerprint,
      expiresAtMs,
      oidcClient: input.client,
    };
    await this.store.create(record);
    return {
      cookie: serializeSessionCookie(record.sid, {
        maxAgeSeconds: Math.max(0, Math.floor((expiresAtMs - now) / 1000)),
      }),
      claims: { sub: record.sub, roles: record.roles, mfa: record.mfa },
    };
  }

  /**
   * 003 EARS-10 / EARS-64 — revoke every storefront session linked to the
   * Zitadel session `zitadelSessionId`, on both storefronts, each with its
   * `SessionRevoked`. Synchronous in the API's own store.
   */
  async revokeLinked(zitadelSessionId: string): Promise<void> {
    for (const record of await this.store.deleteLinked(zitadelSessionId)) {
      await this.audit.record({
        type: "SessionRevoked",
        sub: record.sub,
        sid: record.sid,
      });
    }
  }

  /**
   * EARS-8: complete the OIDC exchange for a checked Zitadel session, persist the
   * tokens + fingerprint server-side under a fresh `sid`, and return the
   * `__Host-` cookie to set plus the principal claims to surface. No token is
   * returned to the caller's body — it goes only into the server-side record.
   *
   * Takes the whole checked {@link IdpSession} handle (#143). The exchange needs
   * the session's single-use `sessionToken` (proof-of-check) — it now arrives on
   * the handle rather than a hidden per-adapter cache — and this method is the
   * ONLY caller of `exchangeSessionForTokens`, always invoked synchronously in the
   * same request as the login. The token is consumed here in the exchange and is
   * deliberately NOT persisted onto the {@link SessionRecord}: only the opaque
   * `zitadelSessionId` is stored (the durable binding), because a spent
   * single-use secret in the record would be dead, sensitive data.
   */
  async establish(
    session: IdpSession,
    fingerprint: string,
  ): Promise<{ cookie: string; claims: SessionClaims }> {
    const tokens = await this.idp.exchangeSessionForTokens(session);
    const sid = randomUUID();
    const record: SessionRecord = {
      sid,
      zitadelSessionId: session.zitadelSessionId,
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

    // 003 EARS-8 (amended): a callback-minted session rotates through its own
    // storefront client; the rotation keeps its link and its bounded expiry
    // (`rotate` never moves `expiresAtMs`). A legacy session keeps the BFF client.
    const result = record.oidcClient
      ? await this.sharedSessions.refreshLinked(
          record.oidcClient,
          record.refreshToken,
        )
      : await this.idp.refreshTokens(record.refreshToken);
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
    // EARS-18 terminal event for the rotation command (`auth.token.rotated`).
    // F4 deferred this happy-path emission to F6 (the reuse/`theft_detected`
    // branch above already emitted); both now land in the durable ledger.
    await this.audit.record({ type: "RefreshRotated", sub: record.sub, sid });
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
    if (record?.oidcClient) {
      // 003 EARS-10 (amended) — one sign-out on both storefronts: the Zitadel
      // session and the sign-in-host record holding it end first, then every
      // storefront session linked to it (this one included), all in this call.
      await this.sharedSessions.end(record.sub, record.zitadelSessionId);
      await this.revokeLinked(record.zitadelSessionId);
    } else if (record) {
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
  async revokeAllForSub(sub: string): Promise<Date | null> {
    const fencedAt = await this.revokeSubject(sub);
    await this.audit.record({ type: "PasswordResetCompleted", sub });
    return fencedAt;
  }

  /**
   * 003 EARS-41: the first accepted code of an unverified account revokes every
   * session the account held before it, as on reset (EARS-12). The terminal
   * row of that command is `auth.account.verified`, written by the caller.
   */
  async revokeAllBeforeVerification(sub: string): Promise<Date | null> {
    return this.revokeSubject(sub);
  }

  /**
   * The one «every session of `sub` ends» step both revocations above share:
   * the storefront session store, then every other holder registered on the
   * {@link SubjectRevocationHub} (the sign-in host's records, 003 EARS-64), so
   * no path can revoke one and leave the other live.
   */
  private async revokeSubject(sub: string): Promise<Date | null> {
    await this.store.deleteBySub(sub);
    return this.revocations.revoke(sub);
  }
}
