import type { Mailer } from "../../mailer/mailer.types.js";
import {
  IdpInvalidArgumentError,
  type CreatedUser,
  type CreateUserInput,
  type EmailLoginOutcome,
  type IdpClient,
  type IdpRefreshResult,
  type IdpSession,
  type IdpTokens,
  type IdpUser,
  type PasswordLoginResult,
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
  /** #753: whether Zitadel reports the account active. A deactivated record stays enumerable (the sweep must see it as present-but-inactive). */
  active: boolean;
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
  /**
   * #910/#1045 (EARS-29): the BFF mailer the verify/reset send hops deliver
   * the (fake, {@link FAKE_VALID_CODE}) one-time code through — mirroring the
   * real adapter's `returnCode` → mailer hand-off so the e2e matrix proves
   * "exactly one BFF-composed code email per trigger" without a live Zitadel.
   * Optional for legacy direct construction (specs that assert only on domain
   * state): without a mailer the code paths behave as before (codes are armed
   * in-memory; nothing is "delivered").
   */
  constructor(private readonly mailer?: Mailer) {}

  private readonly byEmail = new Map<string, FakeRecord>();
  private readonly byPhone = new Map<string, FakeRecord>();
  private readonly bySub = new Map<string, FakeRecord>();
  /**
   * Checked sessions awaiting their OIDC exchange: `zitadelSessionId` → the sub
   * plus the `sessionToken` minted for that session. The fake plays the IdP's own
   * session store, so it records the token it minted and the exchange VALIDATES
   * the token presented on the {@link IdpSession} handle against it (#143) — the
   * fake is no more permissive than the real adapter, which fails closed on a
   * missing/wrong proof-of-check token.
   */
  private readonly sessions = new Map<
    string,
    { sub: string; sessionToken: string }
  >();
  /** Live (rotatable) refresh tokens → sub. Models the IdP-side refresh chain. */
  private readonly liveRefresh = new Map<string, string>();
  /** Refresh tokens already rotated once — replaying one is RFC-6819 reuse (EARS-9). */
  private readonly consumedRefresh = new Set<string>();
  /** Per-identifier failed-check tally — the fake's stand-in for the native Zitadel lockout counter (EARS-15), asserted by EARS-5 tests. */
  private readonly failed = new Map<string, number>();
  /** Subs with a live reset code → the code that completes it (EARS-11/12). Models Zitadel's forgot-password code flow; single-use, cleared on completion. */
  private readonly resetCodes = new Map<string, string>();
  /**
   * #157: project roles actually granted per `sub`, recorded by
   * {@link grantProjectRole}. The token/refresh claims surface ONLY these roles
   * (empty if never granted) — modelling Zitadel asserting
   * `urn:zitadel:iam:org:project:roles` only for granted roles. This replaces the
   * old hardcoded `roles:["doctor_guest"]`, which masked the missing real grant:
   * with this Map the default e2e/unit matrix only sees `doctor_guest` once one
   * of the three write paths (register / webhook / sweep) has actually granted it.
   */
  private readonly grants = new Map<string, Set<string>>();
  /** Subs with a live email login-OTP challenge (EARS-6). Set on request, cleared on a successful verify — models Zitadel requiring a challenge before the check. */
  private readonly emailOtpChallenges = new Set<string>();
  /** Subs with a live SMS login-OTP challenge (EARS-7). */
  private readonly smsOtpChallenges = new Set<string>();
  /** How many times the BFF asked the (native) provider to send an SMS login code — the EARS-14 assertion hinge: a budget-refused send never reaches here. */
  private smsSends = 0;
  private seq = 0;
  /**
   * #1128: whether {@link createUser} echoes a create-time verification code
   * (models Zitadel's `returnCode` echo on CreateUser). Default `true` — the
   * happy path where registration delivers the create-time code with no second
   * generation. {@link setCreateReturnsCode}(false) models a code-less create
   * response, driving the register cascade's fallback resend hop.
   */
  private createReturnsCode = true;
  /**
   * #1128: how many times {@link requestEmailVerification} had to REGENERATE a
   * code (called with no pre-obtained code → the fallback resend path). The
   * single-code happy path never increments this; the code-less-create fallback
   * increments it once — the assertion hinge for "no second code generation".
   */
  private emailCodeRegenerations = 0;

  createUser(input: CreateUserInput): Promise<CreatedUser> {
    // #202 fake/real parity (the regression net): real Zitadel hard-rejects a
    // human-user create with no email (`invalid AddHumanUserRequest.Email: value
    // is required`), so the fake MUST be no more permissive — a no-email create
    // raises the SAME typed deterministic-invalid-argument error the real adapter
    // raises, exercising the service's enumeration-safe mapping (never a 500) and
    // failing a future phone-only-registration regression in unit tests, not only
    // live. (Before #202 the fake accepted phone-only, which masked the broken
    // vertical that shipped register-by-phone 500-broken.)
    if (input.email == null || input.email === "") {
      return Promise.reject(
        new IdpInvalidArgumentError(
          "fake createUser: email is required (mirrors Zitadel)",
        ),
      );
    }
    const email = input.email.toLowerCase();
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
      active: true,
      password: input.password,
    };
    this.bySub.set(sub, record);
    if (email) this.byEmail.set(email, record);
    if (phone) this.byPhone.set(phone, record);
    // #1128: echo the create-time verification code (fake/real parity — the real
    // adapter reads it off the CreateUser `emailCode`). Suppressed when
    // `createReturnsCode` is false, modelling a code-less create response.
    return Promise.resolve({
      sub,
      alreadyExisted: false,
      verificationCode: this.createReturnsCode ? FAKE_VALID_CODE : undefined,
    });
  }

  async requestEmailVerification(
    sub: string,
    email?: string,
    code?: string,
  ): Promise<void> {
    // #1128 fake/real parity: when the caller holds the create-time `code`, mail
    // it DIRECTLY (no regeneration). When it is absent, the real adapter falls
    // back to the resend hop that regenerates — the fake models that regeneration
    // by counting it (the "no second code generation" assertion hinge). The
    // fake's code authority is FAKE_VALID_CODE (what verifyEmail accepts), so a
    // regenerated code is FAKE_VALID_CODE too. A mailer failure propagates, like
    // the real adapter's (EARS-29/30).
    if (code == null) this.emailCodeRegenerations++;
    const codeToSend = code ?? FAKE_VALID_CODE;
    const to = email ?? this.bySub.get(sub)?.email;
    if (this.mailer && to) {
      await this.mailer.sendVerificationCodeEmail(to, codeToSend);
    }
  }

  /**
   * #1128 test control: make {@link createUser} omit (false) or echo (true) the
   * create-time verification code, so the register cascade's single-code happy
   * path and its code-less-create fallback are both exercisable off the fake.
   */
  setCreateReturnsCode(returns: boolean): void {
    this.createReturnsCode = returns;
  }

  /**
   * #1128 test accessor: how many times {@link requestEmailVerification} had to
   * regenerate a code (fell back because no create-time code was supplied). Zero
   * on the single-code happy path.
   */
  emailVerificationRegenerations(): number {
    return this.emailCodeRegenerations;
  }

  async resendEmailVerification(identifier: string): Promise<boolean> {
    // EARS-25 fake/real parity (no more permissive than the real adapter): a
    // code is re-issued ONLY for an existing, UNVERIFIED registrant. The real
    // Zitadel adapter resolves the identifier and skips an already-verified one
    // (its User v2 search carries `human.email.isVerified`); the fake mirrors that
    // exact unverified-vs-verified distinction off its own `emailVerified` flag,
    // so a regression that re-sends to a verified (or unknown) identifier fails in
    // unit tests, not only live. Every path resolves (never throws) so the caller
    // stays enumeration-safe (EARS-16); the boolean drives only the server-side
    // `otp.sent` ledger decision, never the response.
    const record = this.findByIdentifier(identifier);
    if (!record || record.emailVerified) return false;
    // EARS-29: the re-issued code rides the BFF mailer (same §13.3 artifact as
    // the initial send). A mailer failure = no code delivered = `false`, the
    // real adapter's exact swallow (EARS-30: nothing thrown, nothing leaked).
    if (this.mailer) {
      const to = record.email ?? identifier;
      try {
        await this.mailer.sendVerificationCodeEmail(to, FAKE_VALID_CODE);
      } catch {
        return false;
      }
    }
    return true;
  }

  requestPhoneVerification(_sub: string): Promise<void> {
    // #202: registration is email-only, so the BFF never calls this at register.
    // The method stays on the port for the future post-registration
    // secondary-phone verification path; the fake is a no-op.
    return Promise.resolve();
  }

  verifyEmail(sub: string, code: string): Promise<boolean> {
    const record = this.bySub.get(sub);
    if (!record || code !== FAKE_VALID_CODE) return Promise.resolve(false);
    record.emailVerified = true;
    return Promise.resolve(true);
  }

  markEmailVerified(sub: string): Promise<boolean> {
    // EARS-35 fake/real parity: the code-less proof-of-mailbox flip. Idempotent —
    // resolves `true` ONLY when it actually changed state (unverified → verified),
    // so the caller emits exactly one terminal `auth.account.verified` row and no
    // duplicate on a re-run. An unknown sub, or an already-verified one, is a
    // `false` no-op — mirroring the real adapter's SetEmail(isVerified) skip.
    const record = this.bySub.get(sub);
    if (!record || record.emailVerified) return Promise.resolve(false);
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
      this.byEmail.get(identifier.toLowerCase()) ??
      this.byPhone.get(identifier);

    // An existing account whose failure tally has reached the threshold is
    // soft-locked (EARS-15) — even a correct password is refused while locked,
    // matching the native policy. `justLocked` is false here (the lock already
    // tripped on an earlier attempt), so no duplicate `lockout.triggered`.
    if (
      record &&
      (this.failed.get(identifier) ?? 0) >= FAKE_LOCKOUT_THRESHOLD
    ) {
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

    return Promise.resolve({
      outcome: "authenticated",
      session: this.checkedSession(record.sub),
    });
  }

  exchangeSessionForTokens(session: IdpSession): Promise<IdpTokens> {
    const minted = this.sessions.get(session.zitadelSessionId);
    if (!minted) {
      // Exchanging an unknown/consumed session is a programming error in the
      // BFF, not a user-facing path — fail loud rather than mint a token.
      return Promise.reject(new Error("unknown zitadel session"));
    }
    // #143 fake/real parity (no more permissive than the real adapter): the real
    // ZitadelIdpClient links the OIDC auth request with the proof-of-check
    // `sessionToken` and fails closed on a missing/wrong one. Validate the token
    // presented on the port handle against the one this fake minted for the
    // session — a tampered or omitted token must fail, not mint, so a regression
    // that drops the end-to-end token thread is caught in unit tests.
    if (!session.sessionToken || session.sessionToken !== minted.sessionToken) {
      return Promise.reject(new Error("checked-session token mismatch"));
    }
    const sub = minted.sub;
    const refreshToken = `fake-refresh-${++this.seq}`;
    this.liveRefresh.set(refreshToken, sub);
    return Promise.resolve({
      accessToken: `fake-access-${session.zitadelSessionId}`,
      refreshToken,
      expiresInSeconds: 900,
      // #157: roles reflect ONLY what was actually granted via grantProjectRole
      // for this sub (empty if never granted) — not a hardcoded literal. The
      // `mfa` claim is present-but-false (the enforcement seam, design §7).
      claims: { sub, roles: this.grantedRoles(sub), mfa: false },
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
        // #157: granted roles only (see exchangeSessionForTokens) — a rotated
        // token carries exactly what the original did.
        claims: { sub, roles: this.grantedRoles(sub), mfa: false },
      },
    });
  }

  /**
   * #157: authorize `sub` for `roleKey` — idempotent (a repeated grant is a
   * no-op, mirroring Zitadel's ALREADY_EXISTS). After this the sub's exchanged /
   * refreshed token claims carry `roleKey`; before any grant they are empty.
   */
  grantProjectRole(sub: string, roleKey: string): Promise<void> {
    let roles = this.grants.get(sub);
    if (!roles) {
      roles = new Set<string>();
      this.grants.set(sub, roles);
    }
    roles.add(roleKey);
    return Promise.resolve();
  }

  /**
   * Test accessor: revoke `roleKey` from `sub` (idempotent — revoking an
   * ungranted role is a no-op, mirroring Zitadel's NOT_FOUND swallow). Models a
   * principal that holds a role WITHOUT the auto-granted `doctor_guest` baseline
   * (e.g. an operator provisioned `platform_admin`-only), so the authz classifier
   * for the session-self surface can be exercised against a single-role grant.
   */
  revokeProjectRole(sub: string, roleKey: string): Promise<void> {
    this.grants.get(sub)?.delete(roleKey);
    return Promise.resolve();
  }

  /** Test accessor: the project roles granted to `sub` (empty if none). */
  grantedRoles(sub: string): string[] {
    return [...(this.grants.get(sub) ?? [])];
  }

  private findByIdentifier(identifier: string): FakeRecord | undefined {
    return (
      this.byEmail.get(identifier.toLowerCase()) ?? this.byPhone.get(identifier)
    );
  }

  /**
   * Mint a checked session for a sub that just passed a login check (password
   * EARS-5, or OTP EARS-6/7). Records the minted `sessionToken` server-side so the
   * downstream {@link exchangeSessionForTokens} can validate the token presented
   * on the port handle against it (#143 — the fake plays the IdP's session store),
   * and threads the same token onto the returned {@link IdpSession} handle.
   */
  private checkedSession(sub: string): IdpSession {
    const zitadelSessionId = `fake-session-${++this.seq}`;
    const sessionToken = `fake-session-token-${this.seq}`;
    this.sessions.set(zitadelSessionId, { sub, sessionToken });
    return { zitadelSessionId, sub, sessionToken };
  }

  requestEmailOtp(identifier: string): Promise<void> {
    // A challenge is armed only for an existing identifier, but the resolution is
    // identical either way (enumeration-safe, EARS-6/16) — an unknown identifier
    // is a silent no-op, never a throw.
    const record = this.findByIdentifier(identifier);
    if (record) this.emailOtpChallenges.add(record.sub);
    return Promise.resolve();
  }

  async requestEmailLoginCode(identifier: string): Promise<EmailLoginOutcome> {
    // EARS-34 fake/real parity (no more permissive than the real adapter): the
    // real ZitadelIdpClient resolves the identifier + `human.email.isVerified` and
    // routes VERIFIED → arm otp_email, existing-UNVERIFIED → out-of-band
    // verification mail, unknown → no-op. The fake mirrors that exact three-way
    // split off its own `emailVerified` flag so a regression that arms a challenge
    // for an unverified account (the historic dead-end) fails in unit tests, not
    // only live. Every path resolves (never throws) so the caller stays
    // enumeration-safe (EARS-16).
    const record = this.findByIdentifier(identifier);
    if (!record) return "none";
    if (record.emailVerified) {
      // Existing + verified: arm the otp_email login challenge, exactly as
      // requestEmailOtp does — the branch EARS-6 leaves unchanged.
      this.emailOtpChallenges.add(record.sub);
      return "challenge";
    }
    // Existing + unverified: re-issue the verify-to-sign-in code and dispatch the
    // branded §13.3 mail. The real adapter fires this off the response path; the
    // fake awaits it (no real latency) so the assertion sees the recorded send —
    // and swallows a send failure the same way (EARS-31), since the code WAS
    // issued so the outcome is still "verification" (the ledger row is owed).
    if (this.mailer) {
      const to = record.email ?? identifier;
      try {
        await this.mailer.sendVerificationCodeEmail(to, FAKE_VALID_CODE);
      } catch {
        // Fire-and-forget parity: a delivery failure never changes the outcome —
        // the code was issued, so the caller still writes the otp.sent row.
      }
    }
    return "verification";
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

  loginWithSmsOtp(
    identifier: string,
    code: string,
  ): Promise<IdpSession | null> {
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

  /**
   * #202 test helper: attach a phone to an already-created user, modelling the
   * future post-registration secondary-identifier flow. Registration is
   * email-primary (no phone at create), but login-by-phone + SMS-OTP login
   * (EARS-7) operate on an attached phone — tests register by email, then attach
   * a phone here so the phone resolves for the login paths. Mirrors a real
   * `users/{id}/phone` add without exercising the (removed) phone-register branch.
   */
  attachPhone(sub: string, phone: string): void {
    const record = this.bySub.get(sub);
    if (!record) throw new Error(`attachPhone: unknown sub ${sub}`);
    record.phone = phone;
    this.byPhone.set(phone, record);
  }

  async requestPasswordReset(identifier: string): Promise<void> {
    const record =
      this.byEmail.get(identifier.toLowerCase()) ??
      this.byPhone.get(identifier);
    // A code is issued only for an existing identifier, but the resolution is
    // identical either way — an unknown identifier is a silent no-op, never a
    // throw, so the caller's response stays enumeration-safe (EARS-11/16).
    if (!record) return;
    this.resetCodes.set(record.sub, FAKE_VALID_CODE);
    // EARS-29: the code rides the BFF mailer as the §13.4 artifact, to the
    // user's STORED email (a phone-keyed reset still emails the account email).
    // A mailer failure is swallowed — the real adapter's exact contract
    // (EARS-30/16: void either way, nothing thrown, nothing leaked).
    if (this.mailer && record.email) {
      try {
        await this.mailer.sendPasswordResetCodeEmail(
          record.email,
          FAKE_VALID_CODE,
        );
      } catch {
        // swallowed by design (enumeration-safe void)
      }
    }
  }

  completePasswordReset(
    identifier: string,
    code: string,
    newPassword: string,
  ): Promise<IdpSession | null> {
    const record =
      this.byEmail.get(identifier.toLowerCase()) ??
      this.byPhone.get(identifier);
    // Unknown identifier and invalid/expired code are indistinguishable (EARS-16).
    if (!record) return Promise.resolve(null);
    const expected = this.resetCodes.get(record.sub);
    if (!expected || expected !== code) return Promise.resolve(null);
    // The IdP is the only party that sets the password (design §2); the fake
    // updates its stored credential so a subsequent passwordLogin proves it.
    record.password = newPassword;
    this.resetCodes.delete(record.sub); // single-use code
    // #221: a completed reset auto-logs-in — hand back a CHECKED session (the same
    // shape passwordLogin yields) so the BFF mints a fresh session via the shared
    // establishment hop. The fake is no more permissive than the real adapter,
    // which likewise mints a post-reset session only after the password is set.
    return Promise.resolve(this.checkedSession(record.sub));
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
        active: r.active,
      })),
    );
  }

  getUser(sub: string): Promise<IdpUser | null> {
    // EARS-26 (#709): targeted per-sub read for the read-path mirror self-heal.
    // Mirrors the real adapter's fail-soft contract: an unknown sub is `null`,
    // never a throw.
    const r = this.bySub.get(sub);
    if (!r) return Promise.resolve(null);
    return Promise.resolve({
      sub: r.sub,
      email: r.email,
      phone: r.phone,
      emailVerified: r.emailVerified,
      phoneVerified: r.phoneVerified,
      active: r.active,
    });
  }

  /**
   * Seed a user directly, bypassing the registration cascade — models a Zitadel
   * user whose create webhook was never delivered, so the reconciliation sweep
   * (EARS-19) has a divergence to close. `active` defaults true; pass
   * `active: false` to seed a present-but-deactivated user (#753).
   */
  seedUser(input: {
    sub: string;
    email?: string;
    phone?: string;
    active?: boolean;
  }): void {
    const record: FakeRecord = {
      sub: input.sub,
      email: input.email?.toLowerCase(),
      phone: input.phone,
      emailVerified: false,
      phoneVerified: false,
      active: input.active ?? true,
    };
    this.bySub.set(record.sub, record);
    if (record.email) this.byEmail.set(record.email, record);
    if (record.phone) this.byPhone.set(record.phone, record);
  }

  /**
   * #753 test control: flip a user's Zitadel `state` between active and
   * inactive. A deactivated user stays enumerable by {@link listUsers} (present
   * but `active: false`) so the sweep sees the deactivation; reactivating clears
   * it so the sweep can restore the mirror row. Unknown sub throws (a test bug).
   */
  setActive(sub: string, active: boolean): void {
    const record = this.bySub.get(sub);
    if (!record) throw new Error(`setActive: unknown sub ${sub}`);
    record.active = active;
  }

  /**
   * #753 test control: model a user **hard-deleted** in Zitadel — it drops out
   * of the enumeration entirely (not merely inactive), which the sweep detects
   * as an absent sub and soft-deletes the mirror row for.
   */
  removeUser(sub: string): void {
    const record = this.bySub.get(sub);
    if (!record) return;
    this.bySub.delete(sub);
    if (record.email) this.byEmail.delete(record.email);
    if (record.phone) this.byPhone.delete(record.phone);
  }

  /** #753 test/seed helper: update a user's identity fields, modelling a Zitadel-side edit the sweep must reconcile onto the mirror (Zitadel-wins). */
  setIdentity(
    sub: string,
    fields: {
      email?: string;
      phone?: string;
      emailVerified?: boolean;
      phoneVerified?: boolean;
    },
  ): void {
    const record = this.bySub.get(sub);
    if (!record) throw new Error(`setIdentity: unknown sub ${sub}`);
    if (fields.email !== undefined) {
      if (record.email) this.byEmail.delete(record.email);
      record.email = fields.email.toLowerCase();
      this.byEmail.set(record.email, record);
    }
    if (fields.phone !== undefined) {
      if (record.phone) this.byPhone.delete(record.phone);
      record.phone = fields.phone;
      this.byPhone.set(record.phone, record);
    }
    if (fields.emailVerified !== undefined)
      record.emailVerified = fields.emailVerified;
    if (fields.phoneVerified !== undefined)
      record.phoneVerified = fields.phoneVerified;
  }
}
