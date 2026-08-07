import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { MirrorSelfHealService } from "../mirror-self-heal.service.js";
import {
  computeFingerprint,
  parseCookies,
  SESSION_COOKIE_NAME,
} from "../session/session.cookie.js";
import {
  AUTH_AUDIT,
  type AdminSessionRejectionReason,
  type AuthAuditLog,
} from "../session/auth-audit.types.js";
import {
  ADMIN_CSRF_HEADER,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
  isAdminAuthEntryRoute,
  isAdminRoute,
  isStateChangingMethod,
} from "./admin-session.cookie.js";
import {
  AdminSessionService,
  type AdminSessionPrincipal,
} from "./admin-session.service.js";

/** The request surface the hook reads — headers, method, url + Fastify-resolved IP. */
interface HookRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url: string;
  ip?: string;
  user?: AdminSessionPrincipal;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Either an admin principal, or the audit-only reason the request was refused. */
export type AdminResolution =
  | { subject: AdminSessionPrincipal }
  | { rejection: AdminSessionRejectionReason; sub: string | null }
  /** No admin credential was presented at all — nothing was refused, so no row. */
  | { anonymous: true };

/**
 * EARS-2 + EARS-10 — resolve the admin principal for an admin-tier request, or
 * say why it is refused. Extracted as a pure async function so the whole refusal
 * matrix is unit-testable without Fastify.
 *
 * The load-bearing property: it reads **only** `__Host-ds_admin_session`. Because
 * the admin app reaches `/v1/*` same-origin through its proxy, a browser holding
 * a doctor-portal session **will** attach `__Host-ds_session` here — so "the
 * portal cookie does not work on an admin route" has to be code, not luck. Every
 * refusal is explicit and carries its reason into the ledger.
 */
export async function resolveAdminRequest(
  admin: AdminSessionService,
  req: Pick<HookRequest, "headers" | "method" | "ip">,
): Promise<AdminResolution> {
  const cookies = parseCookies(headerValue(req.headers.cookie));
  const sid = cookies[ADMIN_SESSION_COOKIE_NAME];

  if (!sid) {
    // A pending reference is checked FIRST so its refusal is recorded as what it
    // is: the spec's sharpest invariant is that a pending reference reaching an
    // admin route would defeat the whole design (011 Constraints).
    if (cookies[ADMIN_PENDING_COOKIE_NAME]) {
      return { rejection: "pending_ref", sub: null };
    }
    if (cookies[SESSION_COOKIE_NAME]) {
      return { rejection: "wrong_cookie", sub: null };
    }
    return { anonymous: true };
  }

  const record = await admin.getBySid(sid);
  if (!record) return { rejection: "expired", sub: null };

  const fingerprint = computeFingerprint({
    userAgent: headerValue(req.headers["user-agent"]),
    ip: req.ip,
    acceptLanguage: headerValue(req.headers["accept-language"]),
  });
  if (fingerprint !== record.fingerprint) {
    return { rejection: "fingerprint_mismatch", sub: record.sub };
  }

  // Defensive re-assertion of the EARS-1/3 invariant. No code path writes an
  // admin session record with `mfa = false`, so reaching this branch is a bug —
  // and the right answer to a bug in a security invariant is a refusal.
  if (record.mfa !== true) {
    return { rejection: "role_without_mfa", sub: record.sub };
  }

  // EARS-10 CSRF double-submit on every state-changing admin endpoint. The
  // readable `__Host-ds_admin_csrf` cookie must be echoed into the header; a
  // cross-site caller can cause the cookie to be sent but cannot read it to
  // compose the header. `SameSite=Strict` already makes this hard to reach —
  // double-submit is the defence-in-depth ADR-0004 design §3.2.1 asks for, not a
  // substitute for it.
  if (isStateChangingMethod(req.method)) {
    const presented = headerValue(req.headers[ADMIN_CSRF_HEADER]);
    if (!presented || presented !== record.csrfToken) {
      return { rejection: "csrf_mismatch", sub: record.sub };
    }
  }

  return {
    subject: {
      sub: record.sub,
      roles: record.roles,
      mfa: true,
      sid: record.sid,
    },
  };
}

/**
 * Registers the admin-tier `onRequest` hook (EARS-2, EARS-10).
 *
 * It is a **second, disjoint** hook next to the 003 {@link SessionAuthHook}: this
 * one handles `/v1/admin/**` and that one handles everything else, so neither can
 * fall back to the other's cookie. That disjointness is the enforced separation —
 * an admin route never consults `__Host-ds_session`, and a portal route never
 * consults `__Host-ds_admin_session` (it looks the cookie up by name and simply
 * does not find one).
 *
 * Like the portal hook it fails **to "no subject"** rather than throwing: the
 * fail-closed decision stays in `AuthzGuard`, which denies an `authenticated`
 * route with no subject. The refusal is not silent — it appends the canonical
 * `auth.session.rejected` row with its reason.
 */
@Injectable()
export class AdminSessionAuthHook implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSessionAuthHook.name);

  // The `@Inject`-annotated parameter comes FIRST on purpose: tsx/esbuild (the
  // endpoint-authz lint gate's runtime) mis-emits `design:paramtypes` when a
  // type-inferred parameter precedes an `@Inject` one, which breaks DI for the
  // whole class under that runtime — the same hazard `AuthController` documents.
  constructor(
    @Inject(AUTH_AUDIT) private readonly audit: AuthAuditLog,
    private readonly adapterHost: HttpAdapterHost,
    private readonly admin: AdminSessionService,
    private readonly selfHeal: MirrorSelfHealService,
  ) {}

  onApplicationBootstrap(): void {
    // Absent when the app is booted as a bare context (no HTTP server) — e.g.
    // the endpoint-authz lint gate. No server ⇒ no requests to authenticate.
    const fastify = this.adapterHost?.httpAdapter?.getInstance() as
      { addHook?: (event: string, fn: unknown) => void } | undefined;
    if (!fastify?.addHook) {
      this.logger.warn("no Fastify instance — admin auth hook not registered");
      return;
    }

    fastify.addHook("onRequest", async (req: HookRequest) => {
      if (!isAdminRoute(req.url)) return;

      const resolution = await resolveAdminRequest(this.admin, req);
      if ("subject" in resolution) {
        req.user = resolution.subject;
        // Parity with the portal hook (EARS-26, #709): lazily re-materialize a
        // missing `users` mirror row before the handler runs, so an admin write
        // that joins the mirror does not 404 on a webhook lag. Never throws.
        await this.selfHeal.ensureMirrored(resolution.subject.sub);
        return;
      }
      if ("anonymous" in resolution) return;

      // The admin auth-entry routes (`/v1/admin/auth/**`) are where a caller
      // legitimately arrives WITHOUT an admin session — the login route is
      // `public`, and the enrollment/challenge routes (#1191/#1192) are reached
      // on a pending reference. A missing or "wrong" cookie there is the normal
      // state, not a refused admin route, so it owes no rejection row.
      if (isAdminAuthEntryRoute(req.url)) return;

      await this.audit.record({
        type: "AdminSessionRejected",
        sub: resolution.sub,
        reason: resolution.rejection,
      });
    });
  }
}
