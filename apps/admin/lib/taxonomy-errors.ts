import type { TaxonomyHttpError } from "@/providers/data-provider";

/**
 * Map a 012 Problem Details failure onto the operator-facing RU catalogue key
 * (012-design §5.3). Keys off the stable `errorCode`, never the HTTP status or
 * the server's English `detail`: the code is the contract, and each code has one
 * actionable sentence the operator can act on.
 *
 * An unmapped code falls back to the caller's generic key — visible, not silent.
 */
export function taxonomyErrorKey(error: unknown, fallbackKey: string): string {
  const code = (error as TaxonomyHttpError | undefined)?.errorCode;
  switch (code) {
    case "SLUG_CONFLICT":
      return "projects.errors.slugConflict";
    case "SLUG_IMMUTABLE":
      return "projects.errors.slugImmutable";
    case "PRECONDITION_FAILED":
    case "PRECONDITION_REQUIRED":
      return "projects.errors.stale";
    case "PUBLISH_REQUIREMENTS_NOT_MET":
      return "projects.errors.publishRequirements";
    case "MEDIA_INVALID":
      return "projects.errors.mediaInvalid";
    case "MEDIA_INPUT_CONFLICT":
      return "projects.errors.mediaConflict";
    case "MEDIA_STORAGE_UNAVAILABLE":
      return "projects.errors.storageUnavailable";
    default:
      return fallbackKey;
  }
}
