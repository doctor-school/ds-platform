import type {
  CreatedUser,
  CreateUserInput,
  IdpClient,
  IdpRefreshResult,
  IdpSession,
  IdpTokens,
  IdpUser,
} from "./idp.types.js";

/**
 * The one OTP code the fake treats as valid. Tests submit this for the happy
 * path and anything else for the invalid/expired path (EARS-3/4).
 */
export const FAKE_VALID_CODE = "424242";

interface FakeRecord {
  sub: string;
  email?: string | undefined;
  phone?: string | undefined;
  emailVerified: boolean;
  phoneVerified: boolean;
  /** The BFF forwards the password to the IdP at create; the fake keeps it so the password check (EARS-5) is exercised. Never stored by `apps/api` itself (design §2). */
  password?: string | undefined;
}

/**
 * In-memory {@link IdpClient} (design §2 boundary made testable).
 *
 * It models exactly the Zitadel behaviours the domain logic branches on —
 * duplicate-identifier detection (enumeration safety, EARS-16), OTP code
 * verification (EARS-3/4), and a user list for the reconciliation sweep
 * (EARS-19) — with no network. It is the default binding when no Zitadel
 * credential is configured (the dev-stand has an empty `IDP_CLIENT_SECRET`), so
 * the BFF boots and the F1 flows run end-to-end against a real Postgres without
 * a live IdP. The real {@link ZitadelIdpClient} is bound when credentials exist.
 */
export class FakeIdpClient implements IdpClient {
  private readonly byEmail = new Map<string, FakeRecord>();
  private readonly byPhone = new Map<string, FakeRecord>();
  private readonly bySub = new Map<string, FakeRecord>();
  /** Checked sessions awaiting their OIDC exchange: zitadelSessionId → sub. */
  private readonly sessions = new Map<string, string>();
  /** Live (rotatable) refresh tokens → sub. Models the IdP-side refresh chain. */
  private readonly liveRefresh = new Map<string, string>();
  /** Refresh tokens already rotated once — replaying one is RFC-6819 reuse (EARS-9). */
  private readonly consumedRefresh = new Set<string>();
  /** Per-identifier failed-check tally — the fake's stand-in for the native Zitadel lockout counter (EARS-15), asserted by EARS-5 tests. */
  private readonly failed = new Map<string, number>();
  /** Subs with a live reset code → the code that completes it (EARS-11/12). Models Zitadel's forgot-password code flow; single-use, cleared on completion. */
  private readonly resetCodes = new Map<string, string>();
  private seq = 0;

  createUser(input: CreateUserInput): Promise<CreatedUser> {
    const email = input.email?.toLowerCase();
    const phone = input.phone;
    const existing =
      (email && this.byEmail.get(email)) ||
      (phone && this.byPhone.get(phone)) ||
      undefined;
    if (existing) {
      return Promise.resolve({ sub: existing.sub, alreadyExisted: true });
    }

    const sub = `fake-sub-${++this.seq}`;
    const record: FakeRecord = {
      sub,
      email,
      phone,
      emailVerified: false,
      phoneVerified: false,
      password: input.password,
    };
    this.bySub.set(sub, record);
    if (email) this.byEmail.set(email, record);
    if (phone) this.byPhone.set(phone, record);
    return Promise.resolve({ sub, alreadyExisted: false });
  }

  requestEmailVerification(_sub: string): Promise<void> {
    return Promise.resolve();
  }

  requestPhoneVerification(_sub: string): Promise<void> {
    return Promise.resolve();
  }

  verifyEmail(sub: string, code: string): Promise<boolean> {
    const record = this.bySub.get(sub);
    if (!record || code !== FAKE_VALID_CODE) return Promise.resolve(false);
    record.emailVerified = true;
    return Promise.resolve(true);
  }

  verifyPhone(sub: string, code: string): Promise<boolean> {
    const record = this.bySub.get(sub);
    if (!record || code !== FAKE_VALID_CODE) return Promise.resolve(false);
    record.phoneVerified = true;
    return Promise.resolve(true);
  }

  passwordLogin(
    identifier: string,
    password: string,
  ): Promise<IdpSession | null> {
    const record =
      this.byEmail.get(identifier.toLowerCase()) ?? this.byPhone.get(identifier);
    // Unknown identifier and wrong password are indistinguishable (EARS-16); a
    // failed check is tallied (the native Zitadel lockout counter, EARS-15).
    if (!record || record.password !== password) {
      this.failed.set(identifier, (this.failed.get(identifier) ?? 0) + 1);
      return Promise.resolve(null);
    }
    const zitadelSessionId = `fake-session-${++this.seq}`;
    this.sessions.set(zitadelSessionId, record.sub);
    return Promise.resolve({ zitadelSessionId, sub: record.sub });
  }

  exchangeSessionForTokens(zitadelSessionId: string): Promise<IdpTokens> {
    const sub = this.sessions.get(zitadelSessionId);
    if (!sub) {
      // Exchanging an unknown/consumed session is a programming error in the
      // BFF, not a user-facing path — fail loud rather than mint a token.
      return Promise.reject(new Error("unknown zitadel session"));
    }
    const refreshToken = `fake-refresh-${++this.seq}`;
    this.liveRefresh.set(refreshToken, sub);
    return Promise.resolve({
      accessToken: `fake-access-${zitadelSessionId}`,
      refreshToken,
      expiresInSeconds: 900,
      // v1 grants every self-serve principal the single `doctor_guest` role; the
      // `mfa` claim is present-but-false (the enforcement seam, design §7).
      claims: { sub, roles: ["doctor_guest"], mfa: false },
    });
  }

  refreshTokens(refreshToken: string): Promise<IdpRefreshResult> {
    // RFC-6819 reuse detection (EARS-9): replaying an already-consumed token —
    // or any token this IdP never issued — fails closed, so the BFF invalidates
    // the chain + revokes the session rather than minting a fresh one. The IdP
    // owns this detection (ADR-0001 §7).
    if (this.consumedRefresh.has(refreshToken))
      return Promise.resolve({ reuseDetected: true });
    const sub = this.liveRefresh.get(refreshToken);
    if (!sub) return Promise.resolve({ reuseDetected: true });

    // Single-use rotation: consume the presented token and mint a new chain link.
    this.liveRefresh.delete(refreshToken);
    this.consumedRefresh.add(refreshToken);
    const next = `fake-refresh-${++this.seq}`;
    this.liveRefresh.set(next, sub);
    return Promise.resolve({
      reuseDetected: false,
      tokens: {
        accessToken: `fake-access-r-${this.seq}`,
        refreshToken: next,
        expiresInSeconds: 900,
        claims: { sub, roles: ["doctor_guest"], mfa: false },
      },
    });
  }

  requestPasswordReset(identifier: string): Promise<void> {
    const record =
      this.byEmail.get(identifier.toLowerCase()) ?? this.byPhone.get(identifier);
    // A code is issued only for an existing identifier, but the resolution is
    // identical either way — an unknown identifier is a silent no-op, never a
    // throw, so the caller's response stays enumeration-safe (EARS-11/16).
    if (record) this.resetCodes.set(record.sub, FAKE_VALID_CODE);
    return Promise.resolve();
  }

  completePasswordReset(
    identifier: string,
    code: string,
    newPassword: string,
  ): Promise<{ sub: string } | null> {
    const record =
      this.byEmail.get(identifier.toLowerCase()) ?? this.byPhone.get(identifier);
    // Unknown identifier and invalid/expired code are indistinguishable (EARS-16).
    if (!record) return Promise.resolve(null);
    const expected = this.resetCodes.get(record.sub);
    if (!expected || expected !== code) return Promise.resolve(null);
    // The IdP is the only party that sets the password (design §2); the fake
    // updates its stored credential so a subsequent passwordLogin proves it.
    record.password = newPassword;
    this.resetCodes.delete(record.sub); // single-use code
    return Promise.resolve({ sub: record.sub });
  }

  /** Test accessor: how many failed password checks the fake recorded for `identifier`. */
  failedAttempts(identifier: string): number {
    return this.failed.get(identifier) ?? 0;
  }

  listUsers(): Promise<IdpUser[]> {
    return Promise.resolve(
      [...this.bySub.values()].map((r) => ({
        sub: r.sub,
        email: r.email,
        phone: r.phone,
        emailVerified: r.emailVerified,
        phoneVerified: r.phoneVerified,
      })),
    );
  }

  /**
   * Seed a user directly, bypassing the registration cascade — models a Zitadel
   * user whose create webhook was never delivered, so the reconciliation sweep
   * (EARS-19) has a divergence to close.
   */
  seedUser(input: { sub: string; email?: string; phone?: string }): void {
    const record: FakeRecord = {
      sub: input.sub,
      email: input.email?.toLowerCase(),
      phone: input.phone,
      emailVerified: false,
      phoneVerified: false,
    };
    this.bySub.set(record.sub, record);
    if (record.email) this.byEmail.set(record.email, record);
    if (record.phone) this.byPhone.set(record.phone, record);
  }
}
