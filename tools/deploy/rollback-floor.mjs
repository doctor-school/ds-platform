// tools/deploy/rollback-floor.mjs — speaker-cutover rollback compatibility
// floor guard for `pnpm deploy:prod --rollback <sha>` (Issue #1607, EARS-24 of
// spec 012-content-taxonomy).
//
// WHY. Migration `0036_speaker_cutover.sql` DROPS `public.event_speakers` (and
// the retained cutover singleton with it). From the moment it is applied, an
// application image built before the cutover is NOT database-compatible: its
// read path selects from a table that no longer exists. `--rollback` must
// therefore refuse to put such an image back — BEFORE any provider mutation,
// i.e. before the `.env` rewrite and `docker compose up -d` on api-prod.
//
// WHAT THE FLOOR IS KEYED ON. The pre-cutover design keyed the floor on a
// database singleton (`speaker_migration_cutover.minimum_compatible_release_*`)
// that the very same migration drops, so that SSOT cannot survive its own
// cutover. The floor is therefore re-pointed onto the migration itself, which
// is durable on both sides of the comparison:
//   - PROD side: `public.event_speakers` is ABSENT ⇔ 0036 has been applied.
//   - TARGET side: the rollback target's tree carries
//     `apps/api/drizzle/0036_speaker_cutover.sql` ⇔ its image knows the
//     post-cutover schema.
// A target that lacks the migration file is exactly a pre-cutover image. No
// release-tag ranking is involved, so an untagged-but-post-cutover target is
// judged on the property that actually matters.
//
// FAIL-CLOSED CONTRACT:
//   - prod state cannot be read                → reject (FLOOR_UNREADABLE)
//   - target's tree cannot be inspected        → reject (TARGET_STATE_UNRESOLVED)
//   - target predates the cutover migration    → reject (TARGET_BELOW_FLOOR)
// App-only rollback AT or ABOVE the floor stays valid and is not slowed down.
//
// The one deliberate allow: a production database that has not yet applied 0036
// still HAS `event_speakers`. That is a RECORDED state, not an unreadable one —
// the floor does not exist there and ordinary rollbacks must not be blocked by
// a migration that has not shipped. A probe that cannot even answer "does the
// table exist" is unreadable and rejects.
//
// STRUCTURE. Everything below the reader factories is pure and I/O-free, so the
// whole decision table is unit-testable with no ssh, no psql and no provider
// call (tools/deploy/rollback-floor.test.mjs). `prod.mjs` supplies the two real
// readers.

/** The legacy table dropped by the cutover — the prod-side presence probe. */
export const LEGACY_SPEAKER_TABLE = "event_speakers";

/** The migration whose presence in a target tree marks it post-cutover. */
export const CUTOVER_MIGRATION_PATH = "apps/api/drizzle/0036_speaker_cutover.sql";

/**
 * Error carrying a stable machine code so `prod.mjs` (and the tests) can assert
 * WHICH fail-closed rule fired rather than string-matching prose.
 */
export class RollbackFloorError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "RollbackFloorError";
    this.code = code;
  }
}

// --- pure decision table --------------------------------------------------

/**
 * The whole fail-closed decision, with every input already resolved. Pure.
 *
 * @param {object} args
 * @param {boolean|null} args.legacyTablePresent  `null` = the probe could not answer.
 * @param {boolean|null} args.targetCarriesCutover `null` = git could not answer.
 * @param {string} args.sha  rollback-target commit SHA (for the message only).
 * @returns {{ok: true, reason: string} | {ok: false, code: string, message: string}}
 */
export function evaluateRollbackFloor({
  legacyTablePresent,
  targetCarriesCutover,
  sha,
}) {
  const reject = (code, message) => ({ ok: false, code, message });

  // The cutover migration has not been applied on this database at all.
  if (legacyTablePresent === true) {
    return { ok: true, reason: "cutover-not-applied" };
  }
  if (legacyTablePresent !== false) {
    return reject(
      "FLOOR_UNREADABLE",
      `cannot determine whether \`public.${LEGACY_SPEAKER_TABLE}\` still exists on production — refusing to roll back blind.`,
    );
  }

  // Past this point prod is post-cutover: the floor is live.
  if (targetCarriesCutover === null || targetCarriesCutover === undefined) {
    return reject(
      "TARGET_STATE_UNRESOLVED",
      `cannot determine whether rollback target ${short(sha)} carries \`${CUTOVER_MIGRATION_PATH}\` — an uninspectable image cannot be proven at or above the floor.`,
    );
  }
  if (targetCarriesCutover !== true) {
    return reject(
      "TARGET_BELOW_FLOOR",
      `rollback target ${short(sha)} predates the speaker cutover: its tree has no \`${CUTOVER_MIGRATION_PATH}\`, so its image reads \`${LEGACY_SPEAKER_TABLE}\`, which production has already dropped.`,
    );
  }

  return { ok: true, reason: "at-or-above-floor" };
}

function short(sha) {
  return typeof sha === "string" && sha.length > 12
    ? sha.slice(0, 12)
    : String(sha);
}

// --- composed guard (I/O injected) ----------------------------------------

/**
 * Read prod state, inspect the target tree, decide. Throws `RollbackFloorError`
 * on every fail-closed path; returns the allow verdict otherwise. Performs
 * READS ONLY — it is called before the first provider mutation of the rollback
 * path.
 *
 * @param {object} args
 * @param {string} args.sha  full rollback-target commit SHA
 * @param {() => Promise<{legacyTablePresent: boolean}>} args.readProdCutoverState
 * @param {(sha: string) => Promise<boolean>} args.targetCarriesMigration
 * @returns {Promise<{ok: true, reason: string}>}
 */
export async function assertRollbackAllowed({
  sha,
  readProdCutoverState,
  targetCarriesMigration,
}) {
  let prod;
  try {
    prod = await readProdCutoverState();
  } catch (err) {
    throw new RollbackFloorError(
      "FLOOR_UNREADABLE",
      `could not read the cutover state from production: ${err?.message ?? err}`,
    );
  }

  const legacyTablePresent =
    typeof prod?.legacyTablePresent === "boolean" ? prod.legacyTablePresent : null;

  // Short-circuit the git probe only when there is provably nothing to compare
  // against — the floor does not exist on a pre-cutover database.
  if (legacyTablePresent === true) {
    return { ok: true, reason: "cutover-not-applied" };
  }

  let targetCarriesCutover = null;
  if (legacyTablePresent === false) {
    try {
      const carries = await targetCarriesMigration(sha);
      targetCarriesCutover = typeof carries === "boolean" ? carries : null;
    } catch {
      targetCarriesCutover = null;
    }
  }

  const verdict = evaluateRollbackFloor({
    legacyTablePresent,
    targetCarriesCutover,
    sha,
  });

  if (!verdict.ok) throw new RollbackFloorError(verdict.code, verdict.message);
  return verdict;
}

// --- real readers (used by prod.mjs) --------------------------------------

/**
 * Build the production cutover-state reader. One `psql -At` round trip on
 * data-prod answering `to_regclass` for the dropped legacy table. Read-only by
 * construction.
 *
 * @param {object} deps
 * @param {(host: string, script: string) => Promise<string>} deps.sshCapture
 * @param {string} deps.host       data-prod ssh alias
 * @param {string} deps.composeDir remote data-prod compose directory
 * @param {string} [deps.dbUser]
 * @param {string} [deps.dbName]
 */
export function makeProdCutoverReader({
  sshCapture,
  host,
  composeDir,
  dbUser = process.env.DS_PROD_DB_USER || "ds",
  dbName = process.env.DS_PROD_DB_NAME || "ds_prod",
}) {
  return async () => {
    // `-v ON_ERROR_STOP=1`: a failing probe must surface as a non-zero exit
    // (→ FLOOR_UNREADABLE), never as empty stdout that reads like an answer.
    const out = await sshCapture(
      host,
      `cd ${composeDir}
sudo docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -qAt -U ${dbUser} -d ${dbName} -c "SELECT CASE WHEN to_regclass('public.${LEGACY_SPEAKER_TABLE}') IS NULL THEN 'ABSENT' ELSE 'PRESENT' END"
`,
    );
    const presence = out.trim().split(/\r?\n/).pop()?.trim();
    if (presence === "ABSENT") return { legacyTablePresent: false };
    if (presence === "PRESENT") return { legacyTablePresent: true };
    throw new Error(
      `unexpected ${LEGACY_SPEAKER_TABLE} presence probe output: ${out}`,
    );
  };
}

/**
 * Build the target-tree probe from local git: does the rollback target's tree
 * carry the cutover migration file? `git cat-file -e <sha>:<path>` exits 0 when
 * the blob exists at that commit and non-zero when it does not — so a THROW is
 * the "absent" answer and only an unresolvable commit is unresolved state.
 *
 * @param {(cmd: string, args: string[]) => string} localCap
 */
export function makeGitCutoverMigrationProbe(localCap) {
  return async (sha) => {
    // A commit that does not exist locally is unresolvable state, not "absent".
    localCap("git", ["rev-parse", "--verify", `${sha}^{commit}`]);
    try {
      localCap("git", ["cat-file", "-e", `${sha}:${CUTOVER_MIGRATION_PATH}`]);
      return true;
    } catch {
      return false;
    }
  };
}
