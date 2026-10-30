"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useForm, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { Button, Input, Radio } from "@ds/design-system";
import { Combobox, FormActions, FormSection } from "@ds/design-system/blocks";
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
  emptyMaterialBody,
  type MaterialAdminDetail,
  type MaterialBody,
  type MaterialKind,
} from "@ds/schemas";
import {
  MaterialFormSchema,
  type MaterialFormFields,
} from "@/lib/form-schemas";
import { useLocalizedResolver } from "@/lib/use-localized-resolver";
import { useRelationshipCombobox } from "@/lib/use-relationship-combobox";

/**
 * The editor is a ProseMirror view: it needs the DOM, so it is loaded on the
 * client only (048-design §Admin `material-editor`; its look is the #3540
 * Stage-A element and is used as it ships, never restyled here).
 */
const RichTextEditor = dynamic(
  () =>
    import("@ds/design-system/rich-text-editor").then(
      (module) => module.RichTextEditor,
    ),
  { ssr: false },
);

/**
 * The material full-page form (048 EARS-1, EARS-19; `material-form` of
 * 048-design §Admin, approved-non-canvas):
 *
 * - «Вид» — «Новость» / «Колонка эксперта». The author field follows the kind:
 *   a news item carries the plain «Автор» line, a column its «Эксперт» chosen
 *   from the non-retired 012 experts (the list read excludes retired rows).
 * - «Партнёр» — optional, any non-retired 032 organisation, clearable; a clear
 *   is sent as `null` on an edit (PATCH omission would keep the old partner).
 * - «Текст» — the `RichTextEditor` over the EARS-2 document; the server is the
 *   allowlist authority and its refusal lands at this field.
 *
 * The cover slot of the design is not on this form yet (#3572 gates it).
 * Every server refusal is shown AT its field (`refused`) — a write refusal with
 * the `fieldRefusals` sentence, a publish refusal (EARS-4) with the missing
 * item's `publishRefusals` sentence.
 */
export interface MaterialFormValues {
  kind: MaterialKind;
  title: string;
  /** The news author line; `""` for a column (the server stores it empty). */
  authorLine: string;
  /** The column's expert; `null` for a news item. */
  expertId: string | null;
  /** The optional partner; `null` when none (or cleared). */
  partnerOrganisationId: string | null;
  body: MaterialBody;
}

export interface MaterialFieldRefusals {
  /** The fields the last refusal addressed. */
  fields: readonly string[];
  /** Which sentence set explains them: a refused write or a refused publish. */
  source: "write" | "publish";
}

const NO_REFUSALS: MaterialFieldRefusals = { fields: [], source: "write" };
const FORM_FIELDS = [
  "kind",
  "title",
  "authorLine",
  "expertId",
  "partnerOrganisationId",
] as const;
type FormFieldName = (typeof FORM_FIELDS)[number];
const PUBLISH_FIELDS = ["title", "body", "expertId"] as const;

function defaults(detail?: MaterialAdminDetail): MaterialFormFields {
  return {
    kind: detail?.kind ?? "news",
    title: detail?.title ?? "",
    authorLine: detail?.authorLine ?? "",
    expertId: detail?.expert?.id ?? "",
    partnerOrganisationId: detail?.partner?.id ?? "",
  };
}

export function MaterialForm({
  detail,
  submitLabel,
  submitting,
  refused = NO_REFUSALS,
  onSubmit,
  onDirtyChange,
}: {
  detail?: MaterialAdminDetail;
  submitLabel: string;
  submitting?: boolean;
  refused?: MaterialFieldRefusals;
  onSubmit: (values: MaterialFormValues) => void;
  /** Reports unsaved edits, so the host can hold the publish of a stale version. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useTranslations();
  const form = useForm<MaterialFormFields>({
    mode: "onTouched",
    resolver: useLocalizedResolver(
      MaterialFormSchema as unknown as z.ZodType<
        MaterialFormFields,
        MaterialFormFields
      >,
      "materials.validation",
    ),
    defaultValues: defaults(detail),
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const expertId = useWatch({ control: form.control, name: "expertId" });
  const partnerId = useWatch({
    control: form.control,
    name: "partnerOrganisationId",
  });
  const [body, setBody] = useState<MaterialBody>(
    () => detail?.body ?? emptyMaterialBody(),
  );
  const [bodyDirty, setBodyDirty] = useState(false);
  const [bodyRefusal, setBodyRefusal] = useState<string | null>(null);

  const expertPicker = useRelationshipCombobox({
    resource: "experts",
    excludedIds: [],
    value: expertId,
    initialSelected: detail?.expert
      ? { id: detail.expert.id, label: detail.expert.name ?? "—" }
      : null,
  });
  const partnerPicker = useRelationshipCombobox({
    resource: "organisations",
    excludedIds: [],
    value: partnerId,
    initialSelected: detail?.partner
      ? { id: detail.partner.id, label: detail.partner.title }
      : null,
  });

  const dirty = form.formState.isDirty || bodyDirty;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // EARS-1 / EARS-4 — a refusal shows its reasons AT the fields it addresses.
  useEffect(() => {
    setBodyRefusal(null);
    const sentence = (field: string) =>
      refused.source === "publish" &&
      (PUBLISH_FIELDS as readonly string[]).includes(field)
        ? t(`materials.publishRefusals.${field}`)
        : t(`materials.fieldRefusals.${field}`);
    for (const field of refused.fields) {
      if (field === "body") {
        setBodyRefusal(sentence("body"));
        continue;
      }
      if (!(FORM_FIELDS as readonly string[]).includes(field)) continue;
      form.setError(field as FormFieldName, {
        type: "server",
        message: sentence(field),
      });
    }
  }, [refused, form, t]);

  // Fixed ids: one form per page, and the e2e drives the pickers by trigger id.
  const expertTrigger = "material-expert";
  const partnerTrigger = "material-partner";
  const bodyLabel = "material-body-label";
  const bodyError = "material-body-error";

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-6"
        data-testid="material-form"
        noValidate
        onSubmit={form.handleSubmit((fields) => {
          const column = fields.kind === "column";
          onSubmit({
            kind: fields.kind,
            title: fields.title.trim(),
            authorLine: column ? "" : fields.authorLine.trim(),
            expertId: column ? fields.expertId || null : null,
            partnerOrganisationId: fields.partnerOrganisationId || null,
            body,
          });
        })}
      >
        <FormSection legend={t("materials.sections.main")}>
          <FormField
            control={form.control}
            name="kind"
            render={({ field }) => (
              <FormItem>
                <fieldset className="flex flex-col gap-2.5">
                  <legend className="text-sm font-semibold text-foreground">
                    {t("materials.fields.kind")}
                  </legend>
                  <div
                    className="flex flex-wrap gap-x-6 gap-y-3"
                    data-testid="material-kind"
                  >
                    {(["news", "column"] as const).map((value) => (
                      <Radio
                        key={value}
                        name={field.name}
                        value={value}
                        checked={field.value === value}
                        data-testid={`material-kind-${value}`}
                        onBlur={field.onBlur}
                        onChange={() => field.onChange(value)}
                      >
                        {t(`materials.kinds.${value}`)}
                      </Radio>
                    ))}
                  </div>
                </fieldset>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={"material-title-input"}>
                  {t("materials.fields.title")}
                </FormLabel>
                <FormControl>
                  <Input
                    id={"material-title-input"}
                    data-testid="material-title"
                    {...field}
                  />
                </FormControl>
                <FormMessage>{t("materials.fields.titleHint")}</FormMessage>
              </FormItem>
            )}
          />

          {kind === "column" ? (
            <FormField
              control={form.control}
              name="expertId"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel htmlFor={expertTrigger}>
                    {t("materials.fields.expert")}
                  </FormLabel>
                  <FormControl>
                    <Combobox
                      id={expertTrigger}
                      options={expertPicker.options}
                      value={field.value || null}
                      invalid={Boolean(fieldState.error)}
                      onValueChange={(next) => {
                        expertPicker.select(next);
                        field.onChange(next);
                        field.onBlur();
                      }}
                      onSearchChange={expertPicker.search}
                      onLoadMore={expertPicker.loadMore}
                      hasMore={expertPicker.hasMore}
                      loadingMore={expertPicker.loadingMore}
                      loadMoreError={expertPicker.loadMoreError}
                      loadMoreLabel={t("relationshipEndpointPicker.loadMore")}
                      loadingMoreLabel={t(
                        "relationshipEndpointPicker.loadingMore",
                      )}
                      loadMoreErrorLabel={t(
                        "relationshipEndpointPicker.retryLoadMore",
                      )}
                      placeholder={t("materials.fields.expertPlaceholder")}
                      searchLabel={t("materials.fields.expertSearch")}
                      searchPlaceholder={t(
                        "materials.fields.expertSearchPlaceholder",
                      )}
                      emptyLabel={
                        expertPicker.isLoading
                          ? t("common.loading")
                          : expertPicker.isError
                            ? t("relationshipEndpointPicker.loadFailed")
                            : t("materials.fields.expertNone")
                      }
                      showSearch
                    />
                  </FormControl>
                  <FormMessage>{t("materials.fields.expertHint")}</FormMessage>
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="authorLine"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={"material-author-line-input"}>
                    {t("materials.fields.authorLine")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      id={"material-author-line-input"}
                      data-testid="material-author-line"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage>
                    {t("materials.fields.authorLineHint")}
                  </FormMessage>
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="partnerOrganisationId"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel htmlFor={partnerTrigger}>
                  {t("materials.fields.partner")}
                </FormLabel>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <FormControl>
                    <Combobox
                      id={partnerTrigger}
                      className="sm:flex-1"
                      options={partnerPicker.options}
                      value={field.value || null}
                      invalid={Boolean(fieldState.error)}
                      onValueChange={(next) => {
                        partnerPicker.select(next);
                        field.onChange(next);
                      }}
                      onSearchChange={partnerPicker.search}
                      onLoadMore={partnerPicker.loadMore}
                      hasMore={partnerPicker.hasMore}
                      loadingMore={partnerPicker.loadingMore}
                      loadMoreError={partnerPicker.loadMoreError}
                      loadMoreLabel={t("relationshipEndpointPicker.loadMore")}
                      loadingMoreLabel={t(
                        "relationshipEndpointPicker.loadingMore",
                      )}
                      loadMoreErrorLabel={t(
                        "relationshipEndpointPicker.retryLoadMore",
                      )}
                      placeholder={t("materials.fields.partnerPlaceholder")}
                      searchLabel={t("materials.fields.partnerSearch")}
                      searchPlaceholder={t(
                        "materials.fields.partnerSearchPlaceholder",
                      )}
                      emptyLabel={
                        partnerPicker.isLoading
                          ? t("common.loading")
                          : partnerPicker.isError
                            ? t("relationshipEndpointPicker.loadFailed")
                            : t("materials.fields.partnerNone")
                      }
                      showSearch
                    />
                  </FormControl>
                  {field.value ? (
                    <Button
                      type="button"
                      variant="outline"
                      data-testid="material-partner-clear"
                      onClick={() =>
                        form.setValue("partnerOrganisationId", "", {
                          shouldDirty: true,
                        })
                      }
                    >
                      {t("materials.fields.partnerClear")}
                    </Button>
                  ) : null}
                </div>
                <FormMessage>{t("materials.fields.partnerHint")}</FormMessage>
              </FormItem>
            )}
          />
        </FormSection>

        <FormSection
          legend={t("materials.sections.body")}
          description={t("materials.sections.bodyDescription")}
        >
          <div className="flex flex-col gap-2.5" data-testid="material-body">
            <span id={bodyLabel} className="sr-only">
              {t("materials.fields.body")}
            </span>
            <RichTextEditor
              value={body}
              aria-labelledby={bodyLabel}
              aria-invalid={bodyRefusal ? true : undefined}
              {...(bodyRefusal ? { "aria-describedby": bodyError } : {})}
              onChange={(next) => {
                setBody(next);
                setBodyDirty(true);
                setBodyRefusal(null);
              }}
            />
            {bodyRefusal ? (
              <FormError id={bodyError} data-testid="material-body-error">
                {bodyRefusal}
              </FormError>
            ) : null}
          </div>
        </FormSection>

        <FormActions>
          <Button
            type="submit"
            loading={submitting}
            data-testid="submit-material"
          >
            {submitLabel}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
