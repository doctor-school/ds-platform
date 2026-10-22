import { randomBytes } from "node:crypto";
import type { IdpSession } from "../auth/idp/idp.types.js";
import type {
  AuthRequestView,
  SignInHostFinaliseError,
  SignInHostIdp,
} from "./sign-in-host.idp.js";

/**
 * In-memory {@link SignInHostIdp} for the API e2e suites that run on the fake
 * credential IdP (`FakeIdpClient`): auth requests are seeded by the test, a
 * finalisation hands back a callback URL and marks the request handled (a
 * second read is `null`, as on Zitadel), and every call is recorded so a
 * suite can assert what the sign-in host asked of the IdP.
 */
export class FakeSignInHostIdp implements SignInHostIdp {
  private readonly requests = new Map<string, AuthRequestView>();
  /** Sessions the IdP no longer honours (terminated / expired elsewhere). */
  readonly deadSessions = new Set<string>();
  readonly finalised: Array<
    | { id: string; session: IdpSession }
    | { id: string; error: SignInHostFinaliseError }
  > = [];
  readonly lifetimes: Array<{ zitadelSessionId: string; seconds: number }> =
    [];

  /** Seed a pending auth request as the authorize endpoint would create it. */
  seedAuthRequest(input: {
    clientId: string;
    prompt?: string[];
    maxAgeSeconds?: number;
    loginHint?: string;
  }): string {
    const id = `V2_${randomBytes(12).toString("hex")}`;
    this.requests.set(id, {
      id,
      clientId: input.clientId,
      prompt: input.prompt ?? [],
      maxAgeSeconds: input.maxAgeSeconds,
      loginHint: input.loginHint,
    });
    return id;
  }

  /** Drop a pending request (it expired at the IdP). */
  expire(id: string): void {
    this.requests.delete(id);
  }

  readAuthRequest(id: string): Promise<AuthRequestView | null> {
    return Promise.resolve(this.requests.get(id) ?? null);
  }

  finaliseWithSession(id: string, session: IdpSession): Promise<string | null> {
    if (!this.requests.has(id) || this.deadSessions.has(session.zitadelSessionId))
      return Promise.resolve(null);
    this.requests.delete(id);
    this.finalised.push({ id, session });
    return Promise.resolve(
      `https://storefront.test/auth/callback?code=code-${id}&state=s`,
    );
  }

  finaliseWithError(
    id: string,
    error: SignInHostFinaliseError,
  ): Promise<string | null> {
    if (!this.requests.has(id)) return Promise.resolve(null);
    this.requests.delete(id);
    this.finalised.push({ id, error });
    return Promise.resolve(
      `https://storefront.test/auth/callback?error=${error}&state=s`,
    );
  }

  setSessionLifetime(
    session: IdpSession,
    seconds: number,
  ): Promise<IdpSession | null> {
    this.lifetimes.push({ zitadelSessionId: session.zitadelSessionId, seconds });
    return Promise.resolve(session);
  }
}
