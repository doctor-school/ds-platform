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
  ) {}

  onModuleInit(): void {
    // A disabled sign-in host mints no linked session; nothing to refresh.
    if (this.settings) this.shared.registerRefresher(this);
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
   */
  async redeem(
    req: StorefrontRedeemRequest,
    fingerprint: string,
  ): Promise<RedeemOutcome> {
    const clientId = this.clientIdOf(req.client);
    const tx = await this.state.takeTransaction(req.txId);
    // The bound intent never outlives its transaction (EARS-71).
    if (tx?.intentId) await this.state.takeIntent(tx.intentId);
    if (!tx || tx.clientId !== clientId) throw refused(null);
    if (!sameValue(tx.state, req.state)) {
      // A `state` that is not this browser's transaction (login CSRF, ADR-0015
      // §4 req. 3): the code is still spent with this transaction's verifier
      // and its tokens discarded; the transaction is burnt (taken above).
      const discarded = req.code
        ? await this.oidc.redeemCode({
            clientId,
            code: req.code,
            codeVerifier: tx.verifier,
            redirectUri: this.callbackOf(req.client),
          })
        : null;
      this.logger.warn(
        "security: storefront callback state does not match the browser's transaction; transaction burnt, tokens discarded",
      );
      // EARS-62 — the security audit event of a foreign `state`.
      await this.audit.record({
        type: "StorefrontCallbackRejected",
        sub: discarded?.idToken.sub ?? null,
        client: req.client,
        reason: "state_mismatch",
      });
      throw refused(tx);
    }
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
      completeRegistration: tx.completeRegistration ?? null,
    };
  }
}

/** The one generic refusal (`StorefrontRedeemRefusal` body). */
function refused(tx: StorefrontTransaction | null): UnauthorizedException {
  return new UnauthorizedException({
    message: REDEEM_REFUSED,
    returnPath: tx?.returnPath ?? null,
    door: tx?.door ?? null,
  });
}
