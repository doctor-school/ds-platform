import {
  GOLDEN_IDP_ACCOUNTS,
  GOLDEN_WORKER_POOL_SIZE,
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

/** The fields of a catalogue doctor this registry reads. */
interface CatalogueDoctor {
  readonly key: GoldenAccountKey;
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

/**
 * seed name → the account each parallel worker signs in as, indexed by
 * Playwright `parallelIndex` (#2805). A pooled seed lists one account per worker
 * (`golden.workerPool`, worker 0 = the catalogue account); an unpooled seed lists
 * only its catalogue account, so any worker but 0 naming it fails loudly instead
 * of sharing one account across workers.
 */
const CATALOGUE: Readonly<
  Record<GoldenDoctorSeedName, readonly CatalogueDoctor[]>
> = Object.freeze({
  unverified: [golden.doctors.unverified],
  "verified-cardiologist": golden.workerPool.verifiedCardiologist,
  "mfa-enrolled": [golden.doctors.mfaEnrolled],
  deleted: [golden.doctors.deleted],
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

/**
 * Resolve a feature file's seed name into the golden doctor it names, for the
 * worker `worker` (Playwright `testInfo.parallelIndex`; 0 outside a parallel
 * run). Each worker gets its OWN account, so a logout, a password-reset request
 * or a code sign-in in one worker never reaches another worker's session (#2805).
 */
export function resolveGoldenDoctor(
  seedName: string,
  worker = 0,
): GoldenDoctor {
  const pool = CATALOGUE[seedName as GoldenDoctorSeedName];
  if (!pool) {
    throw new GoldenSeedError(
      `unknown golden doctor seed name "${seedName}". Accepted: ${GOLDEN_DOCTOR_SEED_NAMES.join(", ")}.`,
    );
  }
  if (!Number.isInteger(worker) || worker < 0) {
    throw new GoldenSeedError(
      `worker index must be a non-negative integer, got ${worker}.`,
    );
  }
  if (worker >= GOLDEN_WORKER_POOL_SIZE) {
    throw new GoldenSeedError(
      `worker ${worker} exceeds the golden worker pool (${GOLDEN_WORKER_POOL_SIZE} accounts per pooled seed). ` +
        `Run with at most ${GOLDEN_WORKER_POOL_SIZE} workers, or grow GOLDEN_WORKER_POOL_SIZE and its catalogue entries in @ds/db.`,
    );
  }
  const entry = pool[worker];
  if (!entry) {
    throw new GoldenSeedError(
      `golden doctor "${seedName}" has no worker pool, so worker ${worker} would share it with worker 0. ` +
        `Pool it in @ds/db (golden.workerPool) before a parallel scenario signs in as it.`,
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
