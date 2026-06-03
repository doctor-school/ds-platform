/**
 * IdP port (design §1, §2 — the native-vs-custom boundary).
 *
 * Every credential operation — user creation, OTP send/verify, password — is
 * **native Zitadel**, consumed through this interface and never reimplemented in
 * `apps/api` (Constraints; ADR-0001 §8). The BFF depends on this port, not on a
 * concrete Zitadel SDK, so (a) the domain logic (registration cascade, mirror
 * sync, verification) is unit-testable against an in-memory fake with a real
 * Postgres, and (b) a Zitadel API/version change is absorbed in one adapter.
 *
 * F1 (#85) needs the create + verify + list surface below; later iterations
 * (F2 session, F3 OTP login, F5 reset) extend the same port.
 */

/** Input to create a Zitadel user with a single primary identifier. */
export interface CreateUserInput {
  email?: string | undefined;
  phone?: string | undefined;
  /** The BFF forwards this to Zitadel; it never stores or hashes it (design §2). */
  password: string;
}

/**
 * Result of a create attempt. `alreadyExisted` is the enumeration-safety hinge
 * (EARS-1/16): a duplicate identifier resolves here, not to an error the caller
 * could turn into a distinguishable response. On the duplicate path `sub` may be
 * empty — the caller does not create a mirror row or send a code, it only needs
 * to know it must respond identically to the success path.
 */
export interface CreatedUser {
  sub: string;
  alreadyExisted: boolean;
}

/** A Zitadel user as seen by the reconciliation sweep (EARS-19). */
export interface IdpUser {
  sub: string;
  email?: string | undefined;
  phone?: string | undefined;
  emailVerified: boolean;
  phoneVerified: boolean;
}

export interface IdpClient {
  /** Create a user; a duplicate identifier returns `alreadyExisted: true`, not a throw. */
  createUser(input: CreateUserInput): Promise<CreatedUser>;
  /** Trigger a Zitadel `otp_email` verification code (EARS-1). */
  requestEmailVerification(sub: string): Promise<void>;
  /** Trigger a Zitadel `otp_sms` verification code (EARS-2). */
  requestPhoneVerification(sub: string): Promise<void>;
  /** Verify an email OTP code via Zitadel `otp_email` (EARS-3); `false` = invalid/expired. */
  verifyEmail(sub: string, code: string): Promise<boolean>;
  /** Verify an SMS OTP code via Zitadel `otp_sms` (EARS-4); `false` = invalid/expired. */
  verifyPhone(sub: string, code: string): Promise<boolean>;
  /** Enumerate users for the reconciliation sweep (EARS-19). */
  listUsers(): Promise<IdpUser[]>;
}

/** DI token the port is bound to — rebound to the real Zitadel adapter in prod. */
export const IDP_CLIENT = Symbol("IDP_CLIENT");
