// #2063 — the identity-provider side of the golden dataset.
//
// The seed does NOT create IdP accounts. Staging tech spec §4 is explicit: no
// silent creation with generated passwords. A password that the seed invents is
// either committed to the repository (a leak) or discarded (an account nobody
// can sign in as), and either way the golden accounts stop being a fixture the
// regression suite can rely on.
//
// So the contract is inverted: the box's `infra/dev-stand/idp` converge owns the
// accounts, the environment carries their subject ids, and this module refuses
// to let the seed run when any of them is missing. `users.zitadel_sub` is then a
// MIRROR of a real subject rather than an invented one, which is what makes a
// scenario sign-in against a golden account work at all.

import { GOLDEN_ACCOUNT_KEYS, type GoldenAccountKey } from "./ids.js";

/** What the converge must have provisioned before `seed:golden` may run. */
export interface GoldenIdpAccount {
  key: GoldenAccountKey;
  /** Login the account signs in with; equals the mirrored `users.email`. */
  username: string;
  /** `users.role` the mirror row carries. */
  role: "doctor_guest" | "platform_admin";
  /** `users.email_verified` — the storefront's «подтвердите почту» fork. */
  emailVerified: boolean;
  /**
   * Second factor enrolled at the IdP. There is no column for this: MFA lives
   * entirely in Zitadel, so it is an account property here and NOT a property of
   * the mirror row. A scenario that drives the MFA challenge signs in as this
   * account; nothing in `users` distinguishes it from a plain verified doctor.
   */
  mfaEnrolled: boolean;
  /**
   * `false` for the soft-deleted doctor: the platform row is retired and no live
   * IdP account should exist for it. Its subject id is still declared, because
   * `users.zitadel_sub` is NOT NULL and must stay stable across rebuilds — any
   * stable opaque string does.
   */
  idpAccountExpected: boolean;
  /** Environment variable holding the account's Zitadel subject id. */
  subjectEnvVar: string;
  /**
   * Environment variable holding the account's password. The SEED never reads
   * it — it is the scenario runner's (step 7) input. Named here so the catalogue
   * of golden credentials lives in exactly one place. Values are never committed.
   */
  passwordEnvVar: string;
}

export const GOLDEN_IDP_ACCOUNTS: readonly GoldenIdpAccount[] = Object.freeze([
  Object.freeze({
    key: "doctorUnverified" as GoldenAccountKey,
    username: "golden.doctor.unverified@example.test",
    role: "doctor_guest" as const,
    emailVerified: false,
    mfaEnrolled: false,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_UNVERIFIED",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED",
  }),
  Object.freeze({
    key: "doctorVerified" as GoldenAccountKey,
    username: "golden.doctor.verified@example.test",
    role: "doctor_guest" as const,
    emailVerified: true,
    mfaEnrolled: false,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_VERIFIED",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED",
  }),
  Object.freeze({
    key: "doctorMfa" as GoldenAccountKey,
    username: "golden.doctor.mfa@example.test",
    role: "doctor_guest" as const,
    emailVerified: true,
    mfaEnrolled: true,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_MFA",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_MFA",
  }),
  Object.freeze({
    key: "doctorDeleted" as GoldenAccountKey,
    username: "golden.doctor.deleted@example.test",
    role: "doctor_guest" as const,
    emailVerified: true,
    mfaEnrolled: false,
    idpAccountExpected: false,
    subjectEnvVar: "DS_GOLDEN_SUB_DOCTOR_DELETED",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_DOCTOR_DELETED",
  }),
  Object.freeze({
    key: "admin" as GoldenAccountKey,
    username: "golden.admin@example.test",
    role: "platform_admin" as const,
    emailVerified: true,
    mfaEnrolled: true,
    idpAccountExpected: true,
    subjectEnvVar: "DS_GOLDEN_SUB_ADMIN",
    passwordEnvVar: "DS_GOLDEN_PASSWORD_ADMIN",
  }),
]);

/** Raised when the golden accounts are not provisioned — the seed must abort. */
export class GoldenIdpError extends Error {
  readonly missing: readonly string[];
  constructor(message: string, missing: readonly string[] = []) {
    super(message);
    this.name = "GoldenIdpError";
    this.missing = Object.freeze([...missing]);
  }
}

export type GoldenSubjectMap = Readonly<Record<GoldenAccountKey, string>>;

/** Env vars that carry a subject id but are absent or blank. */
export function missingSubjectEnvVars(
  env: Record<string, string | undefined>,
): string[] {
  return GOLDEN_IDP_ACCOUNTS.filter(
    (account) => (env[account.subjectEnvVar] ?? "").trim() === "",
  ).map((account) => account.subjectEnvVar);
}

/**
 * Reads the declared subject ids, or throws.
 *
 * Fails closed on a duplicate as well as on an absence: two golden accounts
 * sharing a subject would collide on `users_zitadel_sub_unique` halfway through
 * the seed, leaving a partially written template that still looks buildable.
 */
export function resolveGoldenSubjects(
  env: Record<string, string | undefined> = process.env,
): GoldenSubjectMap {
  const missing = missingSubjectEnvVars(env);
  if (missing.length > 0) {
    throw new GoldenIdpError(
      `golden IdP accounts are not provisioned — set ${missing.join(", ")} (see packages/db/src/seed/golden/README.md); the seed never creates IdP users`,
      missing,
    );
  }

  const subjects = {} as Record<GoldenAccountKey, string>;
  const seen = new Map<string, GoldenAccountKey>();
  for (const account of GOLDEN_IDP_ACCOUNTS) {
    const subject = (env[account.subjectEnvVar] as string).trim();
    const clash = seen.get(subject);
    if (clash !== undefined) {
      throw new GoldenIdpError(
        `golden IdP subjects must be distinct: ${account.subjectEnvVar} repeats the value of the ${clash} account`,
      );
    }
    seen.set(subject, account.key);
    subjects[account.key] = subject;
  }

  const declared = new Set(GOLDEN_IDP_ACCOUNTS.map((a) => a.key));
  const uncovered = GOLDEN_ACCOUNT_KEYS.filter((key) => !declared.has(key));
  if (uncovered.length > 0) {
    throw new GoldenIdpError(
      `golden account keys without an IdP declaration: ${uncovered.join(", ")}`,
    );
  }

  return Object.freeze(subjects);
}
