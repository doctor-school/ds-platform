// tools/deploy/rollback-floor.mjs — speaker-cutover rollback compatibility
// floor guard for `pnpm deploy:prod --rollback <sha>` (Issue #1633, EARS-24 of
// spec 012-content-taxonomy; design §2.3 stage 3).
//
// WHY. The 012 speaker cutover advances a retained database singleton
// `speaker_migration_cutover` from `review_open` to `source_closed` inside one
// serializable transaction that also copies the phase-aware expand release
// SHA/ordinal into `minimum_compatible_release_sha/ordinal`. From that moment a
// pre-expand application image is NOT database-compatible: it writes legacy
// `event_speakers` rows the fence trigger refuses and reads a merged legacy
// projection the closed set no longer supports. `--rollback` must therefore
// refuse to put such an image back — BEFORE any provider mutation, i.e. before
// the `.env` rewrite and `docker compose up -d` on api-prod.
//
// FAIL-CLOSED CONTRACT (design §2.3 stage 3, verbatim requirements):
//   - marker cannot be read              → reject (FLOOR_UNREADABLE)
//   - SHA/ordinal metadata disagree      → reject (FLOOR_METADATA_MISMATCH)
//   - target release ordinal is lower    → reject (TARGET_BELOW_FLOOR)
//   - target ordinal unresolvable        → reject (TARGET_ORDINAL_UNRESOLVED)
// App-only rollback AT or ABOVE the floor stays valid and is not slowed down.
//
// The one deliberate allow: a production database that predates the cutover
// migration has no `speaker_migration_cutover` table at all. That is a RECORDED
// state, not an unreadable marker — the floor concept does not exist there, and
// today's ordinary rollbacks must not be blocked by a feature that has not been
// deployed yet. A probe that cannot even answer "does the table exist" is
// unreadable and rejects.
//
// STRUCTURE. Everything below the reader factories is pure and I/O-free, so the
// whole decision table is unit-testable with no ssh, no psql and no provider
// call (tools/deploy/rollback-floor.test.mjs). `prod.mjs` supplies the two real
// readers.

/** Marker table name — the retained SSOT singleton (packages/db/src/schema/speaker-migration.ts). */
export const CUTOVER_TABLE = "speaker_migration_cutover";

/** Phases the marker may legitimately carry (monotonic; design §2.3). */
export const CUTOVER_PHASES = ["review_open", "source_closed"];

const TAG_RE = /^release-(\d{4}\.\d{2}\.\d{2})-(\d+)$/;

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

// --- pure parsing ---------------------------------------------------------

/**
 * Parse the `psql -At` projection of the singleton:
 *   `phase|minimum_compatible_release_sha|minimum_compatible_release_ordinal|version`
 * NULL columns come back as the empty string.
 *
 * Returns `null` when the output is empty, carries more than one row (the
 * singleton invariant is broken), or does not parse — every one of which the
 * caller treats as UNREADABLE. Pure.
 *
 * @param {string} raw
 * @returns {{phase: string, minimumCompatibleReleaseSha: string|null,
 *            minimumCompatibleReleaseOrdinal: number|null, version: number|null}|null}
 */
export function parseFloorRow(raw) {
  if (typeof raw !== "string") return null;
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== 1) return null;

  const parts = lines[0].split("|");
  if (parts.length !== 4) return null;

  const [phase, sha, ordinal, version] = parts.map((p) => p.trim());
  if (!phase) return null;

  const num = (s) => {
    if (!s) return null;
    if (!/^\d+$/.test(s)) return Number.NaN;
    return Number(s);
  };
  const ord = num(ordinal);
  const ver = num(version);
  if (Number.isNaN(ord) || Number.isNaN(ver)) return null;

  return {
    phase,
    minimumCompatibleReleaseSha: sha || null,
    minimumCompatibleReleaseOrdinal: ord,
    version: ver,
  };
}

/**
 * Authoritative release ordinal of a commit: its 1-based rank in the
 * chronological sequence of `release-YYYY.MM.DD-<n>` tags (date first, same-day
 * ordinal breaking the tie — the tag format cut by tools/release/cut-release.mjs).
 * The per-day `<n>` in the tag is NOT globally monotonic, so the RANK is the
 * authoritative ordinal, and it is derived from the release tags themselves
 * rather than trusted from any image label.
 *
 * `null` when the SHA carries no release tag — the caller fails closed on that.
 * Pure.
 *
 * @param {string} sha full 40-hex commit SHA
 * @param {Array<{tag: string, sha: string}>} taggedReleases
 * @returns {number|null}
 */
export function releaseOrdinalFor(sha, taggedReleases) {
  if (!sha || !Array.isArray(taggedReleases)) return null;
  const ranked = taggedReleases
    .map((t) => {
      const m = TAG_RE.exec(t?.tag ?? "");
      return m ? { sha: t.sha, key: `${m[1]}#${m[2].padStart(9, "0")}` } : null;
    })
    .filter((t) => t !== null)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const idx = ranked.findIndex((t) => t.sha === sha);
  return idx === -1 ? null : idx + 1;
}

// --- pure decision table --------------------------------------------------

/**
 * The whole fail-closed decision, with every input already resolved. Pure.
 *
 * @param {object} args
 * @param {boolean|null} args.floorTablePresent  `null` = the probe could not answer.
 * @param {ReturnType<typeof parseFloorRow>} args.floor  parsed marker, or `null` if unreadable.
 * @param {number|null} args.floorShaOrdinal  release ordinal git resolves for the marker's floor SHA.
 * @param {{sha: string, ordinal: number|null}} args.target
 * @returns {{ok: true, reason: string} | {ok: false, code: string, message: string}}
 */
export function evaluateRollbackFloor({
  floorTablePresent,
  floor,
  floorShaOrdinal,
  target,
}) {
  const reject = (code, message) => ({ ok: false, code, message });

  // The cutover feature is not deployed on this database at all.
  if (floorTablePresent === false) {
    return { ok: true, reason: "no-floor-table" };
  }
  if (floorTablePresent !== true) {
    return reject(
      "FLOOR_UNREADABLE",
      `cannot determine whether \`${CUTOVER_TABLE}\` exists on production — refusing to roll back blind.`,
    );
  }

  if (!floor) {
    return reject(
      "FLOOR_UNREADABLE",
      `\`${CUTOVER_TABLE}\` exists but its retained singleton could not be read (absent, duplicated or unparseable).`,
    );
  }
  if (!CUTOVER_PHASES.includes(floor.phase)) {
    return reject(
      "FLOOR_UNREADABLE",
      `\`${CUTOVER_TABLE}.phase\` is ${JSON.stringify(floor.phase)}, not one of ${CUTOVER_PHASES.join(" | ")}.`,
    );
  }

  const { minimumCompatibleReleaseSha: fSha, minimumCompatibleReleaseOrdinal: fOrd } =
    floor;

  // A half-written pair is corruption, never "no floor" — the closure
  // transaction writes both columns atomically or neither.
  if ((fSha === null) !== (fOrd === null)) {
    return reject(
      "FLOOR_UNREADABLE",
      `\`${CUTOVER_TABLE}\` holds a half-written floor pair (sha=${fSha ?? "NULL"}, ordinal=${fOrd ?? "NULL"}).`,
    );
  }

  // `source_closed` without a floor is exactly the state the design forbids.
  if (floor.phase === "source_closed" && fSha === null) {
    return reject(
      "FLOOR_UNREADABLE",
      `\`${CUTOVER_TABLE}\` is source_closed with no minimum-compatible release recorded — the state the closure transaction must never produce.`,
    );
  }

  // No floor recorded yet (pre-closure `review_open`): ordinary rollback.
  if (fSha === null) {
    return { ok: true, reason: "no-floor-recorded" };
  }

  // Metadata agreement: the release tags must rank the recorded floor SHA at
  // exactly the recorded ordinal. Checked BEFORE the comparison so a corrupt
  // marker can never silently permit a rollback.
  if (floorShaOrdinal === null) {
    return reject(
      "FLOOR_METADATA_MISMATCH",
      `the retained floor SHA ${short(fSha)} carries no \`release-*\` tag, so its authoritative ordinal cannot be resolved.`,
    );
  }
  if (floorShaOrdinal !== fOrd) {
    return reject(
      "FLOOR_METADATA_MISMATCH",
      `retained floor metadata disagrees: ${short(fSha)} ranks as release ordinal ${floorShaOrdinal}, but the marker records ${fOrd}.`,
    );
  }

  if (target?.ordinal === null || target?.ordinal === undefined) {
    return reject(
      "TARGET_ORDINAL_UNRESOLVED",
      `rollback target ${short(target?.sha)} carries no \`release-*\` tag — its authoritative release ordinal cannot be resolved, and an unranked image cannot be proven at or above the floor.`,
    );
  }

  if (target.ordinal < fOrd) {
    return reject(
      "TARGET_BELOW_FLOOR",
      `rollback target ${short(target.sha)} is release ordinal ${target.ordinal}, below the retained minimum-compatible floor ordinal ${fOrd} (${short(fSha)}).`,
    );
  }

  return { ok: true, reason: "at-or-above-floor" };
}

function short(sha) {
  return typeof sha === "string" && sha.length > 12 ? sha.slice(0, 12) : String(sha);
}

// --- composed guard (I/O injected) ----------------------------------------

/**
 * Read the floor, resolve both ordinals, decide. Throws `RollbackFloorError` on
 * every fail-closed path; returns the allow verdict otherwise. Performs READS
 * ONLY — it is called before the first provider mutation of the rollback path.
 *
 * @param {object} args
 * @param {string} args.sha  full rollback-target commit SHA
 * @param {() => Promise<{tablePresent: boolean, raw: string}>} args.readFloor
 * @param {() => Promise<Array<{tag: string, sha: string}>>} args.listReleaseTags
 * @returns {Promise<{ok: true, reason: string}>}
 */
export async function assertRollbackAllowed({ sha, readFloor, listReleaseTags }) {
  let marker;
  try {
    marker = await readFloor();
  } catch (err) {
    throw new RollbackFloorError(
      "FLOOR_UNREADABLE",
      `could not read the retained rollback floor from production: ${err?.message ?? err}`,
    );
  }

  const floorTablePresent =
    typeof marker?.tablePresent === "boolean" ? marker.tablePresent : null;
  const floor = floorTablePresent === true ? parseFloorRow(marker.raw ?? "") : null;

  // Short-circuit the tag listing only when there is provably nothing to
  // compare against — otherwise the ordinals are resolved BEFORE any verdict,
  // as the scenario requires ("reads the marker and resolves the target ordinal
  // first").
  if (floorTablePresent === false) {
    return { ok: true, reason: "no-floor-table" };
  }

  let tags = [];
  let tagsFailed = null;
  try {
    tags = await listReleaseTags();
  } catch (err) {
    tagsFailed = err;
  }

  if (tagsFailed) {
    throw new RollbackFloorError(
      "TARGET_ORDINAL_UNRESOLVED",
      `could not list \`release-*\` tags to resolve the rollback target ordinal: ${tagsFailed?.message ?? tagsFailed}`,
    );
  }

  const verdict = evaluateRollbackFloor({
    floorTablePresent,
    floor,
    floorShaOrdinal: floor?.minimumCompatibleReleaseSha
      ? releaseOrdinalFor(floor.minimumCompatibleReleaseSha, tags)
      : null,
    target: { sha, ordinal: releaseOrdinalFor(sha, tags) },
  });

  if (!verdict.ok) throw new RollbackFloorError(verdict.code, verdict.message);
  return verdict;
}

// --- real readers (used by prod.mjs) --------------------------------------

/**
 * Build the production floor reader. One `psql -At` round trip on data-prod
 * that first answers `to_regclass` (does the table exist) and then, only if it
 * does, projects the singleton. Read-only by construction.
 *
 * @param {object} deps
 * @param {(host: string, script: string) => Promise<string>} deps.sshCapture
 * @param {string} deps.host       data-prod ssh alias
 * @param {string} deps.composeDir remote data-prod compose directory
 * @param {string} [deps.dbUser]
 * @param {string} [deps.dbName]
 */
export function makeProdFloorReader({
  sshCapture,
  host,
  composeDir,
  dbUser = process.env.DS_PROD_DB_USER || "ds",
  dbName = process.env.DS_PROD_DB_NAME || "ds_prod",
}) {
  // Two separate probes, not one multi-statement round trip: a missing table
  // must come back as a clean ABSENT answer, not as a psql error that
  // ON_ERROR_STOP would turn into an unreadable marker.
  return async () => {
    // `-v ON_ERROR_STOP=1`: a failing probe must surface as a non-zero exit
    // (→ FLOOR_UNREADABLE), never as empty stdout that reads like "no rows".
    const out = await sshCapture(
      host,
      `cd ${composeDir}
sudo docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -qAt -U ${dbUser} -d ${dbName} -c "SELECT CASE WHEN to_regclass('public.${CUTOVER_TABLE}') IS NULL THEN 'ABSENT' ELSE 'PRESENT' END"
`,
    );
    const presence = out.trim().split(/\r?\n/).pop()?.trim();
    if (presence === "ABSENT") return { tablePresent: false, raw: "" };
    if (presence !== "PRESENT") {
      throw new Error(`unexpected ${CUTOVER_TABLE} presence probe output: ${out}`);
    }

    const raw = await sshCapture(
      host,
      `cd ${composeDir}
sudo docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -qAt -F '|' -U ${dbUser} -d ${dbName} -c "SELECT phase, coalesce(minimum_compatible_release_sha, ''), coalesce(minimum_compatible_release_ordinal::text, ''), version::text FROM public.${CUTOVER_TABLE}"
`,
    );
    return { tablePresent: true, raw };
  };
}

/**
 * Build the release-tag lister from local git: every `release-*` tag with the
 * commit it points at (annotated tags dereferenced via `^{commit}`).
 *
 * @param {(cmd: string, args: string[]) => string} localCap
 */
export function makeGitReleaseTagLister(localCap) {
  return async () => {
    const out = localCap("git", [
      "for-each-ref",
      // `*objectname` is the dereferenced commit of an ANNOTATED tag and empty
      // for a lightweight one — take it when present, else the object itself.
      "--format=%(refname:strip=2)\t%(objectname)\t%(*objectname)",
      "refs/tags/release-*",
    ]);
    return out
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter(Boolean)
      .map((l) => {
        const [tag, objectName, derefName] = l.split("\t");
        return { tag, sha: derefName || objectName };
      })
      .filter((t) => t.tag && t.sha);
  };
}
