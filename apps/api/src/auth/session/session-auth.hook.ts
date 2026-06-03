import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { SessionService } from "./session.service.js";
import {
  computeFingerprint,
  parseCookies,
  SESSION_COOKIE_NAME,
} from "./session.cookie.js";

/** The authenticated subject the hook attaches to the request (read by `AuthzGuard`). */
export interface RequestSubject {
  sub: string;
  roles: string[];
  mfa: boolean;
}

/** The request surface the hook reads — headers + Fastify-resolved client IP. */
interface HookRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  user?: RequestSubject;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolve the authenticated subject for a request from its `__Host-` session
 * cookie (design §3, EARS-8) — extracted as a pure async function so it is
 * unit-testable without Fastify. Returns `undefined` (request stays
 * unauthenticated) when there is no cookie, no live session, or the request's
 * re-derived fingerprint diverges from the one bound at login — a stolen cookie
 * replayed from another device/network does not authenticate.
 */
export async function resolveSubject(
  session: SessionService,
  req: Pick<HookRequest, "headers" | "ip">,
): Promise<RequestSubject | undefined> {
  const sid = parseCookies(headerValue(req.headers.cookie))[SESSION_COOKIE_NAME];
  if (!sid) return undefined;

  const record = await session.getBySid(sid);
  if (!record) return undefined;

  const fingerprint = computeFingerprint({
    userAgent: headerValue(req.headers["user-agent"]),
    ip: req.ip,
    acceptLanguage: headerValue(req.headers["accept-language"]),
  });
  if (fingerprint !== record.fingerprint) return undefined;

  return { sub: record.sub, roles: record.roles, mfa: record.mfa };
}

/**
 * Populates the request subject the {@link AuthzGuard} reads — the seam left open
 * in `authz.guard.ts` ("populating the request subject is the 003 BFF work, F2").
 *
 * It registers a Fastify `onRequest` hook rather than a Nest middleware on
 * purpose: with the Fastify adapter, Nest middleware receives the *raw* Node
 * request, so a `user` set there is invisible to the guard, which reads the
 * *Fastify* request. A Fastify `onRequest` hook decorates that same Fastify
 * request and always runs before Nest's guard phase, so the subject is present
 * by the time the guard evaluates `access: "authenticated"`. Authentication
 * fails open to "no subject" (never throws): the fail-closed decision stays in
 * the guard, which denies a protected route when no subject is present.
 */
@Injectable()
export class SessionAuthHook implements OnApplicationBootstrap {
  private readonly logger = new Logger(SessionAuthHook.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly session: SessionService,
  ) {}

  onApplicationBootstrap(): void {
    // `HttpAdapterHost` is absent when the app is booted as a bare context (no
    // HTTP server) — e.g. the endpoint-authz lint gate. No server ⇒ no requests
    // to authenticate, so quietly skip rather than crash the boot.
    const fastify = this.adapterHost?.httpAdapter?.getInstance() as
      | { addHook?: (event: string, fn: unknown) => void }
      | undefined;
    if (!fastify?.addHook) {
      this.logger.warn("no Fastify instance — session auth hook not registered");
      return;
    }

    fastify.addHook("onRequest", async (req: HookRequest) => {
      const subject = await resolveSubject(this.session, req);
      if (subject) req.user = subject;
    });
  }
}
