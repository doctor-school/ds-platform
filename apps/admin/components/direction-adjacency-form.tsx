"use client";

import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { Button, Input, NativeSelect } from "@ds/design-system";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  DIRECTION_ADJACENCY_WEIGHT_MAX,
  DIRECTION_ADJACENCY_WEIGHT_MIN,
  type DirectionAdjacencyAdminDetail,
} from "@ds/schemas";
import {
  DirectionAdjacencyFormSchema,
  type DirectionAdjacencyFormFields,
} from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import type { DirectionSpecialtyOption } from "@/components/direction-specialty-form";

/**
 * #1483 — the direction adjacency form (ADR-0016 §5; 017-design §5). Create and
 * edit share one shape, exactly as the event↔expert link form does, with the one
 * asymmetry the API itself enforces: the two ENDPOINTS are the edge's identity, so
 * the edit renders them read-only. Moving an edge is retiring one and authoring
 * another (`direction-adjacency.admin.controller.ts`), and a PATCH carrying an
 * endpoint is a 400 — so the form declines to offer the move rather than letting
 * the operator discover the refusal after submit.
 *
 * The edge is DIRECTED by decision (see `direction_adjacency` in `@ds/db`): «А
 * смежно с Б» is one authored row and does not imply the reverse. The form says so
 * under the adjacent-direction box, because a symmetric reading is the intuitive
 * one and getting it wrong silently halves an operator's intended targeting.
 *
 * `kind` is a free-text slug box, not a fixed select: ADR-0016 §2.8 names `kind`
 * without fixing its values, so the contract pins the SHAPE (lowercase slug, ≤64)
 * and leaves which labels exist an editorial matter. `weight` is a text box folded
 * through the SSOT bound — see `DirectionAdjacencyFormSchema` for why not
 * `<input type="number">`.
 */

export interface DirectionAdjacencyFormValues {
  directionId: string;
  adjacentDirectionId: string;
  kind: string;
  weight: number;
}

function defaults(
  detail?: DirectionAdjacencyAdminDetail,
): DirectionAdjacencyFormFields {
  return {
    directionId: detail?.directionId ?? "",
    adjacentDirectionId: detail?.adjacentDirectionId ?? "",
    kind: detail?.kind ?? "",
    weightText: detail ? String(detail.weight) : "",
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
        className="flex flex-col gap-5"
        data-testid="direction-adjacency-form"
        noValidate
        onSubmit={form.handleSubmit((fields) =>
          onSubmit({
            directionId: fields.directionId,
            adjacentDirectionId: fields.adjacentDirectionId,
            kind: fields.kind.trim(),
            weight: Number(fields.weightText.trim()),
          }),
        )}
      >
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
                  disabled={endpointsLocked}
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
                {endpointsLocked
                  ? t("directionAdjacency.fields.endpointsLockedHint")
                  : t("directionAdjacency.fields.directionHint")}
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
                  disabled={endpointsLocked}
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

        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="kind">
                {t("directionAdjacency.fields.kind")}
              </FormLabel>
              <FormControl>
                <Input
                  id="kind"
                  data-testid="direction-adjacency-kind"
                  {...field}
                />
              </FormControl>
              <FormMessage>
                {t("directionAdjacency.fields.kindHint")}
              </FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="weightText"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="weightText">
                {t("directionAdjacency.fields.weight")}
              </FormLabel>
              <FormControl>
                {/* `inputMode` numeric, but a TEXT input: see the form schema —
                    a number input hands React "" for a partly-numeric entry, so
                    the refusal would lose the value the operator actually typed. */}
                <Input
                  id="weightText"
                  inputMode="numeric"
                  data-testid="direction-adjacency-weight"
                  {...field}
                />
              </FormControl>
              <FormMessage>
                {t("directionAdjacency.fields.weightHint", {
                  min: DIRECTION_ADJACENCY_WEIGHT_MIN,
                  max: DIRECTION_ADJACENCY_WEIGHT_MAX,
                })}
              </FormMessage>
            </FormItem>
          )}
        />

        <div>
          <Button
            type="submit"
            loading={submitting}
            data-testid="submit-direction-adjacency"
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
