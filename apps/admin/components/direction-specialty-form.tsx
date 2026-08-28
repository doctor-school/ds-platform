"use client";

import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { Button, NativeSelect } from "@ds/design-system";
import {
  FormActions,
  FormFieldGroup,
  FormSection,
} from "@ds/design-system/blocks";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  DirectionSpecialtyFormSchema,
  type DirectionSpecialtyFormFields,
} from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

/**
 * #1483 — the direction↔specialty link authoring form (ADR-0016 §5; 017-design §5).
 *
 * It is a CREATE-only form, and that is the entity's shape rather than a missing
 * feature: the link carries no attribute of its own, so the API exposes no PATCH
 * (`direction-specialties.admin.controller.ts` — the same reasoning `event_projects`
 * follows). Re-pointing a link is retiring one and authoring another, which keeps
 * the audit lineage of each pair single. A form offering an "edit" the server has
 * no route for would be a promise the platform cannot keep.
 *
 * Both endpoints are NativeSelects over the resource lists the page loads, not
 * free-text id boxes: an operator picks «Кардиология» and «Кардиология (31.08.36)»,
 * never a UUID. The two option sets are passed IN rather than fetched here so this
 * component stays presentational and the page owns its queries — the same split
 * `direction-form.tsx` and `event-experts-panel.tsx` keep.
 */

export interface DirectionSpecialtyOption {
  id: string;
  label: string;
}

export interface DirectionSpecialtyFormValues {
  directionId: string;
  specialtyMinzdravId: string;
}

export function DirectionSpecialtyForm({
  directions,
  specialties,
  submitLabel,
  onSubmit,
  submitting,
}: {
  directions: DirectionSpecialtyOption[];
  specialties: DirectionSpecialtyOption[];
  submitLabel: string;
  onSubmit: (values: DirectionSpecialtyFormValues) => void;
  submitting?: boolean;
}) {
  const t = useTranslations();
  const form = useForm<DirectionSpecialtyFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      DirectionSpecialtyFormSchema as unknown as z.ZodType<
        DirectionSpecialtyFormFields,
        DirectionSpecialtyFormFields
      >,
      "directionSpecialties.validation",
    ),
    defaultValues: { directionId: "", specialtyMinzdravId: "" },
  });

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-6 border-2 border-hairline bg-card p-6"
        data-testid="direction-specialty-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => onSubmit(fields))}
      >
        <FormSection
          legend={t("directionSpecialties.sections.link")}
          description={t("directionSpecialties.sections.linkDescription")}
        >
        <FormFieldGroup columns="two">
        <FormField
          control={form.control}
          name="directionId"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="directionId">
                {t("directionSpecialties.fields.direction")}
              </FormLabel>
              <FormControl>
                <NativeSelect
                  id="directionId"
                  data-testid="direction-specialty-direction"
                  {...field}
                >
                  <option value="">
                    {t("directionSpecialties.fields.directionPlaceholder")}
                  </option>
                  {directions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
              <FormMessage>
                {t("directionSpecialties.fields.directionHint")}
              </FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="specialtyMinzdravId"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="specialtyMinzdravId">
                {t("directionSpecialties.fields.specialty")}
              </FormLabel>
              <FormControl>
                <NativeSelect
                  id="specialtyMinzdravId"
                  data-testid="direction-specialty-specialty"
                  {...field}
                >
                  <option value="">
                    {t("directionSpecialties.fields.specialtyPlaceholder")}
                  </option>
                  {specialties.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
              {/* The book is CLOSED (#1479): the operator picks from the
                  Минздрав nomenclature and cannot author a specialty here. */}
              <FormMessage>
                {t("directionSpecialties.fields.specialtyHint")}
              </FormMessage>
            </FormItem>
          )}
        />

        </FormFieldGroup>
        </FormSection>

        <FormActions>
          <Button
            type="submit"
            loading={submitting}
            data-testid="submit-direction-specialty"
          >
            {submitLabel}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
