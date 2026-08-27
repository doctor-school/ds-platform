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
import { slugifyTaxonomyTitle, type DirectionAdminDetail } from "@ds/schemas";
import { DirectionFormSchema, type DirectionFormFields } from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

/**
 * The direction authoring form (012 EARS-3, #1285) — the twin of `expert-form.tsx`
 * and `project-form.tsx`, reduced to what a curated direction actually is: a title
 * and the permanent address it will be reachable at. There is no description,
 * no media and no second descriptive field, because the entity has none
 * (012-design §2.2; `CreateDirectionRequestSchema` is `.strict()` and would refuse
 * one). A placeholder box for a field the API rejects is not a courtesy — it is
 * a promise the platform cannot keep.
 *
 * Two behaviours carry over from the sibling forms unchanged, deliberately:
 *
 * 1. **Slug.** The box shows the generated preview from the TITLE, computed by
 *    the SAME `@ds/schemas` function the API uses, so the preview can never
 *    promise a different address than the one that gets stored. It stays
 *    editable while the direction has never been published; once `firstPublishedAt`
 *    is set the server refuses a change (409 `SLUG_IMMUTABLE`) and the field
 *    renders read-only WITH the reason. `slugEditable` is read off the server
 *    projection, never re-derived here.
 * 2. **No input mask on the title** (012-scenarios lines 72–78). The operator
 *    types freely; trimming and the 1–120 bound are enforced on blur by the SSOT
 *    resolver and again by the API. A mask that silently ate a character would
 *    make the stored title differ from the typed one with no refusal shown.
 *
 * There is no Delete affordance and no `useDelete()` anywhere on this surface:
 * 012 exposes no DELETE route for any taxonomy entity (012-design §5.1), and the
 * data provider refuses `deleteOne` as the backstop.
 */
export interface DirectionFormValues {
  title: string;
  /** Empty string ⇒ let the server generate the slug from the title. */
  slug: string;
}

function defaults(detail?: DirectionAdminDetail): DirectionFormFields {
  return {
    title: detail?.title ?? "",
    slug: detail?.slug ?? "",
  };
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

  const slugEditable = detail ? detail.slugEditable : true;
  const title = form.watch("title");
  const slugValue = form.watch("slug");
  const generatedSlug = slugifyTaxonomyTitle(title ?? "");

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-5"
        data-testid="direction-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => {
          onSubmit({ title: fields.title, slug: fields.slug.trim() });
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

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="slug">{t("directions.fields.slug")}</FormLabel>
              <FormControl>
                <Input
                  id="slug"
                  data-testid="direction-slug"
                  readOnly={!slugEditable}
                  aria-readonly={!slugEditable || undefined}
                  placeholder={generatedSlug}
                  {...field}
                />
              </FormControl>
              <FormMessage>
                {slugEditable
                  ? t("directions.fields.slugPreviewHint")
                  : t("directions.fields.slugLockedHint")}
              </FormMessage>
              {slugEditable && generatedSlug && !slugValue ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="direction-slug-preview"
                >
                  {generatedSlug}
                </p>
              ) : null}
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
