// #2063 — public surface of the golden dataset (staging tech spec §4).
//
// Step 7's `route-params.ts` and the regression scenarios import from here.
// `run.ts` is deliberately NOT re-exported: it is a CLI with side effects.

export {
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
  isGoldenUuid,
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
  type GoldenDirectionSpecialtyLink,
  type GoldenDoctorSpecialtyLink,
} from "./dataset.js";
export {
  GOLDEN_VOLUME_ORDINAL_BASE,
  buildGoldenVolume,
  goldenDirectionId,
  goldenPartnerId,
  isGoldenVolumeUuid,
  type GoldenVolume,
} from "./volume.js";
export {
  GOLDEN_ADJACENCY,
  GOLDEN_ADJACENCY_RETIRED,
  GOLDEN_DIRECTION_EXTRA_LINKS,
  GOLDEN_DIRECTION_RETIRED_LINKS,
  GOLDEN_DIRECTIONS,
  GOLDEN_PARTNERS,
  GOLDEN_PUBLISHED_DIRECTIONS,
  GOLDEN_UNPUBLISHED_DIRECTIONS,
  GoldenTaxonomyError,
  directionIndexOf,
  publishedDirectionIndexOf,
  publishedDirectionIndexOfSpecialty,
  type GoldenAdjacencyEdge,
  type GoldenDirectionSpec,
  type GoldenPartnerSpec,
} from "./taxonomy.js";
export {
  eventProgrammeKey,
  expertPhotoKey,
  formatMskDate,
  formatMskTime,
  hasProgramme,
  isDatedProgrammeLine,
  ordinalFromExpertPhotoKey,
  ordinalFromPartnerLogoKey,
  partnerLogoKey,
  programmeLines,
  programmeSessionCount,
  programmeSessionMinutes,
  programmeSessions,
  programmeTotalMinutes,
  PROGRAMME_QA_MINUTES,
  type ProgrammeSession,
  type ProgrammeSpeaker,
  type ProgrammeSpec,
} from "./programme.js";
export {
  buildGoldenMediaPlan,
  createInMemoryGoldenMediaStore,
  goldenProgrammeSpecs,
  GOLDEN_MEDIA_CONCURRENCY,
  GoldenMediaError,
  PARTNER_LOGO_CONTENT_TYPE,
  PORTRAIT_CONTENT_TYPE,
  PROGRAMME_CONTENT_TYPE,
  renderPartnerLogoSvg,
  renderProgrammePdf,
  writeGoldenMedia,
  type GoldenMediaObject,
  type GoldenMediaRefresh,
  type GoldenMediaStore,
  type GoldenMediaWriteResult,
  type StoredGoldenMediaObject,
} from "./media.js";
export {
  composeDescription,
  specialtiesWithoutParagraphBank,
  volumeEventTitle,
  VOLUME_EXPERTS,
  VOLUME_PROGRAMME,
  VOLUME_PROJECTS,
  type VolumeExpertSpec,
  type VolumeProjectSpec,
} from "./content.js";
export {
  GOLDEN_SEED_ORDER,
  GoldenPlanError,
  buildGoldenSeedPlan,
  goldenReferentialIssues,
  resolveDirectionSpecialtyRows,
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
