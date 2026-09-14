import {
  GOLDEN_IDP_ACCOUNTS,
  golden,
  type GoldenAccountKey,
} from "@ds/db/seed/golden";

/**
 * SEED NAME → golden account, for `Given the golden doctor "<seed-name>" is
 * signed in` (staging/regression-contour tech spec §6.1, Issue #2067).
 *
 * §6.1 requires every scenario to name golden entities BY THEIR SEED NAME, never
 * by hand-typed data — a feature file must never carry an email or a password.
 * This registry is the single place a seed name becomes a real `@ds/db` golden
 * account plus the env var holding its IdP password (`packages/db/src/seed/
 * golden/idp.ts` — the seed NEVER invents a password, the operator supplies it),
 * so a mistyped name fails loudly with the accepted names listed instead of
 * silently driving the scenario as a guest.
 *
 * The names are kebab-case restatements of the catalogue's own doctor keys, which
 * is the form §6.1's example uses (`"verified-cardiologist"`).
 */

/** The seed names a feature file may write. */
export const GOLDEN_DOCTOR_SEED_NAMES = [
  "unverified",
  "verified-cardiologist",
  "mfa-enrolled",
  "deleted",
] as const;

export type GoldenDoctorSeedName = (typeof GOLDEN_DOCTOR_SEED_NAMES)[number];

/** A golden doctor as a step needs it: who to sign in, and where the password lives. */
export interface GoldenDoctor {
  readonly seedName: GoldenDoctorSeedName;
  readonly key: GoldenAccountKey;
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  /** The env var the OPERATOR sets with this account's IdP password. */
  readonly passwordEnvVar: string;
}

/** A seed name the registry does not publish, or a password env var that is unset. */
export class GoldenSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenSeedError";
  }
}

/** seed name → the catalogue entry it denotes. */
const CATALOGUE: Readonly<
  Record<GoldenDoctorSeedName, (typeof golden.doctors)[keyof typeof golden.doctors]>
> = Object.freeze({
  unverified: golden.doctors.unverified,
  "verified-cardiologist": golden.doctors.verifiedCardiologist,
  "mfa-enrolled": golden.doctors.mfaEnrolled,
  deleted: golden.doctors.deleted,
});

function passwordEnvVarFor(key: GoldenAccountKey): string {
  const account = GOLDEN_IDP_ACCOUNTS.find((a) => a.key === key);
  if (!account) {
    throw new GoldenSeedError(
      `golden account "${key}" has no IdP provisioning entry, so it has no password to sign in with.`,
    );
  }
  return account.passwordEnvVar;
}

/** Resolve a feature file's seed name into the golden doctor it names. */
export function resolveGoldenDoctor(seedName: string): GoldenDoctor {
  const entry = CATALOGUE[seedName as GoldenDoctorSeedName];
  if (!entry) {
    throw new GoldenSeedError(
      `unknown golden doctor seed name "${seedName}". Accepted: ${GOLDEN_DOCTOR_SEED_NAMES.join(", ")}.`,
    );
  }
  return Object.freeze({
    seedName: seedName as GoldenDoctorSeedName,
    key: entry.key,
    id: entry.id,
    email: entry.email,
    displayName: entry.displayName,
    passwordEnvVar: passwordEnvVarFor(entry.key),
  });
}

/**
 * The doctor's password, read from the env var the golden IdP seed declares.
 * Missing → a named failure, never a silent sign-in attempt with `undefined`.
 */
export function goldenDoctorPassword(doctor: GoldenDoctor): string {
  const password = process.env[doctor.passwordEnvVar];
  if (!password) {
    throw new GoldenSeedError(
      `${doctor.passwordEnvVar} is unset, so the golden doctor "${doctor.seedName}" cannot sign in. ` +
        `Set it to the password the golden IdP seed provisioned for ${doctor.email}.`,
    );
  }
  return password;
}
