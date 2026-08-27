"use client";

import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { Button, NativeSelect } from "@ds/design-system";
import {
  Combobox,
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
import type {
  DirectionAdjacencyAdminDetail,
  DirectionAdjacencyKind,
} from "@ds/schemas";
import {
  DirectionAdjacencyFormSchema,
  type DirectionAdjacencyFormFields,
} from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import { useDirectionAdjacencyKindOptions } from "@/lib/direction-relation-options";
import type { DirectionSpecialtyOption } from "@/components/direction-specialty-form";

/**
 * #1483 — the direction adjacency form (ADR-0016 §5; 017-design §5 and §9.3,
 * EARS-18). Create and edit share one shape, exactly as the event↔expert link
 * form does, with the one asymmetry the API itself enforces: the two ENDPOINTS
 * are the edge's identity, so the edit renders them read-only. Moving an edge is
 * retiring one and authoring another (`direction-adjacency.admin.controller.ts`),
 * and a PATCH carrying an endpoint is a 400 — so the form declines to offer the
 * move rather than letting the operator discover the refusal after submit.
 *
 * The edge is DIRECTED by decision (see `direction_adjacency` in `@ds/db`): «А
 * смежно с Б» is one authored row and does not imply the reverse. The form says so
 * in the section description, because a symmetric reading is the intuitive one and
 * getting it wrong silently halves an operator's intended targeting.
 *
 * LAYOUT is the `Form*` Field family (#1578, owner Stage-A pick «ruled sections»):
 * the identity of the edge and the label put on it are two different decisions, so
 * they are two hairline-separated sections with statement headings, and the single
 * terminal `FormActions` row keeps «сохранено» unambiguous.
 *
 * `kind` is a CLOSED vocabulary rendered as the `Combobox` block, not a free-text
 * box: the value set is the pg enum `direction_adjacency_kind`, and each member
 * needs a sentence of explanation an operator cannot infer from its label — which
 * is precisely what a native select cannot carry.
 *
 * `weight` has no box at all. It is a tuning parameter of targeting resolution
 * with a server default; a number nobody can reason about is not a field
 * (017-design §9.3).
 */

export interface DirectionAdjacencyFormValues {
  directionId: string;
  adjacentDirectionId: string;
  kind: DirectionAdjacencyKind;
}

function defaults(
  detail?: DirectionAdjacencyAdminDetail,
): DirectionAdjacencyFormFields {
  return {
    directionId: detail?.directionId ?? "",
    adjacentDirectionId: detail?.adjacentDirectionId ?? "",
    kind: detail?.kind ?? "",
  };
}

export function DirectionAdjacencyForm({
  detail,
  directions,
  submitLabel,
  onSubmit,
  submitting,
}: {
  detail?: DirectionAdjacencyAdminDetail;
  directions: DirectionSpecialtyOption[];
  submitLabel: string;
  onSubmit: (values: DirectionAdjacencyFormValues) => void;
  submitting?: boolean;
}) {
  const t = useTranslations();
  const kindOptions = useDirectionAdjacencyKindOptions();
  const endpointsLocked = detail !== undefined;
  const form = useForm<DirectionAdjacencyFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      DirectionAdjacencyFormSchema as unknown as z.ZodType<
        DirectionAdjacencyFormFields,
        DirectionAdjacencyFormFields
      >,
      "directionAdjacency.validation",
    ),
    defaultValues: defaults(detail),
  });

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-6 border-2 border-hairline bg-card p-6"
        data-testid="direction-adjacency-form"
        noValidate
        onSubmit={form.handleSubmit((fields) =>
          onSubmit({
            directionId: fields.directionId,
            adjacentDirectionId: fields.adjacentDirectionId,
            // Reached only after the resolver accepted the field, and the
            // resolver is the SSOT enum — so the `""` placeholder can never get
            // this far. No trim: an enum member is not typed text.
            kind: fields.kind as DirectionAdjacencyKind,
          }),
        )}
      >
        <FormSection
          legend={t("directionAdjacency.sections.endpoints")}
          description={
            endpointsLocked
              ? t("directionAdjacency.fields.endpointsLockedHint")
              : t("directionAdjacency.sections.endpointsDescription")
          }
          locked={endpointsLocked}
        >
          <FormFieldGroup columns="two">
            <FormField
              control={form.control}
              name="directionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="directionId">
                    {t("directionAdjacency.fields.direction")}
                  </FormLabel>
                  <FormControl>
                    <NativeSelect
                      id="directionId"
                      data-testid="direction-adjacency-direction"
                      {...field}
                    >
                      <option value="">
                        {t("directionAdjacency.fields.directionPlaceholder")}
                      </option>
                      {directions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage>
                    {t("directionAdjacency.fields.directionHint")}
                  </FormMessage>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="adjacentDirectionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="adjacentDirectionId">
                    {t("directionAdjacency.fields.adjacentDirection")}
                  </FormLabel>
                  <FormControl>
                    <NativeSelect
                      id="adjacentDirectionId"
                      data-testid="direction-adjacency-adjacent"
                      {...field}
                    >
                      <option value="">
                        {t("directionAdjacency.fields.directionPlaceholder")}
                      </option>
                      {directions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage>
                    {t("directionAdjacency.fields.adjacentDirectionHint")}
                  </FormMessage>
                </FormItem>
              )}
            />
          </FormFieldGroup>
        </FormSection>

        <FormSection
          legend={t("directionAdjacency.sections.kind")}
          description={t("directionAdjacency.sections.kindDescription")}
        >
          <FormField
            control={form.control}
            name="kind"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel htmlFor="kind">
                  {t("directionAdjacency.fields.kind")}
                </FormLabel>
                <FormControl>
                  {/* Three explained options: below the scanning threshold, so
                      the panel's own query box would be furniture — `showSearch`
                      is off and the explanation lines carry the choice. */}
                  <Combobox
                    id="kind"
                    options={kindOptions}
                    value={field.value}
                    onValueChange={(value) =>
                      field.onChange(value as DirectionAdjacencyKind)
                    }
                    placeholder={t("directionAdjacency.fields.kindPlaceholder")}
                    searchLabel={t("directionAdjacency.fields.kind")}
                    searchPlaceholder={t(
                      "directionAdjacency.fields.kindSearchPlaceholder",
                    )}
                    emptyLabel={t("directionAdjacency.fields.kindEmpty")}
                    showSearch={false}
                    invalid={fieldState.invalid}
                  />
                </FormControl>
                <FormMessage>
                  {t("directionAdjacency.fields.kindHint")}
                </FormMessage>
              </FormItem>
            )}
          />
        </FormSection>

        <FormActions>
          <Button
            type="submit"
            loading={submitting}
            data-testid="submit-direction-adjacency"
          >
            {submitLabel}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
