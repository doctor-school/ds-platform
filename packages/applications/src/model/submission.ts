import {
  type ApplicantApplicationList,
  ApplicationProblemCodes,
  type ApplicationRefusal,
  type AuthorApplicationIntakeResult,
  BotProtectionErrorCodes,
} from "@ds/schemas";

/** Mints a canonical lowercase UUID idempotency key (012 §6). */
export type KeyFactory = () => string;
const defaultKey: KeyFactory = () => crypto.randomUUID();

/**
 * EARS-8, EARS-9 — one form instance's submission. The key is minted when the
 * form opens and kept through every retry of that instance; «Отправить ещё
 * одну заявку» mints a new one, and so does a key the server already holds
 * when the re-read succeeds and finds no open application under it (`rekey`).
 */
export type SubmissionState =
  | { phase: "editing"; idempotencyKey: string }
  | { phase: "sending"; idempotencyKey: string }
  | { phase: "unavailable"; idempotencyKey: string }
  | {
      phase: "sent";
      idempotencyKey: string;
      result: AuthorApplicationIntakeResult;
    };

/** What a refused or failed submission means for the page. */
export type ApplicationsFailure =
  /** EARS-8 — network or `5xx`: keep the input, offer the retry. */
  | { kind: "unavailable" }
  /**
   * EARS-8 — `422 IDEMPOTENCY_KEY_REUSED`: an application under this key is
   * already stored (its reply was lost, the retry carried an edited body). The
   * page re-reads the applicant's applications to settle it.
   */
  | { kind: "key-reused" }
  /** EARS-5 — `400` with field errors. */
  | { kind: "fields"; problems: ApplicationRefusal["problems"] }
  /** The session ended — the account gate of EARS-3. */
  | { kind: "signed-out" }
  /** EARS-7 — the bot-protection proof is missing or rejected. */
  | { kind: "bot-protection" }
  /** Any other refusal. */
  | { kind: "refused" };

export type SubmissionEvent =
  | { type: "submit" }
  | { type: "failed"; failure: ApplicationsFailure }
  | { type: "succeeded"; result: AuthorApplicationIntakeResult }
  /**
   * EARS-8 — the key is spent and a successful re-read finds no open
   * application (it was closed or erased): a new key, retry offered.
   */
  | { type: "rekey" }
  | { type: "another" };

export function startSubmission(
  nextKey: KeyFactory = defaultKey,
): SubmissionState {
  return { phase: "editing", idempotencyKey: nextKey() };
}

/**
 * EARS-8, EARS-9 — the submission transitions. A `submit` while `sending` or
 * `sent` returns the same state object, so the caller sends a request only
 * when the phase moved to `sending` (a double tap sends one request). A
 * failure keeps the key: a network / `5xx` failure retries with it, and a
 * refused body stored nothing, so its key is still unused. A reused key stays
 * `sending` until the re-read settles it (`succeeded` or `rekey`).
 */
export function submissionReducer(
  state: SubmissionState,
  event: SubmissionEvent,
  nextKey: KeyFactory = defaultKey,
): SubmissionState {
  const { idempotencyKey } = state;
  switch (event.type) {
    case "submit":
      return state.phase === "editing" || state.phase === "unavailable"
        ? { phase: "sending", idempotencyKey }
        : state;
    case "failed":
      if (state.phase !== "sending" || event.failure.kind === "key-reused")
        return state;
      return event.failure.kind === "unavailable"
        ? { phase: "unavailable", idempotencyKey }
        : { phase: "editing", idempotencyKey };
    case "rekey":
      return state.phase === "sending"
        ? { phase: "unavailable", idempotencyKey: nextKey() }
        : state;
    case "succeeded":
      return state.phase === "sending"
        ? { phase: "sent", idempotencyKey, result: event.result }
        : state;
    case "another":
      return state.phase === "sent" ? startSubmission(nextKey) : state;
  }
}

/** EARS-5, EARS-7, EARS-8 — a transport error as the page's outcome. */
export function classifyFailure(error: {
  status: number;
  problems: ApplicationRefusal["problems"];
  code?: string | undefined;
}): ApplicationsFailure {
  if (error.status === 0 || error.status >= 500) return { kind: "unavailable" };
  if (error.status === 401) return { kind: "signed-out" };
  if (
    error.status === 422 &&
    error.problems.some(
      (p) => p.code === ApplicationProblemCodes.idempotencyKeyReused,
    )
  )
    return { kind: "key-reused" };
  if (
    error.code === BotProtectionErrorCodes.required ||
    error.code === BotProtectionErrorCodes.rejected
  )
    return { kind: "bot-protection" };
  if (error.status === 400 && error.problems.length > 0)
    return { kind: "fields", problems: error.problems };
  return { kind: "refused" };
}

/** EARS-10 — the applicant read as the page consumes it. */
export type OwnApplicationsRead =
  { ok: true; list: ApplicantApplicationList } | { ok: false };

/**
 * EARS-10 — «Ваша предыдущая заявка в работе…» shows above the form only when
 * the read succeeded with at least one open application; a failed read hides
 * it (the form stays either way).
 */
export function showRepeatBanner(read: OwnApplicationsRead): boolean {
  return read.ok && read.list.items.length > 0;
}

/**
 * EARS-8, EARS-9 — settles a `422 IDEMPOTENCY_KEY_REUSED` from the re-read: an
 * open application means the earlier send was stored, so the page shows
 * «Заявка отправлена». A failed read is the server-failure state with the
 * same key: the 422 proves the application is stored, so a retry must re-read
 * rather than create a second one (033 «One submission is one application»).
 * A read that succeeds with none offers the retry with a new key, never an
 * error that repeats on every send.
 */
export function keyReuseOutcome(read: OwnApplicationsRead): SubmissionEvent {
  if (!read.ok) return { type: "failed", failure: { kind: "unavailable" } };
  const stored = read.list.items[0];
  return stored
    ? {
        type: "succeeded",
        result: { id: stored.id, submittedAt: stored.submittedAt },
      }
    : { type: "rekey" };
}
