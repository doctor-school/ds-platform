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
 * Deliberately NOT here (each is its own tracked deliverable, and a stand-in
 * rendered early would be a banned stub):
 *   • the player and its guest login gate — #1343 (EARS-5);
 *   • the «запись готовится» plaque carrying the readiness date — #1344
 *     (EARS-7), which is why `expectedBy` is read but never formatted here;
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
