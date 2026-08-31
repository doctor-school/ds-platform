import type { RecordingProjection } from "@ds/schemas";
import type { CanvasStatus } from "./event-lifecycle";

/**
 * 014 EARS-4 — the post-live recording SIGNAL: what the event page says about
 * the recording, derived from the api's source-free `RecordingProjection` and
 * the 004 lifecycle status.
 *
 * This is a thin HOST PROJECTION in the sense of ADR-0013 A1, not a second
 * source of truth: the api's `recordings.projection` already decided WHICH
 * recording is primary (the EARS-3 montage-wins rule), and this module only
 * decides whether the page speaks about it at all and under which catalog key.
 * The listing card (#1340) makes the same translation host-side and hands the
 * DS primitive a plain label string — the page follows that precedent rather
 * than teaching a second component about recording states.
 *
 * 014 EARS-7 (#1344) added the second projection below — the «запись готовится»
 * PLAQUE, which is where `expectedBy` finally gets formatted.
 *
 * Deliberately NOT here (each is its own tracked deliverable, and a stand-in
 * rendered early would be a banned stub):
 *   • the player and its guest login gate — #1343 (EARS-5);
 *   • the raw-original spoiler under a montage — #1345 (EARS-8), which is why
 *     `secondaryKind` produces no affordance.
 */
export interface RecordingSignal {
  /**
   * Catalog key under `webinar.recordingBadge.*` for the hero badge — the
   * canvas's «Запись доступна» / «Запись готовится» plate.
   */
  badgeKey: "available" | "preparing";
  /** Whether the badge reads as a positive result (drives the badge variant). */
  available: boolean;
  /**
   * Catalog key under `webinar.recordingKind.*` for the meta line's kind label
   * («Монтаж» / «Оригинал»), or `null` while nothing is published yet — the
   * canvas prints no kind for a recording that does not exist.
   */
  kindKey: "edited" | "raw" | null;
}

/**
 * The signal for this page render, or `null` when the page must stay silent
 * about the recording.
 *
 * Silence is the answer in three cases, and each is a product rule rather than
 * a missing branch:
 *   • `upcoming` / `live` — the broadcast has not happened, so a recording
 *     signal would contradict the lifecycle machine the rest of the page reads;
 *   • `archived` — 004 EARS-5 owns that render whole: an archived event shows
 *     the «в архиве» notice and NOTHING else, so the recording signal must not
 *     add a second, competing message to it (the api still answers truthfully;
 *     the page simply does not speak).
 *
 * `ended` is therefore the only state that speaks, which matches the canvas —
 * `webinar-archive.dc.html` is a post-live artboard.
 */
export function resolveRecordingSignal(
  recording: RecordingProjection,
  status: CanvasStatus,
): RecordingSignal | null {
  if (status !== "ended") return null;
  if (recording.state === "preparing") {
    return { badgeKey: "preparing", available: false, kindKey: null };
  }
  // `montage` / `raw-only` both mean «there is something published». The KIND
  // label comes from `primaryKind` (what a viewer would actually get), not from
  // the state name, so a `raw-only` page says «Оригинал» rather than restating
  // the state machine's vocabulary at the doctor.
  return {
    badgeKey: "available",
    available: true,
    kindKey: recording.primaryKind ?? "raw",
  };
}

/**
 * 014 EARS-7 — what the «запись готовится» PLAQUE says, or `null` when the page
 * shows no plaque at all.
 *
 * The plaque exists EXACTLY while the projection says `preparing` on an `ended`
 * event. That is the whole self-clearing mechanism required by EARS-7 and there
 * is deliberately no second one: the event page is `force-dynamic`, so the next
 * request after the operator publishes re-reads a `montage` / `raw-only` state
 * and this resolver returns `null` — the plaque disappears without any client
 * timer, polling loop, or cached "we already promised" flag to go stale. It
 * returns just as truthfully if a recording is later unpublished or retired.
 */
export interface RecordingPlaque {
  /**
   * The operator's committed readiness day, formatted for RU display («18 июля»,
   * or «18 июля 2027» across a year boundary), or `null` when the operator
   * committed to no day. `null` selects the honest date-free body copy — the
   * page never invents an estimate to fill the gap (the canvas's «≈2 дня» is
   * placeholder art, not a product promise).
   */
  expectedByLabel: string | null;
}

export function resolveRecordingPlaque(
  recording: RecordingProjection,
  status: CanvasStatus,
  now: Date = new Date(),
): RecordingPlaque | null {
  const signal = resolveRecordingSignal(recording, status);
  if (!signal || signal.badgeKey !== "preparing") return null;
  return { expectedByLabel: formatReadinessDay(recording.expectedBy, now) };
}

/** RU genitive month names — «18 июля», the form a date reads in running copy. */
const RU_MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

/**
 * Format `events.recording_expected_by` (a plain `YYYY-MM-DD` DAY) for display.
 *
 * Parsed as calendar FIELDS, never through `new Date(value)` + a timezone: the
 * contract carries a day, not an instant, so any timezone conversion could shift
 * the operator's promise by one day for a reader east or west of the server — a
 * silently wrong promise is worse than none. The year is appended only when it
 * differs from the reading year, because «18 июля 2026» read in 2026 is noise
 * while «18 июля 2027» read in 2026 is the whole point.
 *
 * Returns `null` for a missing or unparseable value — the caller then renders
 * the date-free copy rather than a broken string.
 */
export function formatReadinessDay(
  expectedBy: string | null,
  now: Date = new Date(),
): string | null {
  if (!expectedBy) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(expectedBy);
  if (!match) return null;
  const [, yearRaw, monthRaw, dayRaw] = match;
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const day = Number(dayRaw);
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const label = `${day} ${RU_MONTHS_GENITIVE[monthIndex]}`;
  return year === now.getFullYear() ? label : `${label} ${year}`;
}
