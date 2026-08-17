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
  NativeSelect,
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
  MAX_IMAGE_BYTES,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_KINDS,
  type ProjectAdminDetail,
  slugifyTaxonomyTitle,
} from "@ds/schemas";
import {
  ProjectFormSchema,
  type ProjectFormFields,
} from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";

/**
 * The «Основное» tab of the project detail (Stage A #1282 — composition B).
 * #1283 ships this tab only: «Связи» and «Публикация» arrive with their own
 * slices (#1288/#1291/#1292 and #1287/#1295/#1296). No empty placeholder tab is
 * rendered for them — an inert tab reads as a broken feature, not as a promise.
 *
 * Two behaviours are worth stating:
 *
 * 1. **Slug.** The box shows the generated preview from the title and stays
 *    editable while the project has never been published. Once
 *    `firstPublishedAt` is set the server refuses a change (409 `SLUG_IMMUTABLE`),
 *    so the field renders read-only with the reason — a field that looks editable
 *    and then fails is worse than one that explains itself.
 * 2. **Cover.** The dropzone's checks are preflight only; the API normalizer is
 *    authoritative. Picking a file and asking to remove the stored one are
 *    mutually exclusive here because the server refuses both together with
 *    `MEDIA_INPUT_CONFLICT`.
 */
export interface ProjectFormValues {
  kind: ProjectFormFields["kind"];
  title: string;
  description: string;
  /** Empty string ⇒ let the server generate the slug from the title. */
  slug: string;
  cover: File | null;
  /** True when the operator asked to drop the STORED cover (`mediaAction: "clear"`). */
  removeCover: boolean;
}

function defaults(detail?: ProjectAdminDetail): ProjectFormFields {
  return {
    kind: detail?.kind ?? "school",
    title: detail?.title ?? "",
    description: detail?.description ?? "",
    slug: detail?.slug ?? "",
  };
}

export function ProjectForm({
  detail,
  submitLabel,
  onSubmit,
  submitting,
}: {
  detail?: ProjectAdminDetail;
  submitLabel: string;
  onSubmit: (values: ProjectFormValues) => void;
  submitting?: boolean;
}) {
  const t = useTranslations();
  const form = useForm<ProjectFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      ProjectFormSchema as unknown as z.ZodType<
        ProjectFormFields,
        ProjectFormFields
      >,
      "projects.validation",
    ),
    defaultValues: defaults(detail),
  });
  const [cover, setCover] = useState<File | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

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
        data-testid="project-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => {
          if (coverError) return;
          onSubmit({
            kind: fields.kind,
            title: fields.title,
            description: fields.description,
            slug: fields.slug.trim(),
            cover,
            removeCover,
          });
        })}
      >
        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="kind">{t("projects.fields.kind")}</FormLabel>
              <FormControl>
                <NativeSelect id="kind" data-testid="project-kind" {...field}>
                  {PROJECT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`projects.kinds.${kind}`)}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="title">{t("projects.fields.title")}</FormLabel>
              <FormControl>
                <Input id="title" data-testid="project-title" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="description">
                {t("projects.fields.description")}
              </FormLabel>
              <FormControl>
                <Textarea
                  id="description"
                  data-testid="project-description"
                  showCounter
                  maxLength={PROJECT_DESCRIPTION_MAX}
                  formatCounter={(remaining) =>
                    remaining < 0
                      ? t("projects.fields.descriptionOver", {
                          count: Math.abs(remaining),
                        })
                      : t("projects.fields.descriptionCounter", {
                          count: remaining,
                        })
                  }
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="slug">{t("projects.fields.slug")}</FormLabel>
              <FormControl>
                <Input
                  id="slug"
                  data-testid="project-slug"
                  readOnly={!slugEditable}
                  aria-readonly={!slugEditable || undefined}
                  placeholder={generatedSlug}
                  {...field}
                />
              </FormControl>
              <FormMessage>
                {slugEditable
                  ? t("projects.fields.slugPreviewHint")
                  : t("projects.fields.slugLockedHint")}
              </FormMessage>
              {slugEditable && generatedSlug && !slugValue ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="project-slug-preview"
                >
                  {generatedSlug}
                </p>
              ) : null}
            </FormItem>
          )}
        />

        {/* Cover — a File part, not an RHF field, so it is a plain labelled block
            (FormItem/FormLabel require a <FormField> context and throw outside one).
            A real <Label htmlFor> rather than a heading: it names the hidden file
            input AND opens the picker when clicked. */}
        <div className="flex flex-col gap-2.5">
          <Label htmlFor="cover">{t("projects.fields.cover")}</Label>
          <MediaDropzone
            id="cover"
            accept={ACCEPTED_IMAGE_MIME_TYPES}
            maxBytes={MAX_IMAGE_BYTES}
            currentUrl={detail?.coverUrl ?? null}
            file={cover}
            removed={removeCover}
            labels={{
              prompt: t("projects.fields.coverPrompt"),
              hint: t("projects.fields.coverHint"),
              remove: t("projects.fields.coverRemove"),
              previewAlt: t("projects.fields.coverAlt"),
            }}
            onFileChange={(file) => {
              setCover(file);
              // Picking a file supersedes a pending removal — the two cannot ride
              // one request (server: 400 MEDIA_INPUT_CONFLICT).
              if (file) setRemoveCover(false);
              setCoverError(null);
            }}
            onRemoveCurrent={() => {
              setCover(null);
              setRemoveCover(true);
              setCoverError(null);
            }}
            onPreflightError={(kind) => {
              setCover(null);
              setCoverError(
                kind === "type"
                  ? t("projects.errors.coverType")
                  : t("projects.errors.coverSize"),
              );
            }}
          />
          {coverError ? (
            <FormError data-testid="project-cover-error">{coverError}</FormError>
          ) : null}
        </div>

        <div>
          <Button type="submit" loading={submitting} data-testid="submit-project">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
