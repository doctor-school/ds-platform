import type { TaxonomyHttpError } from "@/providers/data-provider";

/**
 * Map an admin Problem Details failure onto the operator-facing RU catalogue key.
 * Keys off the stable `errorCode`, never the HTTP status or the server's English
 * `detail`: the code is the contract, and each code has one actionable sentence
 * the operator can act on.
 *
 * An unmapped code falls back to the caller's generic key — visible, not silent.
 *
 * The RESOURCE namespace is read off the caller's fallback key (`projects.…`,
 * `experts.…`, …) rather than passed separately: every taxonomy resource owns the
 * same §5.3 code set but says it in its own nouns («этот адрес занят другим
 * проектом» vs «…другим экспертом»), and deriving the prefix keeps one mapping
 * table for all four #1283–#1286 verticals with no call-site ceremony.
 */
export function taxonomyErrorKey(error: unknown, fallbackKey: string): string {
  const ns = fallbackKey.split(".")[0] ?? "projects";
  const code = (error as TaxonomyHttpError | undefined)?.errorCode;

  // ── 014 recordings codes (014-design §11) ────────────────────────────────
  // Scoped to the recordings namespace deliberately: the taxonomy surfaces can
  // never receive these codes, and pointing them at a `projects.errors.*` key
  // that does not exist would trade a wrong sentence for a crashed render.
  if (ns === "recordings") {
    switch (code) {
      case "RECORDING_KIND_OCCUPIED":
        return "recordings.errors.kindOccupied";
      case "EVENT_NOT_FINISHED":
        return "recordings.errors.eventNotFinished";
      case "INVALID_TRANSITION":
        return "recordings.errors.invalidTransition";
      case "RESOURCE_NOT_FOUND":
        return "recordings.errors.notFound";
      case "VALIDATION_FAILED":
        return "recordings.errors.validation";
      default:
        break;
    }
  }

  switch (code) {
    case "SLUG_CONFLICT":
      return `${ns}.errors.slugConflict`;
    case "SLUG_IMMUTABLE":
      return `${ns}.errors.slugImmutable`;
    case "PRECONDITION_FAILED":
    case "PRECONDITION_REQUIRED":
      return `${ns}.errors.stale`;
    case "PUBLISH_REQUIREMENTS_NOT_MET":
      return `${ns}.errors.publishRequirements`;
    case "MEDIA_INVALID":
      return `${ns}.errors.mediaInvalid`;
    case "MEDIA_INPUT_CONFLICT":
      return `${ns}.errors.mediaConflict`;
    case "MEDIA_STORAGE_UNAVAILABLE":
      return `${ns}.errors.storageUnavailable`;
    // The pair an operator meets after a double-submit: the provider sends a
    // fresh Idempotency-Key per call, so a REUSED key means the same key came
    // back with different input (a resubmitted, edited form), and
    // IN_PROGRESS means the first submit is still running. Both need their own
    // sentence — the generic "проверьте поля" would send the operator hunting
    // for a field problem that does not exist.
    case "IDEMPOTENCY_KEY_REUSED":
      return `${ns}.errors.keyReused`;
    case "IDEMPOTENCY_REQUEST_IN_PROGRESS":
      return `${ns}.errors.requestInProgress`;
    default:
      return fallbackKey;
  }
}
