"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import {
  Alert,
  Button,
  Input,
  Label,
  MediaDropzone,
  NativeSelect,
  Radio,
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
import { FormDerivedNote } from "@ds/design-system/blocks";
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  DEFAULT_PROJECT_STAGE,
  EVENT_AUDIENCES,
  PROJECT_STAGE_NOTE_MAX,
  PROJECT_STAGES,
  type ProjectStage,
  type EventAudience,
  MAX_IMAGE_BYTES,
  PROJECT_DESCRIPTION_MAX,
  type ProjectAdminDetail,
} from "@ds/schemas";
import { ProjectFormSchema, type ProjectFormFields } from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import { useAcademyPublicUrl } from "@/components/academy-origin-provider";

/**
 * The «Основное» tab of the project detail (Stage A #1282 — composition B).
 * #1283 ships this tab only: «Связи» and «Публикация» arrive with their own
 * slices (#1288/#1291/#1292 and #1287/#1295/#1296). No empty placeholder tab is
 * rendered for them — an inert tab reads as a broken feature, not as a promise.
 *
 * Two behaviours are worth stating: the public address is system-owned and only
 * exposed as a copyable derived link after save; the dropzone's checks are
 *    authoritative. Picking a file and asking to remove the stored one are
 *    mutually exclusive here because the server refuses both together with
 *    `MEDIA_INPUT_CONFLICT`.
 */
export interface ProjectFormValues {
  title: string;
  description: string;
  /** 012 EARS-30 (#2509) — prefills the audience of the project's new events. */
  defaultAudience: EventAudience;
  /** 030 EARS-1 — «Проект идёт» / «Скоро» / «Завершён». */
  stage: ProjectStage;
  /** 030 EARS-1 — «Что происходит сейчас»; `null` for any stage but «Скоро». */
  stageNote: string | null;
  cover: File | null;
  /** True when the operator asked to drop the STORED cover (`mediaAction: "clear"`). */
  removeCover: boolean;
}

function defaults(detail?: ProjectAdminDetail): ProjectFormFields {
  return {
    title: detail?.title ?? "",
    description: detail?.description ?? "",
    // No preselected audience on create: the editor chooses it (required).
    defaultAudience: detail?.defaultAudience ?? "",
    // A new project starts «Скоро» (030 EARS-1).
    stage: detail?.stage ?? DEFAULT_PROJECT_STAGE,
    stageNote: detail?.stageNote ?? "",
  };
}

/** The form fields a server refusal can address, with the sentence each gets. */
const REFUSABLE_FIELDS = {
  title: "projects.validation.required",
  description: "projects.validation.required",
  stageNote: "projects.validation.stageNote",
} as const satisfies Partial<Record<keyof ProjectFormFields, string>>;

const NO_REFUSED_FIELDS: readonly string[] = [];

export function ProjectForm({
  detail,
  submitLabel,
  onSubmit,
  submitting,
  refused = NO_REFUSED_FIELDS,
}: {
  detail?: ProjectAdminDetail;
  submitLabel: string;
  onSubmit: (values: ProjectFormValues) => void;
  submitting?: boolean;
  /**
   * The fields the server's last refusal addressed (`refusedFields` /
   * `publishBlockers`): each is marked ON its field (030 EARS-1).
   */
  refused?: readonly string[];
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
  const [copied, setCopied] = useState(false);
  const publicUrl = useAcademyPublicUrl("projects", detail?.slug);
  const stage = form.watch("stage");

  useEffect(() => {
    for (const [field, key] of Object.entries(REFUSABLE_FIELDS)) {
      if (refused.includes(field)) {
        form.setError(field as keyof typeof REFUSABLE_FIELDS, {
          type: "server",
          message: t(key),
        });
      }
    }
  }, [refused, form, t]);

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-5"
        data-testid="project-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => {
          if (coverError) return;
          onSubmit({
            title: fields.title,
            description: fields.description,
            defaultAudience: fields.defaultAudience as EventAudience,
            stage: fields.stage,
            // Only «Скоро» carries a note; the server stores it empty otherwise.
            stageNote: fields.stage === "soon" ? fields.stageNote.trim() : null,
            cover,
            removeCover,
          });
        })}
      >
        {/* 030 EARS-17 — a project migrated from 012 keeps its former kind only
            as this read-only hint; no form offers a project kind any more. */}
        {detail?.legacyKind ? (
          <Alert variant="info" data-testid="project-legacy-kind">
            {t("projects.fields.legacyKind", {
              kind: t(`projects.kinds.${detail.legacyKind}`),
            })}
          </Alert>
        ) : null}

        {/* 012 EARS-30 (#2509) — the audience the project's NEW events start
            from. Required; changing it later rewrites no existing event. */}
        <FormField
          control={form.control}
          name="defaultAudience"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="defaultAudience">
                {t("projects.fields.defaultAudience")}
              </FormLabel>
              <FormControl>
                <NativeSelect
                  id="defaultAudience"
                  data-testid="project-default-audience"
                  {...field}
                >
                  <option value="">
                    {t("projects.fields.defaultAudiencePlaceholder")}
                  </option>
                  {EVENT_AUDIENCES.map((audience) => (
                    <option key={audience} value={audience}>
                      {t(`events.audiences.${audience}`)}
                    </option>
                  ))}
                </NativeSelect>
              </FormControl>
              <FormMessage>{t("projects.fields.defaultAudienceHint")}</FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="title">
                {t("projects.fields.title")}
              </FormLabel>
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

        <FormDerivedNote
          title={t("projects.fields.publicLink")}
          data-testid="project-public-link-note"
        >
          <span data-testid="project-public-link">
            {publicUrl ?? t("projects.fields.publicLinkPending")}
          </span>
          {publicUrl ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="project-copy-public-link"
              onClick={() => {
                void navigator.clipboard
                  .writeText(publicUrl)
                  .then(() => setCopied(true));
              }}
            >
              {copied
                ? t("projects.actions.linkCopied")
                : t("projects.actions.copyPublicLink")}
            </Button>
          ) : null}
        </FormDerivedNote>

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
            <FormError data-testid="project-cover-error">
              {coverError}
            </FormError>
          ) : null}
        </div>

        {/* 030 EARS-1 — the stage is a closed set of three, so a radio group
            (a real fieldset + legend names the group). */}
        <FormField
          control={form.control}
          name="stage"
          render={({ field }) => (
            <FormItem>
              <fieldset
                className="flex flex-col gap-2.5"
                data-testid="project-stage"
              >
                <legend className="mb-2.5 text-xs font-bold text-foreground">
                  {t("projects.fields.stage")}
                </legend>
                <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                  {PROJECT_STAGES.map((value) => (
                    <Radio
                      key={value}
                      name={field.name}
                      value={value}
                      checked={field.value === value}
                      onChange={() => field.onChange(value)}
                      onBlur={field.onBlur}
                      data-testid={`project-stage-${value}`}
                    >
                      {t(`projects.stages.${value}`)}
                    </Radio>
                  ))}
                </div>
              </fieldset>
            </FormItem>
          )}
        />

        {stage === "soon" ? (
          <FormField
            control={form.control}
            name="stageNote"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="stageNote">
                  {t("projects.fields.stageNote")}
                </FormLabel>
                <FormControl>
                  <Input
                    id="stageNote"
                    data-testid="project-stage-note"
                    maxLength={PROJECT_STAGE_NOTE_MAX}
                    {...field}
                  />
                </FormControl>
                <FormMessage>{t("projects.fields.stageNoteHint")}</FormMessage>
              </FormItem>
            )}
          />
        ) : null}

        <div>
          <Button
            type="submit"
            loading={submitting}
            data-testid="submit-project"
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
