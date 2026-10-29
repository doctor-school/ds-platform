import { createHash, randomBytes } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  SessionClaims,
  SignInHostStorefront,
  SignInHostDoor,
  StorefrontRedeemRequest,
  StorefrontSilentCheckRequest,
  StorefrontTransactionKind,
  StorefrontTransactionRequest,
  StorefrontTransactionResponse,
} from "@ds/schemas";
import {
  STOREFRONT_INTERACTIVE_TRANSACTION_SECONDS,
  STOREFRONT_SILENT_TRANSACTION_SECONDS,
} from "@ds/schemas";
import {
  AUTH_AUDIT,
  type AuthAuditLog,
} from "../auth/session/auth-audit.types.js";
import { RateLimitService } from "../auth/rate-limit/rate-limit.service.js";
import { STOREFRONT_SILENT_CHECK_RATE_LIMIT_SCOPE } from "../auth/rate-limit/rate-limit.types.js";
import { SessionService } from "../auth/session/session.service.js";
import {
  SharedSessionHub,
  type LinkedRefreshResult,
  type LinkedSessionRefresher,
} from "../auth/session/shared-session.js";
import { DEFAULT_OIDC_SCOPES } from "../auth/idp/zitadel.idp.js";
import {
  storefrontCallbackUrl,
  type SignInHostSettings,
} from "./sign-in-host.config.js";
import { recordVerdict } from "./sign-in-host.policy.js";
import { SignInHostRecordStore } from "./sign-in-host-record.store.js";
import {
  newOpaqueId,
  SIGN_IN_HOST_STATE_STORE,
  type SignInHostStateStore,
  type StorefrontTransaction,
} from "./sign-in-host-state.store.js";
import {
  SIGN_IN_HOST_CLOCK,
  SIGN_IN_HOST_SETTINGS,
  type SignInHostClock,
} from "./sign-in-host.tokens.js";
import { sameValue } from "./storefront-oidc.jwt.js";
import {
  STOREFRONT_OIDC_IDP,
  type StorefrontOidcIdp,
} from "./storefront-oidc.idp.js";

/** The one refusal of every redeem failure: nothing about which check failed leaves the API. */
export const REDEEM_REFUSED = "redeem refused";

/** RFC 7636 §4.2 `S256`: `BASE64URL(SHA256(verifier))`. */
export function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** What a redeem gives the storefront callback besides the session cookie. */
export interface RedeemOutcome {
  readonly cookie: string;
  readonly claims: SessionClaims;
  readonly returnPath: string | null;
  readonly door: SignInHostDoor;
  readonly kind: StorefrontTransactionKind;
  readonly completeRegistration: string | null;
}

/**
 * 003 EARS-8 (amended) / EARS-62 (API half) / EARS-71 (API half), ADR-0015
 * §4 steps 1 and 3 — what the storefront servers ask of the API:
 *
 * - create the entry's transaction (EARS-61): `state`, `nonce` and the PKCE
 *   verifier generated and held here, with the return path, the door and —
 *   for an entry that asks for more than the plain form — the entry intent
 *   bound to it (its opaque id becomes the authorize `login_hint`, EARS-71);
 * - redeem the callback's code against the browser's own transaction (taken
 *   single-use, `state` checked): Zitadel's token endpoint with the
 *   storefront client's `private_key_jwt` and the held verifier, the ID
 *   token's `nonce` against the transaction, its `sid` against a LIVE
 *   sign-in-host record — and only then a new storefront session, linked to
 *   that Zitadel session, expiring no later than it.
 */
@Injectable()
export class StorefrontOidcService
  implements LinkedSessionRefresher, OnModuleInit
{
  private readonly logger = new Logger(StorefrontOidcService.name);

  constructor(
    @Inject(SIGN_IN_HOST_SETTINGS)
    private readonly settings: SignInHostSettings | null,
    @Inject(SIGN_IN_HOST_STATE_STORE)
    private readonly state: SignInHostStateStore,
    @Inject(SignInHostRecordStore)
    private readonly records: SignInHostRecordStore,
    @Inject(STOREFRONT_OIDC_IDP) private readonly oidc: StorefrontOidcIdp,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SIGN_IN_HOST_CLOCK) private readonly clock: SignInHostClock,
    @Inject(SharedSessionHub) private readonly shared: SharedSessionHub,
    @Inject(AUTH_AUDIT) private readonly audit: AuthAuditLog,
    @Inject(RateLimitService) private readonly limiter: RateLimitService,
  ) {}

  onModuleInit(): void {
    // A disabled sign-in host mints no linked session; nothing to refresh.
    if (this.settings) this.shared.registerRefresher(this);
  }

  /**
   * 003 EARS-63, ADR-0015 §4 step 4 — the silent-check start: a silent
   * transaction (`prompt=none`, ≈60 s, single-use) on the sign-in door, no
   * intent, the request's path and query as its return path (none for the
   * EARS-62 recovery). Its route counts it in `oidc:silent-check`.
   */
  async createSilentCheck(
    req: StorefrontSilentCheckRequest,
  ): Promise<StorefrontTransactionResponse> {
    // EARS-63 (c) — the abandoned interactive transaction the browser still
    // names is deleted server-side (with its intent); the cookie now names
    // the silent one, and a sign-in finished in that form finds nothing.
    if (req.replaces) {
      const replaced = await this.state.takeTransaction(req.replaces);
      if (replaced?.intentId) await this.state.takeIntent(replaced.intentId);
    }
    return this.createTransaction({
      client: req.client,
      kind: "silent",
      door: "login",
      ...(req.returnPath ? { returnPath: req.returnPath } : {}),
    });
  }

  /**
   * 003 EARS-8 (amended) — a linked session's refresh token rotates through
   * the storefront client it was issued to, with that client's
   * `private_key_jwt`; the BFF client never presents it.
   */
  refreshLinked(
    client: SignInHostStorefront,
    refreshToken: string,
  ): Promise<LinkedRefreshResult> {
    return this.oidc.refreshTokens({
      clientId: this.clientIdOf(client),
      refreshToken,
    });
  }

  /** The storefront's one registered callback URI; 404 while the host is disabled. */
  private callbackOf(client: SignInHostStorefront): string {
    if (!this.settings) throw new NotFoundException();
    return storefrontCallbackUrl(this.settings, client);
  }

  /** The storefront's client id from the fixed per-environment map; 404 while the host is disabled. */
  private clientIdOf(client: SignInHostStorefront): string {
    if (!this.settings) throw new NotFoundException();
    for (const [clientId, storefront] of this.settings.clients) {
      if (storefront === client) return clientId;
    }
    throw new NotFoundException();
  }

  /**
   * EARS-61 / EARS-71 — a fresh transaction for the kind's lifetime; an
   * entry intent, when the entry carries one, is bound to it and to the
   * storefront's own client and lives exactly as long.
   */
  async createTransaction(
    req: StorefrontTransactionRequest,
  ): Promise<StorefrontTransactionResponse> {
    const clientId = this.clientIdOf(req.client);
    const ttl =
      req.kind === "interactive"
        ? STOREFRONT_INTERACTIVE_TRANSACTION_SECONDS
        : STOREFRONT_SILENT_TRANSACTION_SECONDS;
    const intentId = req.intent
      ? await this.state.putIntent(
          {
            door: req.door,
            method: req.intent.method,
            handoff: req.intent.handoff,
            eventTarget: req.intent.eventTarget,
            clientId,
          },
          ttl,
        )
      : undefined;
    // RFC 7636 §4.1: 32 random bytes → a 43-character verifier.
    const verifier = randomBytes(32).toString("base64url");
    const tx: StorefrontTransaction = {
      client: req.client,
      clientId,
      kind: req.kind,
      door: req.door,
      state: newOpaqueId(),
      nonce: newOpaqueId(),
      verifier,
      ...(req.returnPath ? { returnPath: req.returnPath } : {}),
      ...(req.completeRegistration
        ? { completeRegistration: req.completeRegistration }
        : {}),
      ...(intentId ? { intentId } : {}),
    };
    const txId = await this.state.putTransaction(tx, ttl);
    const url = new URL(this.oidc.authorizeEndpoint());
    const prompt =
      req.kind === "silent"
        ? "none"
        : req.door === "register"
          ? "create"
          : undefined;
    for (const [k, v] of [
      ["client_id", clientId],
      ["redirect_uri", this.callbackOf(req.client)],
      ["response_type", "code"],
      ["response_mode", "query"],
      ["scope", DEFAULT_OIDC_SCOPES.join(" ")],
      ["state", tx.state],
      ["nonce", tx.nonce],
      ["code_challenge", s256(verifier)],
      ["code_challenge_method", "S256"],
      ...(prompt ? [["prompt", prompt]] : []),
      ...(intentId ? [["login_hint", intentId]] : []),
    ] as const) {
      url.searchParams.set(k, v);
    }
    return { txId, authorizeUrl: url.href };
  }

  /**
   * EARS-62 / EARS-8 — take the browser's transaction (single use), check
   * `state`, redeem with the held verifier and nonce, check, mint. Every
   * failure is the one generic 401 and mints nothing; it carries the
   * transaction's return path and door when the browser named its own live
   * transaction, so the callback still lands where the person started.
   *
   * A callback whose `state` is not the browser's own transaction — no
   * transaction cookie, or another one (login CSRF, ADR-0015 §4 req. 3) — still
   * redeems before it answers: the transaction the `state` names is taken
   * (single use) and its code exchanged once with that transaction's held
   * verifier, the tokens discarded, so the code can never be presented again.
   */
  async redeem(
    req: StorefrontRedeemRequest,
    fingerprint: string,
    ip: string,
  ): Promise<RedeemOutcome> {
    const clientId = this.clientIdOf(req.client);
    const own = req.txId ? await this.state.takeTransaction(req.txId) : null;
    // The bound intent never outlives its transaction (EARS-71).
    if (own?.intentId) await this.state.takeIntent(own.intentId);
    const mine = own && own.clientId === clientId ? own : null;
    if (!mine || !sameValue(mine.state, req.state)) {
      return this.refuseForeignState(req, mine, ip);
    }
    const tx = mine;
    // 003 EARS-63 (f), req. 9 — a silent transaction's callback counts in the
    // silent path's own bucket; limited, it redeems nothing (the transaction
    // is already taken, so deleted) and ends as on `login_required`.
    if (tx.kind === "silent" && !this.admitSilent(ip)) throw refused(tx);
    // An OIDC error answer (the person aborted, `login_required`) carries no
    // code: the transaction is spent and nothing is minted. A transaction
    // without a verifier is never redeemed.
    if (!req.code || !tx.verifier) throw refused(tx);
    const tokens = await this.oidc.redeemCode({
      clientId,
      code: req.code,
      codeVerifier: tx.verifier,
      redirectUri: this.callbackOf(req.client),
    });
    if (!tokens) throw refused(tx);
    const { idToken } = tokens;
    if (!sameValue(idToken.nonce, tx.nonce)) {
      this.logger.warn("storefront redeem: nonce mismatch; tokens discarded");
      throw refused(tx);
    }
    // Req. 8: only a code our sign-in host finalised with a live record's
    // Zitadel session mints; Zitadel's own login UI, a dead or idle record,
    // or a record a later revocation of the subject ended, do not. The redeem
    // is a use of the record, so its client fingerprint is checked too
    // (EARS-64) by the one rule the sign-in host's own uses apply: a code
    // redeemed for another browser mints nothing (the record is left as is —
    // a stolen code must not be able to sign its owner out).
    const now = this.clock();
    const found = await this.records.findBySession(idToken.sub, idToken.sid);
    const revokedAt = found
      ? await this.state.subjectRevokedAt(idToken.sub)
      : null;
    // The reason is named in the internal log only; the answer stays the one
    // generic refusal.
    const verdict = found
      ? recordVerdict(found.record, now, fingerprint)
      : null;
    const reason = !found
      ? "no record holds the code's sid for its subject"
      : verdict !== "usable"
        ? `the record is ${verdict}`
        : revokedAt &&
            found.record.lastCredentialAt.getTime() < revokedAt.getTime()
          ? "the subject was revoked after the record's credential step"
          : null;
    if (!found || reason !== null) {
      this.logger.warn(
        `storefront redeem: the code's sid is not a live sign-in-host record (${reason}); tokens discarded`,
      );
      throw refused(tx);
    }
    const minted = await this.sessions.mintLinked({
      zitadelSessionId: idToken.sid,
      client: req.client,
      claims: { sub: idToken.sub, roles: idToken.roles, mfa: idToken.mfa },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      fingerprint,
      expiresAtMs: found.record.expiresAt.getTime(),
    });
    return {
      ...minted,
      returnPath: tx.returnPath ?? null,
      door: tx.door,
      kind: tx.kind,
      completeRegistration: tx.completeRegistration ?? null,
    };
  }

  /** One unit of the silent path's per-IP bucket (`oidc:silent-check`, req. 9). */
  private admitSilent(ip: string): boolean {
    return this.limiter.tryConsume({
      ip,
      scope: STOREFRONT_SILENT_CHECK_RATE_LIMIT_SCOPE,
    });
  }

  /**
   * EARS-62 (req. 3) — the callback's `state` is not the browser's own live
   * transaction. The transaction it names is spent and its code redeemed once
   * and discarded; nothing is minted. An unknown `state` names no
   * transaction, so no exchange runs: Zitadel's token endpoint checks the
   * code against the authorize request's PKCE `S256` challenge, and only the
   * API ever held that request's verifier — a code whose transaction is gone
   * (spent, expired, never ours) cannot be redeemed by anyone. A browser
   * transaction that names another `state` lends its own verifier instead
   * (the code can only be its own then).
   */
  private async refuseForeignState(
    req: StorefrontRedeemRequest,
    mine: StorefrontTransaction | null,
    ip: string,
  ): Promise<never> {
    const named = req.state
      ? await this.state.takeTransactionByState(req.state)
      : null;
    if (named?.intentId) await this.state.takeIntent(named.intentId);
    const spender = named ?? mine;
    if (!spender) throw refused(null);
    const discarded =
      req.code && spender.verifier
        ? await this.oidc.redeemCode({
            clientId: spender.clientId,
            code: req.code,
            codeVerifier: spender.verifier,
            redirectUri: this.callbackOf(spender.client),
          })
        : null;
    this.logger.warn(
      "security: storefront callback state is not the browser's transaction; transaction spent, tokens discarded",
    );
    // EARS-62 — the security audit event of a foreign `state`.
    await this.audit.record({
      type: "StorefrontCallbackRejected",
      sub: discarded?.idToken.sub ?? null,
      client: req.client,
      reason: "state_mismatch",
    });
    // 003 EARS-63 (b) — a client that keeps no cookies: the callback names no
    // transaction of its own and its `state` names a live SILENT one. That
    // transaction is spent above (its code redeemed and discarded); its return
    // path and kind come back so the callback lands there with `ds_guest=1` —
    // one round trip per navigation, never a loop.
    if (!req.txId && named?.kind === "silent") {
      this.admitSilent(ip);
      throw refused(named);
    }
    throw refused(mine);
  }
}

/** The one generic refusal (`StorefrontRedeemRefusal` body). */
function refused(tx: StorefrontTransaction | null): UnauthorizedException {
  return new UnauthorizedException({
    message: REDEEM_REFUSED,
    returnPath: tx?.returnPath ?? null,
    door: tx?.door ?? null,
    kind: tx?.kind ?? null,
  });
}
