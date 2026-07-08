"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Input, Link } from "@ds/design-system";
import type { EventAdminDetail, SpeakerEntry } from "@ds/schemas";
import { Field, TokenTextarea } from "@/components/fields";
import { instantToMskInput } from "@/lib/msk";

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
  speakers: SpeakerEntry[];
  specialties: string[];
  partnerRef: string | null;
  programPdf: File | null;
}

function initialValues(detail?: EventAdminDetail): EventFormValues {
  return {
    title: detail?.title ?? "",
    school: detail?.school ?? "",
    startsAtMsk: detail ? instantToMskInput(detail.startsAt) : "",
    durationMin: detail?.durationMin ?? 60,
    description: detail?.description ?? "",
    speakers: detail?.speakers.map((s) => ({ ...s })) ?? [],
    specialties: detail?.specialties ?? [],
    partnerRef: detail?.partnerRef ?? "",
    programPdf: null,
  };
}

/**
 * The shared create/edit aggregate form (design §4, §8). Stock DS inputs +
 * token-styled native controls (EARS-11); every label/hint from the RU catalog
 * (EARS-10). Speakers are an ordered free-text list (LD-1) with add/remove.
 * `onSubmit` receives the assembled {@link EventFormValues} (payload + optional
 * PDF) — the page wires it to the Refine `create`/`update` mutation.
 */
export function EventForm({
  detail,
  submitLabel,
  onSubmit,
  submitting,
}: {
  detail?: EventAdminDetail;
  submitLabel: string;
  onSubmit: (values: EventFormValues) => void;
  submitting?: boolean;
}) {
  const t = useTranslations();
  const [values, setValues] = useState<EventFormValues>(() =>
    initialValues(detail),
  );
  const [specialtiesText, setSpecialtiesText] = useState(
    (detail?.specialties ?? []).join(", "),
  );

  const set = <K extends keyof EventFormValues>(
    key: K,
    value: EventFormValues[K],
  ) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <form
      className="flex flex-col gap-5"
      data-testid="event-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...values,
          specialties: specialtiesText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          partnerRef: values.partnerRef?.trim() ? values.partnerRef.trim() : null,
        });
      }}
    >
      <h2 className="text-sm font-extrabold uppercase tracking-micro text-muted-foreground">
        {t("events.sections.details")}
      </h2>

      <Field label={t("events.fields.title")} htmlFor="title">
        <Input
          id="title"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          required
        />
      </Field>

      <Field label={t("events.fields.school")} htmlFor="school">
        <Input
          id="school"
          value={values.school}
          onChange={(e) => set("school", e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field
          label={t("events.fields.startsAtMsk")}
          htmlFor="startsAtMsk"
          hint={t("events.fields.startsAtHint")}
        >
          <Input
            id="startsAtMsk"
            type="datetime-local"
            value={values.startsAtMsk}
            onChange={(e) => set("startsAtMsk", e.target.value)}
            required
          />
        </Field>
        <Field label={t("events.fields.durationMin")} htmlFor="durationMin">
          <Input
            id="durationMin"
            type="number"
            min={1}
            value={values.durationMin}
            onChange={(e) => set("durationMin", Number(e.target.value))}
            required
          />
        </Field>
      </div>

      <Field label={t("events.fields.description")} htmlFor="description">
        <TokenTextarea
          id="description"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <Field
        label={t("events.fields.specialties")}
        htmlFor="specialties"
        hint={t("events.fields.specialtiesHint")}
      >
        <Input
          id="specialties"
          value={specialtiesText}
          onChange={(e) => setSpecialtiesText(e.target.value)}
        />
      </Field>

      <Field label={t("events.fields.partnerRef")} htmlFor="partnerRef">
        <Input
          id="partnerRef"
          value={values.partnerRef ?? ""}
          onChange={(e) => set("partnerRef", e.target.value)}
        />
      </Field>

      {/* Speakers — ordered free-text entries (LD-1). */}
      <h2 className="text-sm font-extrabold uppercase tracking-micro text-muted-foreground">
        {t("events.sections.speakers")}
      </h2>
      <div className="flex flex-col gap-3" data-testid="speakers">
        {values.speakers.map((sp, i) => (
          <div key={i} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Input
              className="sm:flex-1"
              aria-label={t("events.fields.speakerName")}
              placeholder={t("events.fields.speakerName")}
              value={sp.name}
              data-testid={`speaker-name-${i}`}
              onChange={(e) => {
                const next = [...values.speakers];
                next[i] = { ...next[i]!, name: e.target.value };
                set("speakers", next);
              }}
            />
            <Input
              className="sm:flex-1"
              aria-label={t("events.fields.speakerRegalia")}
              placeholder={t("events.fields.speakerRegalia")}
              value={sp.regalia}
              data-testid={`speaker-regalia-${i}`}
              onChange={(e) => {
                const next = [...values.speakers];
                next[i] = { ...next[i]!, regalia: e.target.value };
                set("speakers", next);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                set(
                  "speakers",
                  values.speakers.filter((_, j) => j !== i),
                )
              }
            >
              {t("events.fields.removeSpeaker")}
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="add-speaker"
            onClick={() =>
              set("speakers", [...values.speakers, { name: "", regalia: "" }])
            }
          >
            {t("events.fields.addSpeaker")}
          </Button>
        </div>
      </div>

      {/* Program PDF (EARS-1/2) — replaceable object-storage upload. */}
      <h2 className="text-sm font-extrabold uppercase tracking-micro text-muted-foreground">
        {t("events.sections.program")}
      </h2>
      <Field
        label={t("events.fields.programPdf")}
        htmlFor="programPdf"
        hint={
          detail?.programPdfUrl
            ? t("events.fields.programPdfReplaceHint")
            : undefined
        }
      >
        {detail?.programPdfUrl ? (
          <p className="text-xs text-muted-foreground" data-testid="program-current">
            {t("events.fields.programPdfCurrent")}:{" "}
            <Link asChild>
              <a href={detail.programPdfUrl} target="_blank" rel="noreferrer">
                {detail.programPdfRef}
              </a>
            </Link>
          </p>
        ) : null}
        <Input
          id="programPdf"
          type="file"
          accept="application/pdf"
          data-testid="program-pdf"
          onChange={(e) => set("programPdf", e.target.files?.[0] ?? null)}
        />
      </Field>

      <div>
        <Button type="submit" loading={submitting} data-testid="submit-event">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
