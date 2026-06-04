import type {
  CreatedUser,
  CreateUserInput,
  IdpClient,
  IdpRefreshResult,
  IdpSession,
  IdpTokens,
  IdpUser,
  PasswordLoginResult,
} from "./idp.types.js";

/**
 * The one OTP code the fake treats as valid. Tests submit this for the happy
 * path and anything else for the invalid/expired path (EARS-3/4).
 */
export const FAKE_VALID_CODE = "424242";

/**
 * Failed-password attempts that trip the native lockout (EARS-15: 10 / 30 min).
 * The fake models the threshold (not the 30-min window — that is Zitadel's), so
 * the BFF's lockout *observation* (`auth.lockout.triggered`) is testable.
 */
export const FAKE_LOCKOUT_THRESHOLD = 10;

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
  /** Subs with a live email login-OTP challenge (EARS-6). Set on request, cleared on a successful verify — models Zitadel requiring a challenge before the check. */
  private readonly emailOtpChallenges = new Set<string>();
  /** Subs with a live SMS login-OTP challenge (EARS-7). */
  private readonly smsOtpChallenges = new Set<string>();
  /** How many times the BFF asked the (native) provider to send an SMS login code — the EARS-14 assertion hinge: a budget-refused send never reaches here. */
  private smsSends = 0;
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
  ): Promise<PasswordLoginResult> {
    const record =
      this.byEmail.get(identifier.toLowerCase()) ?? this.byPhone.get(identifier);

    // An existing account whose failure tally has reached the threshold is
    // soft-locked (EARS-15) — even a correct password is refused while locked,
    // matching the native policy. `justLocked` is false here (the lock already
    // tripped on an earlier attempt), so no duplicate `lockout.triggered`.
    if (record && (this.failed.get(identifier) ?? 0) >= FAKE_LOCKOUT_THRESHOLD) {
      return Promise.resolve({
        outcome: "locked",
        sub: record.sub,
        justLocked: false,
      });
    }

    // Unknown identifier and wrong password are indistinguishable (EARS-16); a
    // failed check is tallied (the native Zitadel lockout counter, EARS-15).
    if (!record || record.password !== password) {
      const count = (this.failed.get(identifier) ?? 0) + 1;
      this.failed.set(identifier, count);
      // The attempt that reaches the threshold trips the lock — but only for a
      // real account (an unknown identifier cannot be locked).
      if (record && count >= FAKE_LOCKOUT_THRESHOLD) {
        return Promise.resolve({
          outcome: "locked",
          sub: record.sub,
          justLocked: count === FAKE_LOCKOUT_THRESHOLD,
        });
      }
      return Promise.resolve({ outcome: "rejected" });
    }

    const zitadelSessionId = `fake-session-${++this.seq}`;
    this.sessions.set(zitadelSessionId, record.sub);
    return Promise.resolve({
      outcome: "authenticated",
      session: { zitadelSessionId, sub: record.sub },
    });
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

  private findByIdentifier(identifier: string): FakeRecord | undefined {
    return (
      this.byEmail.get(identifier.toLowerCase()) ?? this.byPhone.get(identifier)
    );
  }

  /** Mint a checked session for a sub that just passed an OTP login check (EARS-6/7). */
  private checkedSession(sub: string): IdpSession {
    const zitadelSessionId = `fake-session-${++this.seq}`;
    this.sessions.set(zitadelSessionId, sub);
    return { zitadelSessionId, sub };
  }

  requestEmailOtp(identifier: string): Promise<void> {
    // A challenge is armed only for an existing identifier, but the resolution is
    // identical either way (enumeration-safe, EARS-6/16) — an unknown identifier
    // is a silent no-op, never a throw.
    const record = this.findByIdentifier(identifier);
    if (record) this.emailOtpChallenges.add(record.sub);
    return Promise.resolve();
  }

  loginWithEmailOtp(
    identifier: string,
    code: string,
  ): Promise<IdpSession | null> {
    const record = this.findByIdentifier(identifier);
    // Unknown identifier, no live challenge, and wrong/expired code are all
    // indistinguishable (EARS-16): every miss resolves to null.
    if (
      !record ||
      !this.emailOtpChallenges.has(record.sub) ||
      code !== FAKE_VALID_CODE
    ) {
      return Promise.resolve(null);
    }
    this.emailOtpChallenges.delete(record.sub); // single-use
    return Promise.resolve(this.checkedSession(record.sub));
  }

  requestSmsOtp(identifier: string): Promise<void> {
    // The BFF calls this only after the EARS-14 budget allows the send, so every
    // call here is a real provider send — count it (the budget-refused path never
    // reaches this method). Whether a challenge is armed still depends on the
    // identifier existing, but the BFF cannot tell (enumeration-safe, EARS-7/16).
    this.smsSends++;
    const record = this.findByIdentifier(identifier);
    if (record) this.smsOtpChallenges.add(record.sub);
    return Promise.resolve();
  }

  loginWithSmsOtp(identifier: string, code: string): Promise<IdpSession | null> {
    const record = this.findByIdentifier(identifier);
    if (
      !record ||
      !this.smsOtpChallenges.has(record.sub) ||
      code !== FAKE_VALID_CODE
    ) {
      return Promise.resolve(null);
    }
    this.smsOtpChallenges.delete(record.sub);
    return Promise.resolve(this.checkedSession(record.sub));
  }

  /** Test accessor: how many SMS login codes the BFF asked the provider to send. */
  smsOtpSendCount(): number {
    return this.smsSends;
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
