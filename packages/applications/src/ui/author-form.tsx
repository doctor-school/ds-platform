"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

import { AUTHOR_APPLICATION_FORMATS } from "@ds/schemas";
import { Avatar } from "@ds/design-system/avatar";
import { Alert } from "@ds/design-system/alert";
import { Button } from "@ds/design-system/button";
import { Checkbox } from "@ds/design-system/checkbox";
import { FilterChip } from "@ds/design-system/filter-chip";
import { Input } from "@ds/design-system/input";
import { Label } from "@ds/design-system/label";
import { Link } from "@ds/design-system/link";
import { Textarea } from "@ds/design-system/textarea";
import {
  BotProtectionField,
  type BotProtectionFieldProps,
  Combobox,
} from "@ds/design-system/blocks";

import { applicationsCopy as copy } from "../copy";
import {
  type AuthorFormErrors,
  type AuthorFormField,
  type AuthorFormValues,
  SPECIALTY_OTHER,
} from "../model/form";
import type { ApplyViewer, AuthorApplicationHost } from "./author-application";

/** One `specialties_minzdrav` entry as the select lists it. */
export interface AuthorSpecialty {
  code: string;
  name: string;
}

function RequiredTag() {
  return (
    <span className="ml-1.5 inline-block bg-tint px-1.75 py-0.5 text-2xs font-extrabold uppercase tracking-micro text-tint-foreground">
      {copy.form.required}
    </span>
  );
}

function FieldError({
  id,
  message,
}: {
  id: string;
  message?: string | undefined;
}) {
  if (!message) return null;
  return (
    <p
      id={id}
      className="mt-1.75 flex items-start gap-1.5 text-xs font-bold leading-label text-destructive-text"
    >
      <span aria-hidden="true">⚠</span>
      {message}
    </p>
  );
}

function initialsOf(viewer: ApplyViewer): string {
  const source = viewer.displayName?.trim() || viewer.email;
  const parts = source.split(/\s+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * 033 EARS-4, EARS-5, EARS-8 — the author form at the canvas «срез 1» layout:
 * «Отправите как …», «Тема», «Специальность» (the whole book with search, then
 * «Другое» and its text), «Формат», «О себе», the consent row, the server
 * failure banner with «Попробовать ещё раз» and «Отправить заявку». Every
 * error sits next to its field and never clears what was typed.
 */
export function AuthorForm({
  viewer,
  host,
  values,
  errors,
  focusField,
  sending,
  unavailable,
  notice,
  captchaFieldProps,
  disclosure,
  onChange,
  onSubmit,
}: {
  viewer: ApplyViewer;
  host: AuthorApplicationHost;
  values: AuthorFormValues;
  errors: AuthorFormErrors;
  focusField: { field: AuthorFormField } | null;
  sending: boolean;
  unavailable: boolean;
  notice: string | null;
  captchaFieldProps: Omit<BotProtectionFieldProps, "sitekey">;
  disclosure?: ReactNode;
  onChange: (patch: Partial<AuthorFormValues>) => void;
  onSubmit: () => void;
}) {
  const uid = useId();
  const ids = {
    topic: `${uid}-topic`,
    specialty: `${uid}-specialty`,
    specialtyOther: `${uid}-specialty-other`,
    format: `${uid}-format`,
    about: `${uid}-about`,
    consent: `${uid}-consent`,
  } satisfies Record<AuthorFormField, string>;
  const err = (f: AuthorFormField) => `${ids[f]}-error`;
  const formRef = useRef<HTMLFormElement>(null);

  // EARS-5 — the first field to fix takes focus (a fresh object per attempt).
  useEffect(() => {
    if (!focusField) return;
    const root = formRef.current;
    const target =
      focusField.field === "format"
        ? root?.querySelector<HTMLElement>(`#${CSS.escape(ids.format)} button`)
        : root?.querySelector<HTMLElement>(
            `#${CSS.escape(ids[focusField.field])}`,
          );
    target?.focus();
    // `ids` derives from `useId`, stable for the component's life.
  }, [focusField]);

  const specialtyOptions = [
    ...host.specialties.map((s) => ({ value: s.code, label: s.name })),
    { value: SPECIALTY_OTHER, label: copy.form.specialtyOther },
  ];
  const isOther = values.specialty === SPECIALTY_OTHER;
  const sendingAs = viewer.displayName
    ? copy.form.sendingAs(viewer.displayName, viewer.email)
    : copy.form.sendingAsEmail(viewer.email);

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={copy.page.title}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-5 border-2 border-border bg-card p-6 shadow-lg md:p-9"
    >
      <p className="flex items-center gap-2.5 border-2 border-hairline bg-section px-3.5 py-2.75 text-xs font-bold text-muted-foreground">
        <Avatar
          variant="tint"
          aria-hidden="true"
          className="size-6 flex-none text-eyebrow"
        >
          {initialsOf(viewer)}
        </Avatar>
        <span className="min-w-0 break-words">
          {sendingAs}
          {copy.form.sendingAsTail}
        </span>
      </p>

      <div>
        <Label htmlFor={ids.topic} className="mb-1.75 block">
          {copy.form.topic} <RequiredTag />
        </Label>
        <Input
          id={ids.topic}
          required
          value={values.topic}
          placeholder={copy.form.topicPlaceholder}
          aria-invalid={errors.topic ? true : undefined}
          aria-describedby={errors.topic ? err("topic") : undefined}
          onChange={(e) => onChange({ topic: e.target.value })}
        />
        <FieldError id={err("topic")} message={errors.topic} />
      </div>

      <div>
        <Label htmlFor={ids.specialty} className="mb-1.75 block">
          {copy.form.specialty}
        </Label>
        <Combobox
          id={ids.specialty}
          options={specialtyOptions}
          value={values.specialty || null}
          onValueChange={(specialty) => onChange({ specialty })}
          placeholder={copy.form.specialtyPlaceholder}
          searchLabel={copy.form.specialtySearch}
          searchPlaceholder={copy.form.specialtySearch}
          emptyLabel={copy.form.specialtyEmpty}
          invalid={Boolean(errors.specialty)}
          aria-describedby={
            errors.specialty ? err("specialty") : `${ids.specialty}-hint`
          }
        />
        <p
          id={`${ids.specialty}-hint`}
          className="mt-1.75 text-xs font-semibold text-faint"
        >
          {copy.form.specialtyHint}
        </p>
        <FieldError id={err("specialty")} message={errors.specialty} />
      </div>

      {isOther ? (
        <div>
          <Label htmlFor={ids.specialtyOther} className="mb-1.75 block">
            {copy.form.specialtyOtherLabel} <RequiredTag />
          </Label>
          <Input
            id={ids.specialtyOther}
            required
            value={values.specialtyOther}
            aria-invalid={errors.specialtyOther ? true : undefined}
            aria-describedby={
              errors.specialtyOther ? err("specialtyOther") : undefined
            }
            onChange={(e) => onChange({ specialtyOther: e.target.value })}
          />
          <FieldError
            id={err("specialtyOther")}
            message={errors.specialtyOther}
          />
        </div>
      ) : null}

      <div>
        <div
          id={ids.format}
          role="group"
          aria-labelledby={`${ids.format}-label`}
          aria-describedby={errors.format ? err("format") : undefined}
        >
          <p
            id={`${ids.format}-label`}
            className="mb-1.75 text-xs font-bold leading-none text-foreground"
          >
            {copy.form.format} <RequiredTag />
          </p>
          <div className="flex flex-wrap gap-2">
            {AUTHOR_APPLICATION_FORMATS.map((f) => (
              <FilterChip
                key={f}
                selected={values.format === f}
                className={
                  errors.format && values.format !== f
                    ? "border-destructive-text"
                    : undefined
                }
                onClick={() => onChange({ format: f })}
              >
                {copy.form.formats[f]}
              </FilterChip>
            ))}
          </div>
        </div>
        <FieldError id={err("format")} message={errors.format} />
      </div>

      <div>
        <Label htmlFor={ids.about} className="mb-1.75 block">
          {copy.form.about}
        </Label>
        <Textarea
          id={ids.about}
          rows={3}
          value={values.about}
          placeholder={copy.form.aboutPlaceholder}
          aria-invalid={errors.about ? true : undefined}
          aria-describedby={errors.about ? err("about") : undefined}
          onChange={(e) => onChange({ about: e.target.value })}
        />
        <FieldError id={err("about")} message={errors.about} />
      </div>

      <div className="border-t-2 border-hairline pt-4">
        <Checkbox
          id={ids.consent}
          checked={values.consent}
          aria-invalid={errors.consent ? true : undefined}
          aria-describedby={`${ids.consent}-hint${errors.consent ? ` ${err("consent")}` : ""}`}
          onChange={(e) => onChange({ consent: e.target.checked })}
          className="items-start"
        >
          {copy.form.consent}
        </Checkbox>
        <p
          id={`${ids.consent}-hint`}
          className="ml-8.5 mt-1 text-xs leading-normal text-faint"
        >
          {copy.form.consentHint}{" "}
          <Link href={host.policyHref} variant="inline">
            {copy.form.consentPolicy}
          </Link>
        </p>
        <div className="ml-8.5">
          <FieldError id={err("consent")} message={errors.consent} />
        </div>
      </div>

      {unavailable ? (
        <Alert variant="danger" data-testid="apply-unavailable">
          <b>{copy.unavailable.lead}</b> {copy.unavailable.rest}{" "}
          <Button
            type="button"
            variant="link"
            className="p-0 text-caption"
            onClick={onSubmit}
          >
            {copy.unavailable.retry}
          </Button>
        </Alert>
      ) : null}
      {notice ? <Alert variant="warn">{notice}</Alert> : null}

      <div>
        <BotProtectionField
          sitekey={host.botProtectionSiteKey}
          {...captchaFieldProps}
        />
        <Button type="submit" size="lg" className="w-full" loading={sending}>
          {sending ? copy.form.sending : copy.form.submit}
        </Button>
        {disclosure ? <div className="mt-2.5">{disclosure}</div> : null}
      </div>
    </form>
  );
}
