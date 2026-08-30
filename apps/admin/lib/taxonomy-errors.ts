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
      // Live authority revalidation (#1304) refused to answer: the mutation was
      // rejected before it touched the row, so the sentence must say "nothing
      // changed, retry" rather than send the operator looking for bad input.
      case "IDP_REVALIDATION_UNAVAILABLE":
        return "recordings.errors.authorityUnavailable";
      default:
        break;
    }
  }

  // ── 012 EARS-7 event↔expert link codes (012-design §5.3, #1289) ──────────
  // Scoped to the link namespace for the same reason the recordings block is:
  // three of these codes exist ONLY on the join surface, and the entity screens
  // can never receive them. `SPEAKER_POSITION_OCCUPIED` in particular is the one
  // refusal whose fix is a different NUMBER, not a different field — the generic
  // «проверьте поля» would send the operator hunting through the whole form.
  if (ns === "eventExperts") {
    switch (code) {
      case "SPEAKER_POSITION_OCCUPIED":
        return "eventExperts.errors.positionOccupied";
      case "LEGACY_SPEAKER_CONFLICT":
        return "eventExperts.errors.legacyConflict";
      case "RELATIONSHIP_CONFLICT":
        return "eventExperts.errors.relationshipConflict";
      case "CONTENT_REMOVED":
        return "eventExperts.errors.contentRemoved";
      case "INVALID_TRANSITION":
        return "eventExperts.errors.invalidTransition";
      case "RESOURCE_NOT_FOUND":
        return "eventExperts.errors.notFound";
      case "VALIDATION_FAILED":
        return "eventExperts.errors.validation";
      case "IDP_REVALIDATION_UNAVAILABLE":
        return "eventExperts.errors.authorityUnavailable";
      default:
        break;
    }
  }

  // ── 012 EARS-11 event↔direction link codes (#1293) ───────────────────────
  // A duplicate is actionable on this relation surface: the operator must
  // restore the existing row instead of retrying a create mutation.
  if (ns === "eventTopics") {
    switch (code) {
      case "RELATIONSHIP_CONFLICT":
        return "eventTopics.errors.duplicatePair";
      case "LIFECYCLE_IMPACT_STALE":
        return "eventTopics.errors.impactStale";
      case "LIFECYCLE_IMPACT_REQUIRED":
        return "eventTopics.errors.impactRequired";
      default:
        break;
    }
  }

  // ── The §3.1 impact-gate codes (012-design §3.1/§5.3) ────────────────────
  // Scoped to the namespaces that actually HAVE the gate, for the same reason
  // the recordings block is scoped: a surface without a lifecycle-impact
  // preview can never receive these codes, and pointing its namespace at an
  // `impactStale` key that does not exist would trade a wrong sentence for a
  // crashed render.
  //
  // `directions` joins `eventProjects` here because the direction ENTITY is
  // itself impact-gated (012 EARS-13/14): retiring a direction withdraws every
  // specialty link and adjacency edge hanging off it, so the operator confirms
  // a set they were shown. `RELATIONSHIP_CONFLICT` stays event-project-only —
  // there is no logical pair to collide on the entity surface.
  if (ns === "eventProjects" || ns === "directions") {
    switch (code) {
      case "RELATIONSHIP_CONFLICT":
        if (ns === "eventProjects") return "eventProjects.errors.duplicatePair";
        break;
      case "INVALID_TRANSITION":
        return `${ns}.errors.invalidTransition`;
      // The one undifferentiated refusal of §3.1: the preview the operator
      // read no longer describes what would happen. The dialog RELOADS the
      // preview on this code — it never retries the confirmation.
      case "LIFECYCLE_IMPACT_STALE":
        return `${ns}.errors.impactStale`;
      case "LIFECYCLE_IMPACT_REQUIRED":
        return `${ns}.errors.impactRequired`;
      case "RESOURCE_NOT_FOUND":
        return `${ns}.errors.notFound`;
      default:
        break;
    }
  }

  // ── 012 EARS-9 project↔expert link codes (012-design §5.3, #1291) ────────
  // `PUBLISHED_PROJECT_REQUIRES_CURATOR` is the refusal this surface exists to
  // explain: the operator did not type anything wrong, they tried to leave a
  // published project without a curator, and the fix is the REPLACE action, not
  // a corrected field. The generic sentence would hide the only way forward.
  if (ns === "projectExperts") {
    switch (code) {
      case "PUBLISHED_PROJECT_REQUIRES_CURATOR":
        return "projectExperts.errors.curatorRequired";
      case "RELATIONSHIP_CONFLICT":
        // A curator RESTORE can race after the occupancy read said "free".
        // The caller marks that action with its occupied-seat fallback; in that
        // context the same wire code means the seat was claimed meanwhile, not
        // that the retained pair is a duplicate.
        if (fallbackKey === "projectExperts.fields.reverseSeatTakenHint") {
          return fallbackKey;
        }
        return "projectExperts.errors.relationshipConflict";
      case "CONTENT_REMOVED":
        return "projectExperts.errors.contentRemoved";
      case "INVALID_TRANSITION":
        return "projectExperts.errors.invalidTransition";
      case "RESOURCE_NOT_FOUND":
        return "projectExperts.errors.notFound";
      case "VALIDATION_FAILED":
        return "projectExperts.errors.validation";
      case "IDP_REVALIDATION_UNAVAILABLE":
        return "projectExperts.errors.authorityUnavailable";
      default:
        break;
    }
  }

  // ── 012 EARS-10 project↔partner link codes (012-design §5.3, #1292) ──────
  // `RELATIONSHIP_CONFLICT` is ambiguous here in a way it is not on the other
  // joins: it answers BOTH «эта пара уже есть» and «основной партнёр уже
  // назначен». Which one it is depends on WHICH ACTION was sent, not on the
  // payload, so the panel intercepts the code before this table on the two
  // primary-flag mutations and this table keeps the duplicate-pair reading — the
  // only one the plain link/restore actions can produce.
  if (ns === "projectPartners") {
    switch (code) {
      case "RELATIONSHIP_CONFLICT":
        // As above, but for a retired row that keeps `isPrimary=true`: a raced
        // restore lost the unique primary flag. Plain link actions still use
        // duplicatePair; only the action-specific fallback changes this reading.
        if (fallbackKey === "projectPartners.errors.primaryTaken") {
          return fallbackKey;
        }
        return "projectPartners.errors.duplicatePair";
      case "INVALID_TRANSITION":
        return "projectPartners.errors.invalidTransition";
      case "RESOURCE_NOT_FOUND":
        return "projectPartners.errors.notFound";
      case "VALIDATION_FAILED":
        return "projectPartners.errors.validation";
      case "IDP_REVALIDATION_UNAVAILABLE":
        return "projectPartners.errors.authorityUnavailable";
      default:
        break;
    }
  }

  // ── #1483 direction-relation codes (ADR-0016 §5) ─────────────────────────
  // Both relations answer the SAME code set, so one block serves both
  // namespaces — each still says it in its own nouns («такая связь» vs «такая
  // смежность»), which is the whole reason the namespace is derived rather than
  // shared. Scoped like the blocks above: `RELATIONSHIP_CONFLICT` reaches only a
  // relation surface, and pointing an entity namespace at a `duplicate` key that
  // does not exist would trade a wrong sentence for a crashed render.
  if (ns === "directionSpecialties" || ns === "directionAdjacency") {
    switch (code) {
      case "RELATIONSHIP_CONFLICT":
        return `${ns}.errors.duplicate`;
      case "INVALID_TRANSITION":
        return `${ns}.errors.invalidTransition`;
      case "RESOURCE_NOT_FOUND":
        return `${ns}.errors.notFound`;
      case "VALIDATION_FAILED":
        return `${ns}.errors.validation`;
      default:
        break;
    }
  }

  switch (code) {
    case "USER_EXPERT_CONFLICT":
      return `${ns}.errors.userConflict`;
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
