"use client";

import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { Button, Input } from "@ds/design-system";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import type { DirectionAdminDetail } from "@ds/schemas";
import { DirectionFormSchema, type DirectionFormFields } from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

/**
 * The direction authoring form (012 EARS-3, #1285) — the twin of `expert-form.tsx`
 * and `project-form.tsx`, reduced to what a curated direction actually is: a
 * title. There is no description, no media and no second descriptive field,
 * because the entity has none (012-design §2.2; `CreateDirectionRequestSchema` is
 * `.strict()` and would refuse one). A placeholder box for a field the API
 * rejects is not a courtesy — it is a promise the platform cannot keep.
 *
 * **«Адрес страницы» is absent entirely** (017-design §9.3). The address is
 * transliterated from the Russian title by the server, frozen on first publish
 * and rendered nowhere — list, record and create form alike. The Stage-A pick is
 * full hiding, so there is no derived-value note either: a note explaining a
 * field the operator never sees re-introduces that field as prose.
 *
 * **No input mask on the title** (012-scenarios lines 72–78). The operator types
 * freely; trimming and the 1–120 bound are enforced on blur by the SSOT resolver
 * and again by the API. A mask that silently ate a character would make the
 * stored title differ from the typed one with no refusal shown.
 *
 * There is no Delete affordance and no `useDelete()` anywhere on this surface:
 * 012 exposes no DELETE route for any taxonomy entity (012-design §5.1), and the
 * data provider refuses `deleteOne` as the backstop.
 */
export interface DirectionFormValues {
  title: string;
}

function defaults(detail?: DirectionAdminDetail): DirectionFormFields {
  return { title: detail?.title ?? "" };
}

export function DirectionForm({
  detail,
  submitLabel,
  onSubmit,
  submitting,
}: {
  detail?: DirectionAdminDetail;
  submitLabel: string;
  onSubmit: (values: DirectionFormValues) => void;
  submitting?: boolean;
}) {
  const t = useTranslations();
  const form = useForm<DirectionFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      DirectionFormSchema as unknown as z.ZodType<DirectionFormFields, DirectionFormFields>,
      "directions.validation",
    ),
    defaultValues: defaults(detail),
  });

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-5"
        data-testid="direction-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => {
          onSubmit({ title: fields.title });
        })}
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="title">{t("directions.fields.title")}</FormLabel>
              <FormControl>
                {/* No `maxLength`: a hard cap on the input would silently eat
                    the 121st character instead of refusing it, which is exactly
                    the input mask 012-scenarios (lines 72–78) rules out. The
                    bound is enforced on blur by the SSOT resolver — with a
                    sentence the operator can act on — and again by the API. */}
                <Input id="title" data-testid="direction-title" {...field} />
              </FormControl>
              <FormMessage>{t("directions.fields.titleHint")}</FormMessage>
            </FormItem>
          )}
        />

        <div>
          <Button type="submit" loading={submitting} data-testid="submit-direction">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
