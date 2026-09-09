export {
  FREQUENT_SPECIALTY_NAMES,
  MINZDRAV_ORDER,
  RAZDEL_I_NAMES,
  SPECIALTY_OTHER_NAME,
} from "./specialties-minzdrav.data.js";
export {
  buildSpecialtyBookSeed,
  seedSpecialtiesMinzdrav,
  type SpecialtyBookSeedRow,
} from "./specialties-minzdrav.js";
export {
  specialtyCodeFromName,
  specialtyIdentityName,
} from "./specialty-code.js";
// The golden dataset is deliberately NOT re-exported here. This barrel is
// reachable from `@ds/db`, which the api imports for the specialty book seed —
// re-exporting it would pull a staging fixture (accounts, events, consents) into
// the production module graph. Consumers import `@ds/db/seed/golden`.
