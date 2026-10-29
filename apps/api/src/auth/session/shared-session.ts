import { Injectable } from "@nestjs/common";

/**
 * 003 EARS-10 (amended), ADR-0015 §4 «One sign-out on both storefronts» — the
 * holders of a shared browser session other than the storefront session store.
 * A storefront session minted at the callback is linked to one Zitadel session
 * that a sign-in-host record holds; its sign-out must end that Zitadel session
 * and the record in the same call. The session layer cannot import the
 * sign-in host (which imports it), so the host registers here — the same
 * inversion as {@link SubjectRevocationHub}.
 */
export interface SharedSessionListener {
  /** Terminate the Zitadel session `zitadelSessionId` of `sub` and delete the record holding it. */
  endSharedSession(sub: string, zitadelSessionId: string): Promise<void>;
}

/**
 * 003 EARS-8 (amended) / EARS-9 — a linked storefront session's refresh token
 * belongs to its storefront's OIDC client, so it rotates through that client
 * (`private_key_jwt`), never the BFF client. The sign-in host owns those
 * credentials and registers here. Only a grant Zitadel refuses as
 * `invalid_grant` (reused or revoked) is `reuseDetected` — 003 EARS-65 ends the
 * whole linked set on it. Any other refusal — an IdP outage, a locked user
 * (`invalid_request` `Errors.User.NotActive`), no refresher — is `failed`: the
 * presenting session fails closed alone, with no theft verdict.
 */
export type LinkedRefreshResult =
  | {
      reuseDetected: false;
      tokens: { accessToken: string; refreshToken: string };
    }
  | { reuseDetected: true }
  | { reuseDetected: false; failed: true };

export interface LinkedSessionRefresher {
  refreshLinked(
    client: "academy" | "doctor",
    refreshToken: string,
  ): Promise<LinkedRefreshResult>;
}

@Injectable()
export class SharedSessionHub {
  private readonly listeners: SharedSessionListener[] = [];
  private refresher: LinkedSessionRefresher | null = null;

  register(listener: SharedSessionListener): void {
    this.listeners.push(listener);
  }

  registerRefresher(refresher: LinkedSessionRefresher): void {
    this.refresher = refresher;
  }

  /** With no sign-in host there are no storefront client credentials: the refresh fails closed as `failed`. */
  refreshLinked(
    client: "academy" | "doctor",
    refreshToken: string,
  ): Promise<LinkedRefreshResult> {
    return this.refresher
      ? this.refresher.refreshLinked(client, refreshToken)
      : Promise.resolve({ reuseDetected: false, failed: true });
  }

  async end(sub: string, zitadelSessionId: string): Promise<void> {
    for (const listener of this.listeners)
      await listener.endSharedSession(sub, zitadelSessionId);
  }
}
