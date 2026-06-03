import type {
  CreatedUser,
  CreateUserInput,
  IdpClient,
  IdpSession,
  IdpTokens,
  IdpUser,
} from "./idp.types.js";

/** Subset of `fetch` the adapter needs — narrowed so it can be faked in tests. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface ZitadelConfig {
  /** Zitadel instance base URL, e.g. `https://idp.example.com`. */
  baseUrl: string;
  /** Service-account bearer token with User v2 management scope. */
  serviceToken: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike | undefined;
}

/**
 * Real Zitadel adapter for the {@link IdpClient} port (design §2).
 *
 * It speaks the Zitadel **User v2 API** — `apps/api` reimplements no auth
 * primitive (Constraints; AGPL §13 discipline: integrate via API only, never
 * patch Zitadel). It is bound by {@link createIdpModule} **only when a service
 * token is configured**; with the dev-stand's empty `IDP_CLIENT_SECRET` the
 * {@link FakeIdpClient} is used instead, so this adapter's HTTP paths are
 * exercised by integration runs that point at a real Zitadel (skipped in the
 * shared CI unit job — `IDP_ISSUER` is not in turbo `passThroughEnv`), not by
 * the default `api-e2e` job. Every failure path resolves fail-closed
 * (enumeration-safe / never an open gate, ADR-0001 §7).
 */
export class ZitadelIdpClient implements IdpClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: ZitadelConfig) {
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as FetchLike);
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.serviceToken}`,
      "content-type": "application/json",
    };
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async createUser(input: CreateUserInput): Promise<CreatedUser> {
    // Zitadel POST /v2/users/human — duplicate identifier returns 409, which is
    // the enumeration-safety hinge: surface it as `alreadyExisted`, not a throw.
    const body: Record<string, unknown> = {
      password: { password: input.password },
    };
    if (input.email) body["email"] = { email: input.email };
    if (input.phone) body["phone"] = { phone: input.phone };

    const res = await this.fetchImpl(this.url("/v2/users/human"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (res.status === 409) return { sub: "", alreadyExisted: true };
    if (!res.ok) {
      throw new Error(`zitadel createUser failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { userId?: string };
    return { sub: data.userId ?? "", alreadyExisted: false };
  }

  async requestEmailVerification(sub: string): Promise<void> {
    const res = await this.fetchImpl(
      this.url(`/v2/users/${sub}/email/_send_code`),
      { method: "POST", headers: this.headers(), body: JSON.stringify({}) },
    );
    // Surface a failed send instead of silently looking like success
    // (consistent with createUser); the caller decides the user-facing message.
    if (!res.ok) {
      throw new Error(`zitadel email send_code failed: HTTP ${res.status}`);
    }
  }

  async requestPhoneVerification(sub: string): Promise<void> {
    const res = await this.fetchImpl(
      this.url(`/v2/users/${sub}/phone/_send_code`),
      { method: "POST", headers: this.headers(), body: JSON.stringify({}) },
    );
    if (!res.ok) {
      throw new Error(`zitadel phone send_code failed: HTTP ${res.status}`);
    }
  }

  async verifyEmail(sub: string, code: string): Promise<boolean> {
    const res = await this.fetchImpl(
      this.url(`/v2/users/${sub}/email/_verify`),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ verificationCode: code }),
      },
    );
    return res.ok;
  }

  async verifyPhone(sub: string, code: string): Promise<boolean> {
    const res = await this.fetchImpl(
      this.url(`/v2/users/${sub}/phone/_verify`),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ verificationCode: code }),
      },
    );
    return res.ok;
  }

  async passwordLogin(
    identifier: string,
    password: string,
  ): Promise<IdpSession | null> {
    // Zitadel Session v2: POST /v2/sessions with a user + password check. A
    // failed check (unknown loginName / wrong password) is a non-2xx — resolve
    // it to `null` so the caller stays enumeration-safe (EARS-16); Zitadel's
    // native lockout policy counts the failure (EARS-15). The session that comes
    // back has already passed its check (design §3).
    const res = await this.fetchImpl(this.url("/v2/sessions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        checks: {
          user: { loginName: identifier },
          password: { password },
        },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      sessionId?: string;
      factors?: { user?: { id?: string } };
    };
    const zitadelSessionId = data.sessionId;
    const sub = data.factors?.user?.id;
    if (!zitadelSessionId || !sub) return null;
    return { zitadelSessionId, sub };
  }

  exchangeSessionForTokens(_zitadelSessionId: string): Promise<IdpTokens> {
    // INTEGRATION SEAM (design §3, §11): turning a checked Zitadel session into
    // OIDC tokens is the authorize-with-session → code → token-endpoint dance,
    // which needs the per-recipe OIDC application config (IDP_CLIENT_ID /
    // redirect URI), created against the dev-stand Zitadel console as a recipe
    // follow-up (the dev-stand ships `IDP_CLIENT_SECRET=CHANGE_ME`). Until that
    // config is plumbed and verifiable against a live instance, fail closed —
    // mint nothing — rather than ship an unverifiable token-exchange path. The
    // BFF domain logic (EARS-5/8) is proven against FakeIdpClient; this adapter's
    // session-create path above is faithful to the documented Session v2 API.
    return Promise.reject(
      new Error(
        "zitadel OIDC session→token exchange is not wired against the dev-stand yet (design §11)",
      ),
    );
  }

  async listUsers(): Promise<IdpUser[]> {
    const res = await this.fetchImpl(this.url("/v2/users"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      result?: Array<{
        userId?: string;
        human?: {
          email?: { email?: string; isVerified?: boolean };
          phone?: { phone?: string; isVerified?: boolean };
        };
      }>;
    };
    return (data.result ?? []).map((u) => ({
      sub: u.userId ?? "",
      email: u.human?.email?.email,
      phone: u.human?.phone?.phone,
      emailVerified: u.human?.email?.isVerified ?? false,
      phoneVerified: u.human?.phone?.isVerified ?? false,
    }));
  }
}
