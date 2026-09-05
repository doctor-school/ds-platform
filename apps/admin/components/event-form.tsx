"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { Button, Checkbox, Input, Label, Link } from "@ds/design-system";
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  type AttachRecordingRequest,
  type EventAdminDetail,
  RECORDING_KINDS,
} from "@ds/schemas";
import { TokenSelect, TokenTextarea } from "@/components/fields";
import { RecordingSourceFieldSet } from "@/components/recording-source-fields";
import {
  FORM_SAVED_RESET_OPTIONS,
  FORM_SYNC_RESET_OPTIONS,
  eventFormFields,
} from "@/lib/event-form-fields";
import {
  EventEditFormSchema,
  EventFormSchema,
  type EventFormFields,
} from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

/**
 * The authored payload the form emits (007 EARS-1/2). The МСК wall-clock is the
 * raw `datetime-local` value (`YYYY-MM-DDTHH:mm`) the api folds into one canonical
 * instant; `specialties` is the parsed comma list; `programPdf` is the optional
 * file part (a create upload or an edit replacement).
 */
export interface EventFormValues {
  title: string;
  school: string;
  startsAtMsk: string;
  durationMin: number;
  description: string;
  specialties: string[];
  partnerRef: string | null;
  programPdf: File | null;
  /**
   * 014 EARS-24 — «Это архивный эфир». The page picks the ROUTE off this flag
   * (`POST /v1/admin/legacy-broadcasts` vs the ordinary multipart create); the
   * form never sends `origin`, which is server-assigned.
   */
  legacy: boolean;
  /**
   * The recording an архивный эфир is created WITH — `null` for a platform
   * event, which carries no recording at authoring time. Already normalized to
   * the API shape (empty optional boxes dropped, seconds parsed).
   */
  recording: AttachRecordingRequest | null;
}

const PDF_MIME = "application/pdf";

/**
 * The legacy half of the submitted payload (014 EARS-24).
 *
 * Split out of `submit` because it is where the checkbox stops being a
 * rendering concern and becomes a CONTRACT one: an unchecked form emits exactly
 * what it emitted before this feature existed, and a checked one emits the
 * `LegacyBroadcastCreateBody` shape — no sponsor, no programme file, and a
 * recording that is required rather than optional (the resolver has already
 * refused an empty one by the time this runs).
 */
function legacySubmission(
  values: EventFormFields,
): Pick<
  EventFormValues,
  "legacy" | "recording" | "partnerRef" | "programPdf"
> | null {
  if (!values.legacy) return null;
  return {
    legacy: true,
    partnerRef: null,
    programPdf: null,
    recording: {
      kind: values.recording.kind,
      provider: values.recording.provider,
      embedRef: values.recording.embedRef.trim(),
      // No poster and no duration: both are OPTIONAL in the SSOT body, and the
      // owner refused authoring them by hand on Stage B (2026-09-03) — a poster
      // is a file to upload and a duration is a fact to read off the recording's
      // metadata, delivered by #1611 (EARS-20). Omitted keys, not empty ones.
    },
  };
}

/**
 * The shared create/edit aggregate form (design §4, §8). Client-side validation
 * (#665) is DERIVED from the `@ds/schemas` SSOT via {@link EventFormSchema} and
 * rendered as inline RU messages (EARS-10) through the design-system `<FormMessage>`
 * — required / bounds (МСК datetime, duration ≥ 1, ≤ 24h, field lengths, per-token
 * specialty length). The server Zod DTO stays the authority; this only surfaces the
 * error before the round-trip. Validation fires on blur (`mode: onTouched`) so it
 * never nags mid-typing. 012 EARS-24 (#1607): the form carries NO speaker list —
 * since the cutover an эфир's speakers are `event_experts` links, authored in the
 * «Эксперты мероприятия» panel, so a free-text box here would be a second,
 * disagreeing source of the same public fact.
 * Every label/hint is from the RU catalog (EARS-10). `onSubmit` receives
 * the assembled {@link EventFormValues} — the page wires it to the Refine mutation.
 */
export function EventForm({
  detail,
  submitLabel,
  onSubmit,
  submitting,
  savedAt,
}: {
  detail?: EventAdminDetail;
  submitLabel: string;
  onSubmit: (values: EventFormValues) => void;
  submitting?: boolean;
  /**
   * Bumped by the page each time a save LANDS (#1593). The form owns no mutation,
   * so success is the page's fact to report; what the form does with it is
   * re-baseline itself on the values that were saved, which is the only thing
   * that keeps `keepDirtyValues` scoped to edits still in flight rather than to
   * every field ever touched on this mount.
   */
  savedAt?: number;
}) {
  const t = useTranslations();
  const form = useForm<EventFormFields>({
    mode: "onTouched",
    // Create and edit author the same aggregate, but only the create form
    // carries the «Запись» block — so only it may require one (#1849 review
    // BLOCKER: the edit form of an архивный эфир refused to save against a
    // recording it does not render).
    resolver: useLocalizedResolver(
      (detail ? EventEditFormSchema : EventFormSchema) as unknown as z.ZodType<
        EventFormFields,
        EventFormFields
      >,
    ),
    defaultValues: eventFormFields(detail),
    // The form FOLLOWS the server aggregate (#1593). The detail page re-reads the
    // event after every mutation and after every refused lifecycle command, and
    // until now only the badge and the action bar acted on that re-read — the
    // fields stayed frozen at whatever the mount saw, which made the approved
    // stale-refusal sentence («данные на этой странице уже обновлены…») false
    // about everything the operator was actually looking at. `values` re-projects
    // on each refetched detail; `keepDirtyValues` means the correction lands on
    // untouched fields only and never eats an edit in progress.
    values: detail ? eventFormFields(detail) : undefined,
    resetOptions: FORM_SYNC_RESET_OPTIONS,
  });
  // The program PDF is a File (not a JSON field), so it is validated here rather
  // than by the resolver — a non-PDF is refused with the RU catalog message.
  const [programPdf, setProgramPdf] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  // What the last submit sent — the baseline a landed save re-bases the form on.
  const submitted = useRef<EventFormFields | null>(null);
  // Which FIELD VARIANT this form renders (014 EARS-24). On CREATE it follows
  // the checkbox live; on EDIT it is the эфир's server-assigned `origin`, which
  // no control can change — an архивный эфир cannot become a platform broadcast
  // and vice versa, so the edit form reads the fact rather than offering it.
  const legacyChecked = form.watch("legacy");
  const legacyVariant = detail ? detail.origin === "legacy" : legacyChecked;
  // The recording block exists only while the эфир is being CREATED: after that
  // its recordings belong to the «Записи» tab, which owns publish/retire too.
  const isCreateLegacy = !detail && legacyChecked;

  useEffect(() => {
    if (!savedAt || !submitted.current) return;
    // Keyed on the save COUNTER only (`form` is a stable RHF handle): re-running
    // this on any other render would undo the operator's next keystrokes.
    form.reset(submitted.current, FORM_SAVED_RESET_OPTIONS);
  }, [savedAt, form]);

  function submit(fieldsValue: EventFormFields) {
    if (pdfError) return;
    submitted.current = fieldsValue;
    onSubmit({
      title: fieldsValue.title,
      school: fieldsValue.school,
      startsAtMsk: fieldsValue.startsAtMsk,
      durationMin: Number(fieldsValue.durationMin),
      description: fieldsValue.description,
      specialties: fieldsValue.specialtiesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      // The legacy branch OVERRIDES both of these with nothing on purpose: an
      // архивный эфир has neither a sponsor slot nor a programme file in its
      // API body, and the boxes it does not render must not smuggle values a
      // `.strict()` schema would refuse. Toggling the checkbox back restores
      // whatever was typed — the fields keep their state, only the payload
      // changes.
      partnerRef: fieldsValue.partnerRef.trim()
        ? fieldsValue.partnerRef.trim()
        : null,
      programPdf,
      legacy: false,
      recording: null,
      // Only on CREATE: the route choice and the recording are authoring
      // facts, and the detail page's update never carries either.
      ...(detail ? null : legacySubmission(fieldsValue)),
    });
  }

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-5"
        data-testid="event-form"
        noValidate
        onSubmit={form.handleSubmit(submit)}
      >
        <h2 className="text-sm font-extrabold uppercase tracking-micro text-muted-foreground">
          {t("events.sections.details")}
        </h2>

        {/* 014 EARS-24 — the ONE decision that shapes the rest of the form. On
            create it is the operator's checkbox; on edit it is the server's
            `origin`, which is not editable (an эфир cannot become a broadcast),
            so the edit form states it as a fact instead of offering a control. */}
        {detail ? (
          detail.origin === "legacy" ? (
            <p
              className="text-sm font-bold text-foreground"
              data-testid="legacy-badge"
            >
              {t("events.legacyBadge")}
            </p>
          ) : null
        ) : (
          <FormField
            control={form.control}
            name="legacy"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Checkbox
                    id="legacy"
                    data-testid="legacy-toggle"
                    checked={field.value}
                    name={field.name}
                    onBlur={field.onBlur}
                    onChange={(e) => field.onChange(e.target.checked)}
                    ref={field.ref}
                  >
                    {t("events.fields.legacyToggle")}
                  </Checkbox>
                </FormControl>
                <FormMessage>{t("events.fields.legacyToggleHint")}</FormMessage>
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="title">{t("events.fields.title")}</FormLabel>
              <FormControl>
                <Input id="title" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="school"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="school">
                {t("events.fields.school")}
              </FormLabel>
              <FormControl>
                <Input id="school" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startsAtMsk"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="startsAtMsk">
                  {legacyVariant
                    ? t("events.fields.heldAtMsk")
                    : t("events.fields.startsAtMsk")}
                </FormLabel>
                <FormControl>
                  <Input id="startsAtMsk" type="datetime-local" {...field} />
                </FormControl>
                <FormMessage>{t("events.fields.startsAtHint")}</FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="durationMin"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="durationMin">
                  {t("events.fields.durationMin")}
                </FormLabel>
                <FormControl>
                  <Input
                    id="durationMin"
                    type="number"
                    inputMode="numeric"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="description">
                {t("events.fields.description")}
              </FormLabel>
              <FormControl>
                <TokenTextarea id="description" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="specialtiesText"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="specialties">
                {t("events.fields.specialties")}
              </FormLabel>
              <FormControl>
                <Input id="specialties" {...field} />
              </FormControl>
              <FormMessage>{t("events.fields.specialtiesHint")}</FormMessage>
            </FormItem>
          )}
        />

        {/* No sponsor slot on an архивный эфир: the legacy body has no
            `partnerRef` at all (014-design §3.1), so offering the box would be
            offering a value the API refuses. */}
        {legacyVariant ? null : (
          <FormField
            control={form.control}
            name="partnerRef"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="partnerRef">
                  {t("events.fields.partnerRef")}
                </FormLabel>
                <FormControl>
                  <Input id="partnerRef" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* No programme file on an архивный эфир either — same reason as the
            sponsor slot: the legacy body carries no `programPdf` part. */}
        {legacyVariant ? null : (
          <>
            {/* Program PDF (EARS-1/2) — replaceable object-storage upload. */}
            <h2 className="text-sm font-extrabold uppercase tracking-micro text-muted-foreground">
              {t("events.sections.program")}
            </h2>
            {/* Not an RHF-controlled field (a File part, validated locally), so this is
              a plain labelled block — `FormItem`/`FormLabel` require a `<FormField>`
              context (`useFormField`) and throw outside one. */}
            <div className="flex flex-col gap-2.5">
              <Label htmlFor="programPdf">
                {t("events.fields.programPdf")}
              </Label>
              {detail?.programPdfUrl ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="program-current"
                >
                  {t("events.fields.programPdfCurrent")}:{" "}
                  <Link asChild>
                    <a
                      href={detail.programPdfUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {detail.programPdfRef}
                    </a>
                  </Link>
                </p>
              ) : null}
              <Input
                id="programPdf"
                type="file"
                accept={PDF_MIME}
                data-testid="program-pdf"
                aria-invalid={pdfError ? true : undefined}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  if (file && file.type !== PDF_MIME) {
                    setProgramPdf(null);
                    setPdfError(t("events.errors.invalidPdf"));
                    return;
                  }
                  setProgramPdf(file);
                  setPdfError(null);
                }}
              />
              {pdfError ? (
                <FormError data-testid="program-pdf-error">
                  {pdfError}
                </FormError>
              ) : detail?.programPdfUrl ? (
                <p className="text-xs text-muted-foreground">
                  {t("events.fields.programPdfReplaceHint")}
                </p>
              ) : null}
            </div>
          </>
        )}

        {/* The recording an архивный эфир exists to carry (014 EARS-24). It
            rides the SAME request as the event, so it is a section of this form
            rather than a follow-up step — a create that could succeed without
            one would leave an эфир that can never be archived. Only on CREATE:
            once the эфир exists, the «Записи» tab owns its recordings. */}
        {isCreateLegacy ? (
          <>
            <h2 className="text-sm font-extrabold uppercase tracking-micro text-muted-foreground">
              {t("events.sections.recording")}
            </h2>
            <div className="flex flex-col gap-5" data-testid="legacy-recording">
              <FormField
                control={form.control}
                name="recording.kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="legacy-recording-kind">
                      {t("events.fields.recordingKind")}
                    </FormLabel>
                    <FormControl>
                      <TokenSelect
                        id="legacy-recording-kind"
                        data-testid="legacy-recording-kind"
                        {...field}
                      >
                        {RECORDING_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {t(`recordings.kinds.${kind}`)}
                          </option>
                        ))}
                      </TokenSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <RecordingSourceFieldSet
                control={form.control}
                names={{
                  provider: "recording.provider",
                  embedRef: "recording.embedRef",
                }}
                fields="source"
                provider={form.watch("recording.provider")}
                idPrefix="legacy-recording"
              />
            </div>
          </>
        ) : null}

        <div>
          <Button type="submit" loading={submitting} data-testid="submit-event">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
