"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Label,
  MediaDropzone,
  Textarea,
} from "@ds/design-system";
import {
  FormActions,
  FormDerivedNote,
  FormSection,
} from "@ds/design-system/blocks";
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@ds/design-system/form";
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  ORGANISATION_DESCRIPTION_MAX,
  type OrganisationAdminDetail,
  type OrganisationRoleAdminList,
} from "@ds/schemas";
import {
  OrganisationFormSchema,
  type OrganisationFormFields,
} from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import { useAcademyPublicUrl } from "@/components/academy-origin-provider";
import { organisationRolesUrl } from "@/providers/data-provider";
import {
  offeredRoles,
  rolesBookReady,
  submittedRoleIds,
} from "@/lib/organisation-roles";

/**
 * The organisation full-page form (032 EARS-1, EARS-2; `org-form` of 032-design
 * §UI composition, route approved-non-canvas) — the 012 partner form (#1286)
 * grown by the fields the registry adds: «Описание», the roles as checkboxes and
 * the two public display rules. What it keeps from 012:
 *
 * 1. **Only the title is required.** Logo, website, description and roles are
 *    optional while the row is a draft (zero roles is gated at publish, EARS-6).
 * 2. **No initials fallback.** An organisation has none anywhere on the
 *    platform, so an empty logo slot renders as the dropzone's own prompt.
 * 3. **The website box is an absolute https address** — the SSOT
 *    `OrganisationWebsiteUrlSchema`, the exact twin of the DB CHECK.
 *
 * Roles (EARS-2): every ACTIVE role of the book is offered, and every role the
 * organisation already holds stays on the form, ticked (a retired one marked
 * «Роль снята»), so a save never drops it silently. A retired role it does not
 * hold is not offered — the server would refuse it. The save stays disabled
 * until the book has loaded: the role set is replaced whole, so a save from a
 * partial list would drop roles (`@/lib/organisation-roles`).
 *
 * Slug: the server owns it; the form only exposes the resulting public link.
 * Logo: preflight only here; the API normalizer is authoritative. Picking a file
 * and removing the stored one are mutually exclusive (400 MEDIA_INPUT_CONFLICT).
 */
export interface OrganisationFormValues {
  title: string;
  websiteUrl: string;
  description: string;
  roleIds: string[];
  publicNameVisible: boolean;
  publicLogoVisible: boolean;
  logo: File | null;
  /** True when the operator asked to drop the STORED logo (`mediaAction: "clear"`). */
  removeLogo: boolean;
}

function defaults(detail?: OrganisationAdminDetail): OrganisationFormFields {
  return {
    title: detail?.title ?? "",
    websiteUrl: detail?.websiteUrl ?? "",
    description: detail?.description ?? "",
    roleIds: detail?.roles.map((role) => role.id) ?? [],
    publicNameVisible: detail?.publicNameVisible ?? true,
    publicLogoVisible: detail?.publicLogoVisible ?? true,
  };
}

const NO_REFUSED_FIELDS: readonly string[] = [];
const REFUSABLE_FIELDS = [
  "title",
  "websiteUrl",
  "description",
  "roleIds",
] as const;
type RefusableField = (typeof REFUSABLE_FIELDS)[number];

export function OrganisationForm({
  detail,
  submitLabel,
  onSubmit,
  submitting,
  refused = NO_REFUSED_FIELDS,
}: {
  detail?: OrganisationAdminDetail;
  submitLabel: string;
  onSubmit: (values: OrganisationFormValues) => void;
  submitting?: boolean;
  /** The fields the server's last refusal addressed (`refusedFields`, EARS-1). */
  refused?: readonly string[];
}) {
  const t = useTranslations();
  const form = useForm<OrganisationFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      OrganisationFormSchema as unknown as z.ZodType<
        OrganisationFormFields,
        OrganisationFormFields
      >,
      "organisations.validation",
    ),
    defaultValues: defaults(detail),
  });
  const { result: rolesResult, query: rolesQuery } =
    useCustom<OrganisationRoleAdminList>({
      url: organisationRolesUrl.collection(),
      method: "get",
    });
  const roles = offeredRoles(rolesResult.data?.data ?? [], detail?.roles ?? []);
  const rolesReady = rolesBookReady(rolesQuery);
  const [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const publicUrl = useAcademyPublicUrl("partners", detail?.slug);

  // EARS-1 — a refused write shows its field-addressed reasons ON the form.
  useEffect(() => {
    for (const field of refused) {
      if (!REFUSABLE_FIELDS.includes(field as RefusableField)) continue;
      form.setError(field as RefusableField, {
        type: "server",
        message: t(`organisations.fieldRefusals.${field as RefusableField}`),
      });
    }
  }, [refused, form, t]);

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-6"
        data-testid="organisation-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => {
          if (logoError || !rolesReady) return;
          onSubmit({
            title: fields.title,
            websiteUrl: fields.websiteUrl.trim(),
            description: fields.description.trim(),
            // Kept in the book's order, whatever order the boxes were ticked.
            roleIds: submittedRoleIds(roles, fields.roleIds),
            publicNameVisible: fields.publicNameVisible,
            publicLogoVisible: fields.publicLogoVisible,
            logo,
            removeLogo,
          });
        })}
      >
        <FormSection legend={t("organisations.sections.main")}>
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="title">
                  {t("organisations.fields.title")}
                </FormLabel>
                <FormControl>
                  <Input
                    id="title"
                    data-testid="organisation-title"
                    {...field}
                  />
                </FormControl>
                <FormMessage>{t("organisations.fields.titleHint")}</FormMessage>
              </FormItem>
            )}
          />

          {/* Logo — a File part, not an RHF field, so it is a plain labelled
              block (FormItem/FormLabel require a <FormField> context). */}
          <div className="flex flex-col gap-2.5">
            <Label htmlFor="logo">{t("organisations.fields.logo")}</Label>
            <MediaDropzone
              id="logo"
              accept={ACCEPTED_IMAGE_MIME_TYPES}
              maxBytes={MAX_IMAGE_BYTES}
              currentUrl={detail?.logoUrl ?? null}
              file={logo}
              removed={removeLogo}
              labels={{
                prompt: t("organisations.fields.logoPrompt"),
                hint: t("organisations.fields.logoHint"),
                remove: t("organisations.fields.logoRemove"),
                previewAlt: t("organisations.fields.logoAlt"),
              }}
              onFileChange={(file) => {
                setLogo(file);
                if (file) setRemoveLogo(false);
                setLogoError(null);
              }}
              onRemoveCurrent={() => {
                setLogo(null);
                setRemoveLogo(true);
                setLogoError(null);
              }}
              onPreflightError={(kind) => {
                setLogo(null);
                setLogoError(
                  kind === "type"
                    ? t("organisations.errors.logoType")
                    : t("organisations.errors.logoSize"),
                );
              }}
            />
            {logoError ? (
              <FormError data-testid="organisation-logo-error">
                {logoError}
              </FormError>
            ) : null}
          </div>

          <FormField
            control={form.control}
            name="websiteUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="websiteUrl">
                  {t("organisations.fields.websiteUrl")}
                </FormLabel>
                <FormControl>
                  <Input
                    id="websiteUrl"
                    data-testid="organisation-website-url"
                    inputMode="url"
                    placeholder={t(
                      "organisations.fields.websiteUrlPlaceholder",
                    )}
                    {...field}
                  />
                </FormControl>
                <FormMessage>
                  {t("organisations.fields.websiteUrlHint")}
                </FormMessage>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="description">
                  {t("organisations.fields.description")}
                </FormLabel>
                <FormControl>
                  <Textarea
                    id="description"
                    data-testid="organisation-description"
                    showCounter
                    maxLength={ORGANISATION_DESCRIPTION_MAX}
                    formatCounter={(remaining) =>
                      remaining < 0
                        ? t("organisations.fields.counterOver", {
                            count: Math.abs(remaining),
                          })
                        : t("organisations.fields.counter", {
                            count: remaining,
                          })
                    }
                    {...field}
                  />
                </FormControl>
                <FormMessage>
                  {t("organisations.fields.descriptionHint")}
                </FormMessage>
              </FormItem>
            )}
          />

          <FormDerivedNote
            title={t("organisations.fields.publicLink")}
            data-testid="organisation-public-link-note"
          >
            <span data-testid="organisation-public-link">
              {publicUrl ?? t("organisations.fields.publicLinkPending")}
            </span>
            {publicUrl ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="organisation-copy-public-link"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(publicUrl)
                    .then(() => setCopied(true));
                }}
              >
                {copied
                  ? t("organisations.actions.linkCopied")
                  : t("organisations.actions.copyPublicLink")}
              </Button>
            ) : null}
          </FormDerivedNote>
        </FormSection>

        <FormSection
          legend={t("organisations.sections.roles")}
          description={t("organisations.sections.rolesDescription")}
        >
          <FormField
            control={form.control}
            name="roleIds"
            render={({ field }) => (
              <FormItem>
                <div
                  className="flex flex-col gap-3"
                  data-testid="organisation-roles"
                >
                  {rolesQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">
                      {t("common.loading")}
                    </p>
                  ) : rolesQuery.isError ? (
                    <Alert
                      variant="danger"
                      data-testid="organisation-roles-error"
                    >
                      <p>{t("organisations.errors.rolesLoadFailed")}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        data-testid="organisation-roles-retry"
                        onClick={() => void rolesQuery.refetch()}
                      >
                        {t("common.retry")}
                      </Button>
                    </Alert>
                  ) : (
                    roles.map((role) => (
                      <Checkbox
                        key={role.id}
                        id={`organisation-role-${role.id}`}
                        data-testid={`organisation-role-${role.slug}`}
                        name={field.name}
                        checked={field.value.includes(role.id)}
                        onBlur={field.onBlur}
                        onChange={(e) =>
                          field.onChange(
                            e.target.checked
                              ? [...field.value, role.id]
                              : field.value.filter((id) => id !== role.id),
                          )
                        }
                      >
                        {role.status === "retired"
                          ? t("organisations.fields.roleRetired", {
                              title: role.title,
                            })
                          : role.title}
                      </Checkbox>
                    ))
                  )}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection
          legend={t("organisations.sections.display")}
          description={t("organisations.sections.displayDescription")}
        >
          <div className="flex flex-col gap-3">
            <FormField
              control={form.control}
              name="publicNameVisible"
              render={({ field }) => (
                <Checkbox
                  id="publicNameVisible"
                  data-testid="organisation-public-name-visible"
                  name={field.name}
                  checked={field.value}
                  onBlur={field.onBlur}
                  onChange={(e) => field.onChange(e.target.checked)}
                >
                  {t("organisations.fields.publicNameVisible")}
                </Checkbox>
              )}
            />
            <FormField
              control={form.control}
              name="publicLogoVisible"
              render={({ field }) => (
                <Checkbox
                  id="publicLogoVisible"
                  data-testid="organisation-public-logo-visible"
                  name={field.name}
                  checked={field.value}
                  onBlur={field.onBlur}
                  onChange={(e) => field.onChange(e.target.checked)}
                >
                  {t("organisations.fields.publicLogoVisible")}
                </Checkbox>
              )}
            />
          </div>
        </FormSection>

        <FormActions>
          <Button
            type="submit"
            loading={submitting}
            disabled={!rolesReady}
            data-testid="submit-organisation"
          >
            {submitLabel}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
