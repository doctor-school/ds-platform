"use client";

import { useEffect, useMemo, useState } from "react";
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
  Combobox,
  FormActions,
  FormDerivedNote,
  FormFieldGroup,
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
  EXPERT_BIO_MAX,
  EXPERT_CREDENTIALS_MAX,
  type ExpertAdminDetail,
  MAX_IMAGE_BYTES,
} from "@ds/schemas";
import { ExpertFormSchema, type ExpertFormFields } from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import {
  fetchEligibleExpertUsers,
  type EligibleExpertUserOption,
} from "@/providers/data-provider";

const ACADEMY_ORIGIN = "https://academy.doctor.school";

export interface ExpertFormValues {
  familyName: string;
  givenName: string;
  patronymic: string;
  userId: string;
  professionalRole: string;
  credentials: string;
  affiliation: string;
  bio: string;
  photo: File | null;
  removePhoto: boolean;
}

function defaults(detail?: ExpertAdminDetail): ExpertFormFields {
  return {
    familyName: detail?.familyName ?? "",
    givenName: detail?.givenName ?? "",
    patronymic: detail?.patronymic ?? "",
    userId: detail?.userId ?? "",
    professionalRole: detail?.professionalRole ?? "",
    credentials: detail?.credentials ?? "",
    affiliation: detail?.affiliation ?? "",
    bio: detail?.bio ?? "",
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
  const [users, setUsers] = useState<EligibleExpertUserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setUsersLoading(true);
    setUsersError(false);
    void fetchEligibleExpertUsers(detail?.id)
      .then((rows) => {
        if (active) setUsers(rows);
      })
      .catch(() => {
        if (active) setUsersError(true);
      })
      .finally(() => {
        if (active) setUsersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [detail?.id]);

  const userOptions = useMemo(
    () =>
      users.map((user) => ({
        value: user.id,
        label: user.displayName ?? user.identifier,
        ...(user.displayName ? { description: user.identifier } : {}),
      })),
    [users],
  );
  const selectedUserId = form.watch("userId");
  const publicUrl = detail?.slug
    ? `${ACADEMY_ORIGIN}/experts/${detail.slug}`
    : null;
  const showInitials =
    !photo && (removePhoto || !detail?.photoUrl) && Boolean(detail?.initials);

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-6"
        data-testid="expert-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => {
          if (photoError) return;
          onSubmit({ ...fields, photo, removePhoto });
        })}
      >
        <FormSection
          legend={t("experts.sections.identity")}
          description={t("experts.sections.identityDescription")}
        >
          <FormFieldGroup columns="two">
            <FormField
              control={form.control}
              name="familyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="familyName">
                    {t("experts.fields.familyName")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      id="familyName"
                      data-testid="expert-family-name"
                      autoComplete="family-name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="givenName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="givenName">
                    {t("experts.fields.givenName")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      id="givenName"
                      data-testid="expert-given-name"
                      autoComplete="given-name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormFieldGroup>
          <FormField
            control={form.control}
            name="patronymic"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="patronymic">
                  {t("experts.fields.patronymic")}
                </FormLabel>
                <FormControl>
                  <Input
                    id="patronymic"
                    data-testid="expert-patronymic"
                    autoComplete="additional-name"
                    {...field}
                  />
                </FormControl>
                <FormMessage>{t("experts.fields.patronymicHint")}</FormMessage>
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection
          legend={t("experts.sections.account")}
          description={t("experts.sections.accountDescription")}
        >
          <FormField
            control={form.control}
            name="userId"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel htmlFor="expert-user">
                  {t("experts.fields.user")}
                </FormLabel>
                <FormControl>
                  <Combobox
                    id="expert-user"
                    options={userOptions}
                    value={field.value || null}
                    onValueChange={field.onChange}
                    placeholder={
                      usersLoading
                        ? t("common.loading")
                        : t("experts.fields.userPlaceholder")
                    }
                    searchLabel={t("experts.fields.userSearch")}
                    searchPlaceholder={t(
                      "experts.fields.userSearchPlaceholder",
                    )}
                    emptyLabel={t("experts.fields.userEmpty")}
                    showSearch
                    disabled={usersLoading || usersError}
                    invalid={fieldState.invalid}
                    aria-label={t("experts.fields.user")}
                  />
                </FormControl>
                <FormMessage>
                  {usersError
                    ? t("experts.errors.usersLoadFailed")
                    : t("experts.fields.userHint")}
                </FormMessage>
                {selectedUserId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="expert-user-unlink"
                    onClick={() =>
                      form.setValue("userId", "", { shouldDirty: true })
                    }
                  >
                    {t("experts.actions.unlinkUser")}
                  </Button>
                ) : null}
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection legend={t("experts.sections.professional")}>
          <FormFieldGroup columns="two">
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
          </FormFieldGroup>
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
        </FormSection>

        <FormSection legend={t("experts.sections.media")}>
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
                  onFileChange={(next) => {
                    setPhoto(next);
                    if (next) setRemovePhoto(false);
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
              <FormError data-testid="expert-photo-error">
                {photoError}
              </FormError>
            ) : null}
          </div>
        </FormSection>

        <FormDerivedNote
          title={t("experts.fields.publicLink")}
          data-testid="expert-public-link-note"
        >
          <span data-testid="expert-public-link">
            {publicUrl ?? t("experts.fields.publicLinkPending")}
          </span>
          {publicUrl ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="expert-copy-public-link"
              onClick={() => {
                void navigator.clipboard
                  .writeText(publicUrl)
                  .then(() => setCopied(true));
              }}
            >
              {copied
                ? t("experts.actions.linkCopied")
                : t("experts.actions.copyPublicLink")}
            </Button>
          ) : null}
        </FormDerivedNote>

        <FormActions>
          <Button
            type="submit"
            loading={submitting}
            data-testid="submit-expert"
          >
            {submitLabel}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
