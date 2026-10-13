import type { EventFormValues } from "@/components/event-form";
import type { CreateEventVars } from "@/providers/data-provider";

/**
 * The create form's values → multipart `POST /v1/admin/events` variables
 * (007 EARS-1, EARS-12; 012 EARS-26/29).
 *
 * The PLATFORM create only: an архивный эфир goes to the legacy route with its
 * own body (014 EARS-24). The project link is not part of the event body — the
 * page links it right after the create (012 EARS-30).
 */
export function eventCreateVars(values: EventFormValues): CreateEventVars {
  return {
    title: values.title,
    school: values.school,
    startsAtMsk: values.startsAtMsk,
    durationMin: values.durationMin,
    description: values.description,
    specialties: values.specialties,
    partnerRef: values.partnerRef,
    programPdf: values.programPdf,
    kindId: values.kindId,
    participationFormat: values.participationFormat,
    audience: values.audience,
    // 007 EARS-12 (#2913) — «Скрыть число записавшихся», default off.
    hideSignUpCount: values.hideSignUpCount,
  };
}
