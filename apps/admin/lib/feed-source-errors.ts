import type { TaxonomyHttpError } from "@/providers/data-provider";

/**
 * 048 EARS-21 — the server's sentence for the «Адрес канала» field: an address
 * of another form, an invite link or one already listed answers
 * `400 VALIDATION_FAILED` with `errors: [{ path: "address", message }]`, and
 * the message IS the RU field error of `@ds/schemas`
 * (`FEED_SOURCE_ADDRESS_ERROR` / `FEED_SOURCE_ADDRESS_TAKEN_ERROR`).
 * `null` when the refusal addresses no field.
 */
export function feedSourceAddressRefusal(error: unknown): string | null {
  const refusal = error as TaxonomyHttpError | undefined;
  if (refusal?.errorCode !== "VALIDATION_FAILED") return null;
  const entry = (refusal.fieldErrors ?? []).find(
    (e) => e.path.split(".")[0] === "address",
  );
  return entry?.message ?? null;
}

/**
 * The catalog key of a refused «Источники» write no field owns (048 EARS-21,
 * EARS-22): a stale row (412 — another operator moved it), a repeated switch
 * (409 — already off / on), a source that is gone, a duplicate submit still
 * running; anything else → the call site's own fallback.
 */
export function feedSourceErrorKey(
  error: unknown,
  fallbackKey: string,
): string {
  switch ((error as TaxonomyHttpError | undefined)?.errorCode) {
    case "PRECONDITION_FAILED":
    case "PRECONDITION_REQUIRED":
      return "feedSources.errors.stale";
    case "INVALID_TRANSITION":
      return "feedSources.errors.invalidTransition";
    case "RESOURCE_NOT_FOUND":
      return "feedSources.errors.notFound";
    case "IDEMPOTENCY_REQUEST_IN_PROGRESS":
      return "feedSources.errors.requestInProgress";
    default:
      return fallbackKey;
  }
}

/**
 * 048 EARS-32 — the catalog key of a refused «Скрыть из ленты» / «Вернуть в
 * ленту»: the post moved since the page was read (412 — an edit from the
 * channel or another operator), it is already in that state (409), it is
 * gone; anything else → the call site's own fallback.
 */
export function feedEntryErrorKey(error: unknown, fallbackKey: string): string {
  switch ((error as TaxonomyHttpError | undefined)?.errorCode) {
    case "PRECONDITION_FAILED":
    case "PRECONDITION_REQUIRED":
      return "feedPosts.errors.stale";
    case "INVALID_TRANSITION":
      return "feedPosts.errors.invalidTransition";
    case "RESOURCE_NOT_FOUND":
      return "feedPosts.errors.notFound";
    case "IDEMPOTENCY_REQUEST_IN_PROGRESS":
      return "feedSources.errors.requestInProgress";
    default:
      return fallbackKey;
  }
}
