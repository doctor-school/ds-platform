"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import {
  Avatar,
  Button,
  Input,
  Label,
  MediaDropzone,
  Textarea,
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
  EXPERT_BIO_MAX,
  EXPERT_CREDENTIALS_MAX,
  type ExpertAdminDetail,
  MAX_IMAGE_BYTES,
  slugifyTaxonomyTitle,
} from "@ds/schemas";
import { ExpertFormSchema, type ExpertFormFields } from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

/**
 * The «Основное» tab of the expert detail (012 EARS-2, #1284) — the twin of
 * `project-form.tsx` in the Stage-A composition-B layout (#1282). «Связи»
 * (#1291/#1289) and «Публикация» (#1287/#1295/#1296) arrive with their own
 * slices; no empty placeholder tab is rendered for them.
 *
 * Four behaviours are worth stating:
 *
 * 1. **Only the name is required here.** The API accepts a draft expert that
 *    carries nothing but a display name, and an expert record is routinely
 *    started from a business card and finished later. The four publish-required
 *    fields therefore say so under the box instead of blocking the save — the
 *    server refuses the PUBLICATION (#1287), not the draft.
 * 2. **Slug.** The box shows the generated preview from the NAME and stays
 *    editable while the expert has never been published; once
 *    `firstPublishedAt` is set the server refuses a change (409
 *    `SLUG_IMMUTABLE`), so the field renders read-only with the reason.
 * 3. **Photo.** The dropzone's checks are preflight only; the API normalizer is
 *    authoritative. Picking a file and asking to remove the stored one are
 *    mutually exclusive (server: 400 `MEDIA_INPUT_CONFLICT`).
 * 4. **Initials.** When there is no photo the avatar shows the initials the
 *    SERVER computed (`detail.initials`, 012-design §2.2) — the admin renders
 *    them, it never re-derives them, so this avatar, the public projection
 *    (#1294) and the speaker projection (#1290) can never disagree about the
 *    same person.
 */
export interface ExpertFormValues {
  name: string;
  professionalRole: string;
  credentials: string;
  affiliation: string;
  bio: string;
  /** Empty string ⇒ let the server generate the slug from the name. */
  slug: string;
  photo: File | null;
  /** True when the operator asked to drop the STORED photo (`mediaAction: "clear"`). */
  removePhoto: boolean;
}

function defaults(detail?: ExpertAdminDetail): ExpertFormFields {
  return {
    name: detail?.name ?? "",
    professionalRole: detail?.professionalRole ?? "",
    credentials: detail?.credentials ?? "",
    affiliation: detail?.affiliation ?? "",
    bio: detail?.bio ?? "",
    slug: detail?.slug ?? "",
  };
}

export function ExpertForm({
  detail,
  submitLabel,
  onSubmit,
  submitting,
}: {
  detail?: ExpertAdminDetail;
  submitLabel: string;
  onSubmit: (values: ExpertFormValues) => void;
  submitting?: boolean;
}) {
  const t = useTranslations();
  const form = useForm<ExpertFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      ExpertFormSchema as unknown as z.ZodType<
        ExpertFormFields,
        ExpertFormFields
      >,
      "experts.validation",
    ),
    defaultValues: defaults(detail),
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const slugEditable = detail ? detail.slugEditable : true;
  const name = form.watch("name");
  const slugValue = form.watch("slug");
  // Live preview of what the server would generate — the SAME function the API
  // uses (`@ds/schemas`), so the preview cannot promise a different address.
  const generatedSlug = slugifyTaxonomyTitle(name ?? "");
  // The initials stand in for the photo only when there is no image to show at
  // all: no freshly picked file, and either no stored photo or a pending removal.
  const showInitials =
    !photo && (removePhoto || !detail?.photoUrl) && Boolean(detail?.initials);

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-5"
        data-testid="expert-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => {
          if (photoError) return;
          onSubmit({
            name: fields.name,
            professionalRole: fields.professionalRole,
            credentials: fields.credentials,
            affiliation: fields.affiliation,
            bio: fields.bio,
            slug: fields.slug.trim(),
            photo,
            removePhoto,
          });
        })}
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="name">{t("experts.fields.name")}</FormLabel>
              <FormControl>
                <Input id="name" data-testid="expert-name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="professionalRole"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="professionalRole">
                {t("experts.fields.professionalRole")}
              </FormLabel>
              <FormControl>
                <Input
                  id="professionalRole"
                  data-testid="expert-professional-role"
                  {...field}
                />
              </FormControl>
              <FormMessage>{t("experts.fields.publishHint")}</FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="credentials"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="credentials">
                {t("experts.fields.credentials")}
              </FormLabel>
              <FormControl>
                <Textarea
                  id="credentials"
                  data-testid="expert-credentials"
                  showCounter
                  maxLength={EXPERT_CREDENTIALS_MAX}
                  formatCounter={(remaining) =>
                    remaining < 0
                      ? t("experts.fields.counterOver", {
                          count: Math.abs(remaining),
                        })
                      : t("experts.fields.counter", { count: remaining })
                  }
                  {...field}
                />
              </FormControl>
              <FormMessage>{t("experts.fields.publishHint")}</FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="affiliation"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="affiliation">
                {t("experts.fields.affiliation")}
              </FormLabel>
              <FormControl>
                <Input
                  id="affiliation"
                  data-testid="expert-affiliation"
                  {...field}
                />
              </FormControl>
              <FormMessage>{t("experts.fields.publishHint")}</FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="bio"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="bio">{t("experts.fields.bio")}</FormLabel>
              <FormControl>
                <Textarea
                  id="bio"
                  data-testid="expert-bio"
                  showCounter
                  maxLength={EXPERT_BIO_MAX}
                  formatCounter={(remaining) =>
                    remaining < 0
                      ? t("experts.fields.counterOver", {
                          count: Math.abs(remaining),
                        })
                      : t("experts.fields.counter", { count: remaining })
                  }
                  {...field}
                />
              </FormControl>
              <FormMessage>{t("experts.fields.publishHint")}</FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="slug">{t("experts.fields.slug")}</FormLabel>
              <FormControl>
                <Input
                  id="slug"
                  data-testid="expert-slug"
                  readOnly={!slugEditable}
                  aria-readonly={!slugEditable || undefined}
                  placeholder={generatedSlug}
                  {...field}
                />
              </FormControl>
              <FormMessage>
                {slugEditable
                  ? t("experts.fields.slugPreviewHint")
                  : t("experts.fields.slugLockedHint")}
              </FormMessage>
              {slugEditable && generatedSlug && !slugValue ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="expert-slug-preview"
                >
                  {generatedSlug}
                </p>
              ) : null}
            </FormItem>
          )}
        />

        {/* Photo — a File part, not an RHF field, so it is a plain labelled block
            (FormItem/FormLabel require a <FormField> context and throw outside one).
            The initials avatar sits beside the dropzone: it is what the platform
            will actually render wherever this expert appears without a photo, so
            the operator sees the fallback rather than being told about it. */}
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="photo">{t("experts.fields.photo")}</Label>
          <div className="flex items-start gap-4">
            {showInitials ? (
              <Avatar
                data-testid="expert-initials"
                aria-label={t("experts.fields.initialsAlt")}
              >
                {detail?.initials}
              </Avatar>
            ) : null}
            <div className="min-w-0 flex-1">
              <MediaDropzone
                id="photo"
                accept={ACCEPTED_IMAGE_MIME_TYPES}
                maxBytes={MAX_IMAGE_BYTES}
                currentUrl={detail?.photoUrl ?? null}
                file={photo}
                removed={removePhoto}
                labels={{
                  prompt: t("experts.fields.photoPrompt"),
                  hint: t("experts.fields.photoHint"),
                  remove: t("experts.fields.photoRemove"),
                  previewAlt: t("experts.fields.photoAlt"),
                }}
                onFileChange={(file) => {
                  setPhoto(file);
                  // Picking a file supersedes a pending removal — the two cannot
                  // ride one request (server: 400 MEDIA_INPUT_CONFLICT).
                  if (file) setRemovePhoto(false);
                  setPhotoError(null);
                }}
                onRemoveCurrent={() => {
                  setPhoto(null);
                  setRemovePhoto(true);
                  setPhotoError(null);
                }}
                onPreflightError={(kind) => {
                  setPhoto(null);
                  setPhotoError(
                    kind === "type"
                      ? t("experts.errors.photoType")
                      : t("experts.errors.photoSize"),
                  );
                }}
              />
            </div>
          </div>
          {photoError ? (
            <FormError data-testid="expert-photo-error">{photoError}</FormError>
          ) : null}
        </div>

        <div>
          <Button type="submit" loading={submitting} data-testid="submit-expert">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
