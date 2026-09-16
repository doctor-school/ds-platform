// #2063/#2213 — the pinned legal acceptances of the golden dataset.
//
// Extracted from `dataset.ts` so `volume.ts` can write the same acceptances for
// the volume doctors without importing the module that imports IT: `dataset.ts`
// composes the volume rows, so a value import in the other direction would be a
// runtime cycle. The constants keep their original names and are re-exported
// from `dataset.ts`, so the public surface is unchanged.

/**
 * The consent purposes the golden «legal documents» pin.
 *
 * DEVIATION, recorded in the README and the PR body: the schema has no
 * legal-documents table. Legal texts are Fumadocs pages (028), not rows; what
 * the database actually stores about them is the per-purpose acceptance in
 * `consent_records`. The golden dataset therefore carries the ACCEPTANCES at a
 * pinned purpose/version instead of the documents, which is the part a
 * regression scenario can assert on.
 *
 * The strings mirror `DOCTOR_REGISTER_CONSENT_PURPOSES` (021,
 * `@ds/schemas/storefront`). They are duplicated rather than imported on
 * purpose: `@ds/db` sits BELOW `@ds/schemas` in the dependency order, and
 * inverting that to fetch three string literals would make the data layer
 * depend on the contract layer for a fixture.
 */
export const GOLDEN_CONSENT_PURPOSES = Object.freeze([
  "medical-worker-declaration",
  "partner-data-sharing",
  "marketing-communications",
]);

/** The pinned legal version every golden acceptance is recorded against. */
export const GOLDEN_CONSENT_VERSION = "2026-01";
