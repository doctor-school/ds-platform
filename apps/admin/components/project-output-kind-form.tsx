"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { Button, Input } from "@ds/design-system";
import { FormActions, FormSection } from "@ds/design-system/blocks";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import type { ProjectOutputKindAdminDetail } from "@ds/schemas";
import {
  ProjectOutputKindFormSchema,
  type ProjectOutputKindFormFields,
} from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

const NO_REFUSED_FIELDS: readonly string[] = [];

/**
 * The output-kind add / rename form (030 EARS-3; `output-kinds`) — the
 * organisation-role form one-to-one. One field, the title, trimmed 1–60 by the
 * SSOT validator. Uniqueness among active kinds is the server's answer: a
 * `VALIDATION_FAILED` on `title` is marked on the field itself.
 */
export function ProjectOutputKindForm({
  detail,
  submitLabel,
  onSubmit,
  submitting,
  refused = NO_REFUSED_FIELDS,
}: {
  detail?: ProjectOutputKindAdminDetail;
  submitLabel: string;
  onSubmit: (values: ProjectOutputKindFormFields) => void;
  submitting?: boolean;
  /** The fields the server's last refusal addressed (`refusedFields`). */
  refused?: readonly string[];
}) {
  const t = useTranslations();
  const form = useForm<ProjectOutputKindFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      ProjectOutputKindFormSchema as unknown as z.ZodType<
        ProjectOutputKindFormFields,
        ProjectOutputKindFormFields
      >,
      "projectOutputKinds.validation",
    ),
    defaultValues: { title: detail?.title ?? "" },
  });

  useEffect(() => {
    if (refused.includes("title")) {
      form.setError("title", {
        type: "server",
        message: t("projectOutputKinds.errors.titleTaken"),
      });
    }
  }, [refused, form, t]);

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-6 border-2 border-hairline bg-card p-6"
        data-testid="output-kind-form"
        noValidate
        onSubmit={form.handleSubmit((fields) =>
          onSubmit({ title: fields.title.trim() }),
        )}
      >
        <FormSection
          legend={t("projectOutputKinds.sections.main")}
          description={t(
            detail
              ? "projectOutputKinds.sections.mainDescription"
              : "projectOutputKinds.sections.createDescription",
          )}
        >
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="title">
                  {t("projectOutputKinds.fields.title")}
                </FormLabel>
                <FormControl>
                  <Input
                    id="title"
                    data-testid="output-kind-title"
                    {...field}
                  />
                </FormControl>
                <FormMessage>
                  {t("projectOutputKinds.fields.titleHint")}
                </FormMessage>
              </FormItem>
            )}
          />
        </FormSection>
        <FormActions>
          <Button
            type="submit"
            loading={submitting}
            data-testid="submit-output-kind"
          >
            {submitLabel}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
