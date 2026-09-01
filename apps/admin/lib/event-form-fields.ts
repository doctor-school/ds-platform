import { STREAM_PROVIDERS, type EventAdminDetail } from "@ds/schemas";
import type { EventFormFields, StreamConfigFields } from "@/lib/form-schemas";
import { instantToMskInput } from "@/lib/msk";

/**
 * The server aggregate → form fields projection for the event detail surface
 * (007 EARS-2 aggregate edit, EARS-3 stream config).
 *
 * This lives beside the forms rather than inside them because it is not a
 * mount-time default: since #1593 the detail page re-reads the event on every
 * mutation AND on every refused lifecycle command, and the forms must FOLLOW that
 * re-read. The stale-refusal copy the owner approved states, in so many words,
 * that «данные на этой странице уже обновлены до актуального состояния» — a
 * promise the badge and the action bar already kept and the two forms did not,
 * because react-hook-form seeds `defaultValues` once and never again. Projecting
 * here and handing the result to react-hook-form's `values` prop makes the
 * promise true for the fields as well.
 *
 * Being a pure function of the DTO also keeps it in the admin's node unit tier,
 * where the projection is asserted without rendering React.
 */
export function eventFormFields(detail?: EventAdminDetail): EventFormFields {
  return {
    title: detail?.title ?? "",
    school: detail?.school ?? "",
    startsAtMsk: detail ? instantToMskInput(detail.startsAt) : "",
    durationMin: detail?.durationMin ?? 60,
    description: detail?.description ?? "",
    partnerRef: detail?.partnerRef ?? "",
    // Copied, not aliased: the field array mutates these rows in place, and a
    // projection that shared them with the fetched DTO would let an edit leak
    // into the cached detail (and back out on the next re-projection).
    speakers: detail?.speakers.map((s) => ({ ...s })) ?? [],
    specialtiesText: (detail?.specialties ?? []).join(", "),
  };
}

/** The stream-config half of the same projection (007 EARS-3). */
export function streamConfigFields(
  detail: EventAdminDetail,
): StreamConfigFields {
  return {
    provider: detail.streamConfig?.provider ?? STREAM_PROVIDERS[0],
    embedRef: detail.streamConfig?.embedRef ?? "",
  };
}

/**
 * How a refetched projection is applied to a form the operator may be typing in.
 *
 * `keepDirtyValues` is the whole point: a concurrent write from another operator
 * must correct the fields nobody here has touched, and must NOT throw away the
 * ones this operator has. Without it the honest re-read would be a data-loss bug
 * dressed as a fix — the operator's half-typed description would vanish the
 * moment somebody else saved the same event.
 */
export const FORM_SYNC_RESET_OPTIONS = { keepDirtyValues: true } as const;
