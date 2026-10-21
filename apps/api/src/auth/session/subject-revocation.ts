import { Injectable } from "@nestjs/common";

/**
 * A holder of sessions for a subject outside the storefront session store —
 * the sign-in host's shared browser-session records (003 EARS-64) — that must
 * end with them whenever every session of that subject is revoked.
 */
export interface SubjectRevocationListener {
  revokeSubject(sub: string): Promise<void>;
}

/**
 * The one hook every «revoke every session of this subject» path goes through
 * (003 EARS-12 reset, EARS-41 first verification): {@link SessionService}
 * revokes its own store and then every registered holder, in that one place,
 * so a new revocation path can never forget the sign-in host and the sign-in
 * host can never be forgotten by one. Holders register at module init (the
 * sign-in-host module depends on the auth module, never the reverse).
 *
 * Fail-closed: a holder that throws fails the revocation, and with it the
 * credential step that asked for it — no fresh session is minted over a
 * revocation that did not happen.
 */
@Injectable()
export class SubjectRevocationHub {
  private readonly listeners: SubjectRevocationListener[] = [];

  register(listener: SubjectRevocationListener): void {
    this.listeners.push(listener);
  }

  async revoke(sub: string): Promise<void> {
    for (const listener of this.listeners) await listener.revokeSubject(sub);
  }
}
