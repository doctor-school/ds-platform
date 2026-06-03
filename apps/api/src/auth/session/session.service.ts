import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { SessionClaims } from "@ds/schemas";
import { IDP_CLIENT, type IdpClient } from "../idp/idp.types.js";
import { serializeSessionCookie } from "./session.cookie.js";
import {
  SESSION_STORE,
  type SessionRecord,
  type SessionStore,
} from "./session.types.js";

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
}
