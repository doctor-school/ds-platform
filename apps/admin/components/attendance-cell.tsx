"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@ds/design-system";
import {
  attendanceFailureKind,
  congressDayLongLabel,
  congressDayShortLabel,
  type AttendanceFailureKind,
} from "@/lib/congress-roster";
import { putCongressAttendance } from "@/providers/data-provider";

/**
 * 044 EARS-34 — the roster's «Присутствие» cell: one `Checkbox` per congress
 * day, visible label «23.04», accessible name «Присутствие 23 апреля». A click
 * is the whole act — no save button: the box flips at once, the PUT follows,
 * and the box stays disabled while it is in flight. A refused mark reverts the
 * box and says so on the control (`aria-invalid`) and in one short line:
 * - `forbidden` (grant/session gone) — never retried; the page re-reads its
 *   list, whose own refusal then replaces the roster (`onForbidden`);
 * - `unavailable` (IdP revalidation / network down) — retryable copy;
 * - `failed` — anything else.
 * A successful mark calls `onMarked`, so a page with an active presence filter
 * can re-read the list and the row leaves or joins the filtered set.
 */
export function AttendanceCell({
  eventId,
  registrationId,
  days,
  attendance,
  onMarked,
  onForbidden,
}: {
  eventId: string;
  registrationId: string;
  days: string[];
  attendance: Array<{ day: string; present: boolean }>;
  onMarked: () => void;
  onForbidden: () => void;
}) {
  const t = useTranslations("congressRoster");
  const serverMarks = () =>
    Object.fromEntries(attendance.map((mark) => [mark.day, mark.present]));
  const [marks, setMarks] = useState<Record<string, boolean>>(serverMarks);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [failure, setFailure] = useState<{
    day: string;
    kind: AttendanceFailureKind;
  } | null>(null);

  // A re-read of the list (paging, filter, refetch) is the new truth — adopted
  // during render when the server's marks change (React's "adjust state on a
  // prop change" pattern, no effect round-trip).
  const attendanceKey = JSON.stringify(attendance);
  const [seenKey, setSeenKey] = useState(attendanceKey);
  if (seenKey !== attendanceKey) {
    setSeenKey(attendanceKey);
    setMarks(serverMarks());
  }

  async function toggle(day: string, present: boolean) {
    setFailure(null);
    setMarks((current) => ({ ...current, [day]: present }));
    setPending((current) => ({ ...current, [day]: true }));
    const result = await putCongressAttendance(
      eventId,
      registrationId,
      day,
      present,
    );
    setPending((current) => ({ ...current, [day]: false }));
    if (result.ok) {
      onMarked();
      return;
    }
    setMarks((current) => ({ ...current, [day]: !present }));
    const kind = attendanceFailureKind(result.status);
    setFailure({ day, kind });
    if (kind === "forbidden") onForbidden();
  }

  return (
    <div className="flex flex-col gap-1" data-testid="attendance-cell">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {days.map((day) => (
          <Checkbox
            key={day}
            checked={marks[day] ?? false}
            disabled={pending[day] ?? false}
            aria-label={t("attendance.dayLabel", {
              day: congressDayLongLabel(day),
            })}
            aria-invalid={failure?.day === day ? true : undefined}
            data-testid={`attendance-${day}`}
            onChange={(event) => void toggle(day, event.target.checked)}
          >
            <span className="text-sm">{congressDayShortLabel(day)}</span>
          </Checkbox>
        ))}
      </div>
      {failure ? (
        <p
          role="alert"
          className="text-xs text-destructive-text"
          data-testid="attendance-error"
        >
          {t(`errors.attendance.${failure.kind}`)}
        </p>
      ) : null}
    </div>
  );
}
