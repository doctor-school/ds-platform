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
import type { OrganisationRoleAdminDetail } from "@ds/schemas";
import {
  OrganisationRoleFormSchema,
  type OrganisationRoleFormFields,
} from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

const NO_REFUSED_FIELDS: readonly string[] = [];

/**
 * The organisation-role add / rename form (032 EARS-3; `org-roles`). One field —
 * the title, trimmed 1–80 by the SSOT validator. Uniqueness among active roles
 * is the server's answer: a `VALIDATION_FAILED` on `title` is marked on the
 * field itself («Такая роль уже есть»), not only above the form.
 */
export function OrganisationRoleForm({
  detail,
  submitLabel,
  onSubmit,
  submitting,
  refused = NO_REFUSED_FIELDS,
}: {
  detail?: OrganisationRoleAdminDetail;
  submitLabel: string;
  onSubmit: (values: OrganisationRoleFormFields) => void;
  submitting?: boolean;
  /** The fields the server's last refusal addressed (`refusedFields`). */
  refused?: readonly string[];
}) {
  const t = useTranslations();
  const form = useForm<OrganisationRoleFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      OrganisationRoleFormSchema as unknown as z.ZodType<
        OrganisationRoleFormFields,
        OrganisationRoleFormFields
      >,
      "organisationRoles.validation",
    ),
    defaultValues: { title: detail?.title ?? "" },
  });

  useEffect(() => {
    if (refused.includes("title")) {
      form.setError("title", {
        type: "server",
        message: t("organisationRoles.errors.titleTaken"),
      });
    }
  }, [refused, form, t]);

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-6 border-2 border-hairline bg-card p-6"
        data-testid="organisation-role-form"
        noValidate
        onSubmit={form.handleSubmit((fields) =>
          onSubmit({ title: fields.title.trim() }),
        )}
      >
        <FormSection
          legend={t("organisationRoles.sections.main")}
          description={t(
            detail
              ? "organisationRoles.sections.mainDescription"
              : "organisationRoles.sections.createDescription",
          )}
        >
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="title">
                  {t("organisationRoles.fields.title")}
                </FormLabel>
                <FormControl>
                  <Input
                    id="title"
                    data-testid="organisation-role-title"
                    {...field}
                  />
                </FormControl>
                <FormMessage>
                  {t("organisationRoles.fields.titleHint")}
                </FormMessage>
              </FormItem>
            )}
          />
        </FormSection>
        <FormActions>
          <Button
            type="submit"
            loading={submitting}
            data-testid="submit-organisation-role"
          >
            {submitLabel}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
