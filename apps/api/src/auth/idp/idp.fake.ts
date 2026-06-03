import type {
  CreatedUser,
  CreateUserInput,
  IdpClient,
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
