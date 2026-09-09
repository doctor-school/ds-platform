// #2063 — public surface of the golden dataset (staging tech spec §4).
//
// Step 7's `route-params.ts` and the regression scenarios import from here.
// `run.ts` is deliberately NOT re-exported: it is a CLI with side effects.

export {
  GOLDEN_NOW_DEFAULT,
  GOLDEN_NOW_ENV_VAR,
  GoldenNowError,
  goldenDateOnly,
  resolveGoldenNow,
  shiftFromNow,
  type GoldenOffset,
} from "./now.js";
export {
  GOLDEN_ACCOUNT_KEYS,
  GOLDEN_GROUP,
  golden,
  goldenUuid,
  type GoldenAccountKey,
  type GoldenCatalogue,
} from "./ids.js";
export {
  GOLDEN_IDP_ACCOUNTS,
  GoldenIdpError,
  missingSubjectEnvVars,
  resolveGoldenSubjects,
  type GoldenIdpAccount,
  type GoldenSubjectMap,
} from "./idp.js";
export {
  GOLDEN_CONSENT_PURPOSES,
  GOLDEN_CONSENT_VERSION,
  GoldenDatasetError,
  buildGoldenDataset,
  goldenSpecialtyIssues,
  type GoldenDataset,
  type GoldenDoctorSpecialtyLink,
} from "./dataset.js";
export {
  GOLDEN_SEED_ORDER,
  GoldenPlanError,
  buildGoldenSeedPlan,
  goldenReferentialIssues,
  resolveDoctorSpecialtyRows,
  type GoldenSeedStep,
} from "./plan.js";
export {
  applyGoldenStep,
  loadSpecialtyIdByName,
  seedGolden,
  type GoldenSeedResult,
  type RunGoldenSeedOptions,
} from "./seed.js";
