"use client";

import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { Button, Input, Label, Link } from "@ds/design-system";
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import type { EventAdminDetail, SpeakerEntry } from "@ds/schemas";
import { TokenTextarea } from "@/components/fields";
import { EventFormSchema, type EventFormFields } from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
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

function defaultFields(detail?: EventAdminDetail): EventFormFields {
  return {
    title: detail?.title ?? "",
    school: detail?.school ?? "",
    startsAtMsk: detail ? instantToMskInput(detail.startsAt) : "",
    durationMin: detail?.durationMin ?? 60,
    description: detail?.description ?? "",
    partnerRef: detail?.partnerRef ?? "",
    speakers: detail?.speakers.map((s) => ({ ...s })) ?? [],
    specialtiesText: (detail?.specialties ?? []).join(", "),
  };
}

const PDF_MIME = "application/pdf";

/**
 * The shared create/edit aggregate form (design §4, §8). Client-side validation
 * (#665) is DERIVED from the `@ds/schemas` SSOT via {@link EventFormSchema} and
 * rendered as inline RU messages (EARS-10) through the design-system `<FormMessage>`
 * — required / bounds (МСК datetime, duration ≥ 1, ≤ 24h, field lengths, per-token
 * specialty length). The server Zod DTO stays the authority; this only surfaces the
 * error before the round-trip. Validation fires on blur (`mode: onTouched`) so it
 * never nags mid-typing. Speakers are an ordered free-text list (LD-1) with
 * add/remove; every label/hint is from the RU catalog (EARS-10). `onSubmit` receives
 * the assembled {@link EventFormValues} — the page wires it to the Refine mutation.
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
  const form = useForm<EventFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      EventFormSchema as unknown as z.ZodType<EventFormFields, EventFormFields>,
    ),
    defaultValues: defaultFields(detail),
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "speakers",
  });
  // The program PDF is a File (not a JSON field), so it is validated here rather
  // than by the resolver — a non-PDF is refused with the RU catalog message.
  const [programPdf, setProgramPdf] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  function submit(fieldsValue: EventFormFields) {
    if (pdfError) return;
    onSubmit({
      title: fieldsValue.title,
      school: fieldsValue.school,
      startsAtMsk: fieldsValue.startsAtMsk,
      durationMin: Number(fieldsValue.durationMin),
      description: fieldsValue.description,
      speakers: fieldsValue.speakers,
      specialties: fieldsValue.specialtiesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      partnerRef: fieldsValue.partnerRef.trim() ? fieldsValue.partnerRef.trim() : null,
      programPdf,
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
              <FormLabel htmlFor="school">{t("events.fields.school")}</FormLabel>
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
                <FormLabel htmlFor="startsAtMsk">{t("events.fields.startsAtMsk")}</FormLabel>
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
                <FormLabel htmlFor="durationMin">{t("events.fields.durationMin")}</FormLabel>
                <FormControl>
                  <Input id="durationMin" type="number" inputMode="numeric" {...field} />
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
              <FormLabel htmlFor="description">{t("events.fields.description")}</FormLabel>
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
              <FormLabel htmlFor="specialties">{t("events.fields.specialties")}</FormLabel>
              <FormControl>
                <Input id="specialties" {...field} />
              </FormControl>
              <FormMessage>{t("events.fields.specialtiesHint")}</FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="partnerRef"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="partnerRef">{t("events.fields.partnerRef")}</FormLabel>
              <FormControl>
                <Input id="partnerRef" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Speakers — ordered free-text entries (LD-1). */}
        <h2 className="text-sm font-extrabold uppercase tracking-micro text-muted-foreground">
          {t("events.sections.speakers")}
        </h2>
        <div className="flex flex-col gap-3" data-testid="speakers">
          {fields.map((row, i) => (
            <div key={row.id} className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <FormField
                control={form.control}
                name={`speakers.${i}.name`}
                render={({ field }) => (
                  <FormItem className="sm:flex-1">
                    <FormControl>
                      <Input
                        aria-label={t("events.fields.speakerName")}
                        placeholder={t("events.fields.speakerName")}
                        data-testid={`speaker-name-${i}`}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`speakers.${i}.regalia`}
                render={({ field }) => (
                  <FormItem className="sm:flex-1">
                    <FormControl>
                      <Input
                        aria-label={t("events.fields.speakerRegalia")}
                        placeholder={t("events.fields.speakerRegalia")}
                        data-testid={`speaker-regalia-${i}`}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => remove(i)}
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
              // `shouldFocus: false`: auto-focusing the appended name input makes
              // the NEXT submit click blur it, and that blur-validation races the
              // submit-validation (RHF applies the stale field-level result last,
              // wiping the full error set — probed live, #665). Unfocused append
              // keeps one submit click = the complete error picture.
              onClick={() => append({ name: "", regalia: "" }, { shouldFocus: false })}
            >
              {t("events.fields.addSpeaker")}
            </Button>
          </div>
        </div>

        {/* Program PDF (EARS-1/2) — replaceable object-storage upload. */}
        <h2 className="text-sm font-extrabold uppercase tracking-micro text-muted-foreground">
          {t("events.sections.program")}
        </h2>
        {/* Not an RHF-controlled field (a File part, validated locally), so this is
            a plain labelled block — `FormItem`/`FormLabel` require a `<FormField>`
            context (`useFormField`) and throw outside one. */}
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="programPdf">{t("events.fields.programPdf")}</Label>
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
            <FormError data-testid="program-pdf-error">{pdfError}</FormError>
          ) : detail?.programPdfUrl ? (
            <p className="text-xs text-muted-foreground">
              {t("events.fields.programPdfReplaceHint")}
            </p>
          ) : null}
        </div>

        <div>
          <Button type="submit" loading={submitting} data-testid="submit-event">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
