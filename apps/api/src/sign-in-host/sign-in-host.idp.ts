import type { FetchLike } from "../auth/idp/zitadel.idp.js";
import type { IdpSession } from "../auth/idp/idp.types.js";

/**
 * 003 EARS-5 (amended) / 60 / 64 / 68 — the three Zitadel calls the sign-in host
 * makes beyond the shared credential surface of `IdpClient`:
 *
 * - read a Login V2 auth request (`GET /v2/oidc/auth_requests/{id}`),
 * - finalise it — with a checked session, or with an OIDC error
 *   (`POST /v2/oidc/auth_requests/{id}`),
 * - give a checked session its explicit 30-day lifetime
 *   (`PATCH /v2/sessions/{id}` `{lifetime}`).
 *
 * A separate port rather than three more `IdpClient` members: the storefront
 * headless exchange (`ZitadelIdpClient.exchangeSessionForTokens`) stays exactly
 * as it is, and nothing outside the sign-in host can reach these calls.
 */
export const SIGN_IN_HOST_IDP = Symbol("SIGN_IN_HOST_IDP");

/** The fields of a v2 auth request the sign-in host decides on. */
export interface AuthRequestView {
  readonly id: string;
  readonly clientId: string;
  /** Lower-case OIDC prompt values (`login`, `none`, `create`, …). */
  readonly prompt: readonly string[];
  readonly maxAgeSeconds: number | undefined;
  readonly loginHint: string | undefined;
}

/** The OIDC errors the sign-in host ever finalises with. */
export type SignInHostFinaliseError = "access_denied" | "login_required";

export interface SignInHostIdp {
  /** `null` for an unknown, expired, already-handled or unreadable auth request. */
  readAuthRequest(id: string): Promise<AuthRequestView | null>;
  /** The callback URL carrying the code, or `null` if Zitadel refused the link. */
  finaliseWithSession(id: string, session: IdpSession): Promise<string | null>;
  /** The callback URL carrying `error=…`, or `null` if Zitadel refused. */
  finaliseWithError(
    id: string,
    error: SignInHostFinaliseError,
  ): Promise<string | null>;
  /**
   * Set the session's lifetime; returns the session with the token Zitadel
   * re-issued for it, or `null` (the step then fails closed).
   */
  setSessionLifetime(
    session: IdpSession,
    seconds: number,
  ): Promise<IdpSession | null>;
}

const ERROR_REASONS: Record<SignInHostFinaliseError, string> = {
  access_denied: "ERROR_REASON_ACCESS_DENIED",
  login_required: "ERROR_REASON_LOGIN_REQUIRED",
};

/** `PROMPT_LOGIN` → `login`; unknown shapes are dropped. */
export function normalisePrompt(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.replace(/^PROMPT_/, "").toLowerCase())
    .filter((p) => p !== "unspecified");
}

/** A protobuf Duration as JSON (`"3600s"`, `"1.5s"`) → whole seconds. */
export function parseDurationSeconds(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const match = /^(\d+)(?:\.\d+)?s$/.exec(raw);
  return match ? Number(match[1]) : undefined;
}

export interface ZitadelSignInHostIdpConfig {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly fetchImpl?: FetchLike;
}

export class ZitadelSignInHostIdp implements SignInHostIdp {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: ZitadelSignInHostIdpConfig) {
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as FetchLike);
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.serviceToken}`,
      "content-type": "application/json",
    };
  }

  async readAuthRequest(id: string): Promise<AuthRequestView | null> {
    try {
      const res = await this.fetchImpl(
        this.url(`/v2/oidc/auth_requests/${encodeURIComponent(id)}`),
        { method: "GET", headers: this.headers() },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        authRequest?: {
          id?: string;
          clientId?: string;
          prompt?: unknown;
          maxAge?: unknown;
          loginHint?: string;
        };
      };
      const request = data.authRequest;
      if (!request?.clientId) return null;
      return {
        id: request.id ?? id,
        clientId: request.clientId,
        prompt: normalisePrompt(request.prompt),
        maxAgeSeconds: parseDurationSeconds(request.maxAge),
        loginHint: request.loginHint || undefined,
      };
    } catch {
      return null;
    }
  }

  finaliseWithSession(id: string, session: IdpSession): Promise<string | null> {
    if (!session.zitadelSessionId || !session.sessionToken) {
      return Promise.resolve(null);
    }
    return this.finalise(id, {
      session: {
        sessionId: session.zitadelSessionId,
        sessionToken: session.sessionToken,
      },
    });
  }

  finaliseWithError(
    id: string,
    error: SignInHostFinaliseError,
  ): Promise<string | null> {
    return this.finalise(id, { error: { error: ERROR_REASONS[error] } });
  }

  private async finalise(id: string, body: unknown): Promise<string | null> {
    try {
      const res = await this.fetchImpl(
        this.url(`/v2/oidc/auth_requests/${encodeURIComponent(id)}`),
        { method: "POST", headers: this.headers(), body: JSON.stringify(body) },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { callbackUrl?: string };
      return data.callbackUrl || null;
    } catch {
      return null;
    }
  }

  async setSessionLifetime(
    session: IdpSession,
    seconds: number,
  ): Promise<IdpSession | null> {
    try {
      const res = await this.fetchImpl(
        this.url(`/v2/sessions/${encodeURIComponent(session.zitadelSessionId)}`),
        {
          method: "PATCH",
          headers: this.headers(),
          body: JSON.stringify({ lifetime: `${seconds}s` }),
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { sessionToken?: string };
      if (!data.sessionToken) return null;
      return { ...session, sessionToken: data.sessionToken };
    } catch {
      return null;
    }
  }
}
