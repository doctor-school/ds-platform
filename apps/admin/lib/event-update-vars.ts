import type { EventFormValues } from "@/components/event-form";
import type { UpdateEventVars } from "@/providers/data-provider";

/**
 * The edit form's values → `PATCH /v1/admin/events/:id` body projection
 * (007 EARS-2, 014 EARS-24).
 *
 * It exists as a pure function rather than an inline literal on the page because
 * one field is a real CONTRACT branch, not a rename: «Школа / серия» is required
 * on a platform broadcast (`CreateEventRequest.school` is `.min(1)`) and optional
 * on an архивный эфир (`LegacyBroadcastCreateBody.school` is `.max(200).default("")`,
 * because an эфир that predates the platform routinely predates the series taxonomy
 * too). `UpdateEventRequest.school` is `.min(1).optional()` — an update either
 * carries a NON-EMPTY school or omits the key. So a legacy эфир created without a
 * school could be created and then never saved again: the form dutifully sent
 * `school: ""` and the api refused the whole body with a 400 the operator could
 * only read as the generic «Не удалось сохранить изменения.».
 *
 * The fix belongs here and not in the schema: the server contract is the right one
 * — absent is not the same as blank, and a PATCH that blanks a required field is
 * exactly what `.min(1)` is there to refuse. What was wrong is the client turning
 * «this эфир has no school» into «set this эфир's school to empty».
 */
export function eventUpdateVars(
  values: EventFormValues,
  {
    legacy,
  }: {
    /**
     * Whether the эфир being edited is an архивный one — the server-assigned
     * `origin`, which is why the page passes it rather than the form: on EDIT the
     * `legacy` flag in {@link EventFormValues} is always `false` (it is the CREATE
     * route switch), and an эфир's origin is not a control the operator can change.
     */
    legacy: boolean;
  },
): UpdateEventVars {
  const school = values.school.trim();
  return {
    title: values.title,
    // Omitted, not emptied — and only on the legacy branch: a platform event keeps
    // the required rule, so its empty school is still SENT and still refused (the
    // resolver has already flagged it inline before the request goes out).
    ...(legacy && !school ? null : { school: values.school }),
    startsAtMsk: values.startsAtMsk,
    durationMin: values.durationMin,
    description: values.description,
    speakers: values.speakers,
    specialties: values.specialties,
    partnerRef: values.partnerRef,
    programPdf: values.programPdf,
  };
}
