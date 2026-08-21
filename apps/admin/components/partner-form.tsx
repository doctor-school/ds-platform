"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import {
  Button,
  Input,
  Label,
  MediaDropzone,
} from "@ds/design-system";
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
  type PartnerAdminDetail,
  slugifyTaxonomyTitle,
} from "@ds/schemas";
import { PartnerFormSchema, type PartnerFormFields } from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

/**
 * The «Основное» tab of the partner detail (012 EARS-4, #1286) — the twin of
 * `expert-form.tsx` in the Stage-A composition-B layout (#1282), with the three
 * differences a partner actually has:
 *
 * 1. **Only the title is required.** A partner card is routinely started from a
 *    sponsor's name and finished later, and 012-design §5.2 declares BOTH
 *    `logoUrl` and `websiteUrl` nullable on the public projection — so neither is
 *    publish-required and neither blocks the save. There is no
 *    `PUBLISH_REQUIREMENTS_NOT_MET` branch on this vertical.
 * 2. **No initials fallback.** Initials are an expert-only affordance (a person
 *    has them, an organisation does not), so an empty logo slot renders as an
 *    empty slot — the dropzone's own prompt — rather than a made-up monogram.
 * 3. **The website box is an absolute https address.** The client folds the SSOT
 *    `PartnerWebsiteUrlSchema` in, which is the exact twin of the DB CHECK, so
 *    the refusal the operator reads on blur is the rule the column enforces.
 *
 * Slug: the box shows the generated preview from the TITLE and stays editable
 * while the partner has never been published; once `firstPublishedAt` is set the
 * server refuses a change (409 `SLUG_IMMUTABLE`), so `slugEditable: false` makes
 * the field read-only with the reason. The SERVER, not this form, owns that call.
 *
 * Logo: the dropzone's checks are preflight only; the API normalizer (canonical
 * WebP, #1283) is authoritative. Picking a file and asking to remove the stored
 * one are mutually exclusive — together they are a 400 `MEDIA_INPUT_CONFLICT`.
 */
export interface PartnerFormValues {
  title: string;
  websiteUrl: string;
  /** Empty string ⇒ let the server generate the slug from the title. */
  slug: string;
  logo: File | null;
  /** True when the operator asked to drop the STORED logo (`mediaAction: "clear"`). */
  removeLogo: boolean;
}

function defaults(detail?: PartnerAdminDetail): PartnerFormFields {
  return {
    title: detail?.title ?? "",
    websiteUrl: detail?.websiteUrl ?? "",
    slug: detail?.slug ?? "",
  };
}

export function PartnerForm({
  detail,
  submitLabel,
  onSubmit,
  submitting,
}: {
  detail?: PartnerAdminDetail;
  submitLabel: string;
  onSubmit: (values: PartnerFormValues) => void;
  submitting?: boolean;
}) {
  const t = useTranslations();
  const form = useForm<PartnerFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      PartnerFormSchema as unknown as z.ZodType<
        PartnerFormFields,
        PartnerFormFields
      >,
      "partners.validation",
    ),
    defaultValues: defaults(detail),
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const slugEditable = detail ? detail.slugEditable : true;
  const title = form.watch("title");
  const slugValue = form.watch("slug");
  // Live preview of what the server would generate — the SAME function the API
  // uses (`@ds/schemas`), so the preview cannot promise a different address.
  const generatedSlug = slugifyTaxonomyTitle(title ?? "");

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-5"
        data-testid="partner-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => {
          if (logoError) return;
          onSubmit({
            title: fields.title,
            websiteUrl: fields.websiteUrl.trim(),
            slug: fields.slug.trim(),
            logo,
            removeLogo,
          });
        })}
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="title">{t("partners.fields.title")}</FormLabel>
              <FormControl>
                <Input id="title" data-testid="partner-title" {...field} />
              </FormControl>
              <FormMessage>{t("partners.fields.titleHint")}</FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="websiteUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="websiteUrl">
                {t("partners.fields.websiteUrl")}
              </FormLabel>
              <FormControl>
                <Input
                  id="websiteUrl"
                  data-testid="partner-website-url"
                  inputMode="url"
                  placeholder={t("partners.fields.websiteUrlPlaceholder")}
                  {...field}
                />
              </FormControl>
              <FormMessage>{t("partners.fields.websiteUrlHint")}</FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="slug">{t("partners.fields.slug")}</FormLabel>
              <FormControl>
                <Input
                  id="slug"
                  data-testid="partner-slug"
                  readOnly={!slugEditable}
                  aria-readonly={!slugEditable || undefined}
                  placeholder={generatedSlug}
                  {...field}
                />
              </FormControl>
              <FormMessage>
                {slugEditable
                  ? t("partners.fields.slugPreviewHint")
                  : t("partners.fields.slugLockedHint")}
              </FormMessage>
              {slugEditable && generatedSlug && !slugValue ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="partner-slug-preview"
                >
                  {generatedSlug}
                </p>
              ) : null}
            </FormItem>
          )}
        />

        {/* Logo — a File part, not an RHF field, so it is a plain labelled block
            (FormItem/FormLabel require a <FormField> context and throw outside
            one). No initials avatar beside it: an organisation has no initials
            fallback anywhere on the platform (§2.2), so an empty slot is what a
            logo-less partner actually renders as. */}
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="logo">{t("partners.fields.logo")}</Label>
          <MediaDropzone
            id="logo"
            accept={ACCEPTED_IMAGE_MIME_TYPES}
            maxBytes={MAX_IMAGE_BYTES}
            currentUrl={detail?.logoUrl ?? null}
            file={logo}
            removed={removeLogo}
            labels={{
              prompt: t("partners.fields.logoPrompt"),
              hint: t("partners.fields.logoHint"),
              remove: t("partners.fields.logoRemove"),
              previewAlt: t("partners.fields.logoAlt"),
            }}
            onFileChange={(file) => {
              setLogo(file);
              // Picking a file supersedes a pending removal — the two cannot
              // ride one request (server: 400 MEDIA_INPUT_CONFLICT).
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
                  ? t("partners.errors.logoType")
                  : t("partners.errors.logoSize"),
              );
            }}
          />
          {logoError ? (
            <FormError data-testid="partner-logo-error">{logoError}</FormError>
          ) : null}
        </div>

        <div>
          <Button
            type="submit"
            loading={submitting}
            data-testid="submit-partner"
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
